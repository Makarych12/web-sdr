/// <reference lib="webworker" />
import type { Ft8Message } from "./ft8";
const scope = self as unknown as DedicatedWorkerGlobalScope;
const url = new URL(
  "ft8/core.js",
  new URL(import.meta.env.BASE_URL, self.location.origin),
).href;
type Core = {
  HEAPF32: Float32Array;
  _rx_input: () => number;
  _rx_output: () => number;
  _rx_decode: (n: number) => number;
  UTF8ToString: (p: number) => string;
};
const ready = import(/* @vite-ignore */ url).then(
  (m) =>
    m.default({
      locateFile: (name: string) => new URL(name, url).href,
    }) as Promise<Core>,
);
let core: Core | null = null;
let slot = -1,
  filled = 0,
  complete = false,
  nextIndex = 0,
  previous = 0,
  expectedStart = 0,
  previousRate = 0;
const pcm = new Float32Array(180000);
function reset() {
  slot = -1;
  filled = 0;
  complete = false;
  nextIndex = 0;
  expectedStart = 0;
  previousRate = 0;
}
ready
  .then((m) => {
    core = m;
    scope.postMessage({
      type: "state",
      state: "Ожидание полного 15-секундного UTC-слота · USB",
    });
  })
  .catch(() =>
    scope.postMessage({ type: "error", state: "Не удалось загрузить WASM." }),
  );
scope.onmessage = ({ data }) => {
  if (data.type === "reset") {
    reset();
    return;
  }
  if (data.type !== "pcm") return;
  try {
    if (!core) return;
    const { samples, rate, start, generation } = data as {
      samples: Float32Array;
      rate: number;
      start: number;
      generation: number;
    };
    if (!samples.length) return;
    if (rate !== previousRate || Math.abs(start - expectedStart) > 5) reset();
    if (!nextIndex) nextIndex = Math.ceil(start * 12);
    // Carry the last input sample across packets so fractional resampling
    // never inserts holes at packet boundaries. UTC grid has 12000 samples/s.
    for (; ; nextIndex++) {
      const pos = ((nextIndex / 12 - start) * rate) / 1000;
      if (pos > samples.length - 1 + 0.01) break;
      const current = Math.floor(nextIndex / 180000),
        offset = nextIndex - current * 180000;
      if (current !== slot) {
        if (slot >= 0 && complete && filled === 180000) {
          core.HEAPF32.set(pcm, core._rx_input() / 4);
          const t = performance.now();
          core._rx_decode(180000);
          // Hann FFT spans two 160 ms symbols: remove its 160 ms delay,
          // then reference DT to the nominal 0.5 s FT8 transmission start.
          const rows = (
            JSON.parse(core.UTF8ToString(core._rx_output())) as Omit<
              Ft8Message,
              "utc"
            >[]
          ).map((row) => ({ ...row, utc: slot * 15000, dt: row.dt - 0.66 }));
          scope.postMessage({ type: "rows", rows, generation });
          scope.postMessage({
            type: "state",
            state: `RX · ${rows.length} сообщений · ${(performance.now() - t).toFixed(0)} ms / слот`,
            generation,
          });
        }
        slot = current;
        filled = 0;
        pcm.fill(0);
        complete = offset === 0;
      }
      const bounded = Math.max(-1, Math.min(samples.length - 1, pos));
      const lo = Math.floor(bounded),
        fraction = bounded - lo;
      const a = lo < 0 ? previous : samples[lo];
      const b = samples[Math.min(lo + 1, samples.length - 1)];
      pcm[offset] = a * (1 - fraction) + b * fraction;
      filled++;
    }
    previous = samples[samples.length - 1];
    previousRate = rate;
    expectedStart = start + (samples.length / rate) * 1000;
  } catch {
    scope.postMessage({
      type: "error",
      state: "Ошибка декодирования. Остановлено.",
    });
  } finally {
    scope.postMessage({ type: "ack" });
  }
};
