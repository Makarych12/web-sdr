export type Ft8Message = {
  snr: number;
  hz: number;
  dt: number;
  crc: number;
  crcCalculated: number;
  message: string;
  utc: number;
};
export class Ft8Receiver {
  private worker: Worker;
  private pending = 0;
  private ended = false;
  private next = 0;
  private rate = 0;
  private generation = 0;
  private resetPending = false;
  constructor(
    onMessage: (rows: Ft8Message[]) => void,
    onState: (state: string, stopped?: boolean) => void,
    private delay = 0,
  ) {
    this.worker = new Worker(new URL("./ft8.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = ({ data }) => {
      if (this.ended) return;
      if (data.type === "ack") this.pending = Math.max(0, this.pending - 1);
      if (data.type === "rows" && data.generation === this.generation)
        onMessage(data.rows);
      if (
        data.type === "state" &&
        (data.generation === undefined || data.generation === this.generation)
      )
        onState(data.state);
      if (data.type === "error") {
        this.stop();
        onState(data.state, true);
      }
    };
    this.worker.onerror = () => {
      if (this.ended) return;
      this.stop();
      onState("Ошибка Worker / WASM. Остановлено.", true);
    };
  }
  push(samples: Float32Array, rate: number) {
    if (this.ended || !Number.isFinite(rate) || rate < 6400 || rate > 96000)
      return;
    if (samples.length > rate / 8) {
      this.resetSignal();
      return;
    }
    if (this.pending >= 32) {
      if (!this.resetPending) {
        this.resetSignal();
        this.resetPending = true;
      }
      return;
    }
    this.resetPending = false;
    const now = Date.now() - this.delay * 1000;
    if (
      this.rate !== rate ||
      !this.next ||
      Math.abs(now - (this.next + (samples.length / rate) * 1000)) > 1000
    ) {
      this.resetSignal();
      this.next = now - (samples.length / rate) * 1000;
      this.rate = rate;
    }
    const copy = samples.slice();
    this.worker.postMessage(
      {
        type: "pcm",
        samples: copy,
        rate,
        start: this.next,
        generation: this.generation,
      },
      [copy.buffer],
    );
    this.next += (samples.length / rate) * 1000;
    this.pending++;
  }
  resetSignal() {
    this.generation++;
    if (!this.ended)
      this.worker.postMessage({ type: "reset", generation: this.generation });
    this.next = 0;
  }
  stop() {
    this.ended = true;
    this.worker.terminate();
    this.pending = 0;
    this.next = 0;
  }
}
