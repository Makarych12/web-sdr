import lame from "@breezystack/lamejs";
import { KiwiSession, validateTune } from "./kiwi.js";

// A real media URL is consumed by the browser's media process, independently
// of renderer JS, AudioContext and the foreground WebSocket. Never cache it.
export function audioTune(query) {
  const value = { receiver: String(query.receiver || ""), mode: query.mode };
  for (const key of ["frequency", "lowCut", "highCut", "viewCenter"])
    if (query[key] !== undefined) value[key] = Number(query[key]);
  value.zoom = 0;
  value.agc = query.agc;
  return { receiver: value.receiver, ...validateTune(value) };
}

export class MP3Stream {
  constructor(write) {
    this.write = write;
    this.rate = 12000;
    this.encoder = null;
  }
  accept(value) {
    if (value.type === "audio") {
      const supported = [
        8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000,
      ];
      const rate = Number(value.sampleRate);
      const nominal = supported.reduce((a, b) =>
        Math.abs(a - rate) < Math.abs(b - rate) ? a : b,
      );
      // Kiwi reports the measured ADC rate (e.g. 11998.9), while MPEG
      // requires the nearest nominal rate. Reject unrelated/invalid rates.
      if (!Number.isFinite(rate) || Math.abs(nominal - rate) / nominal > 0.01)
        throw new Error("Неподдерживаемая частота PCM");
      this.rate = nominal;
      return;
    }
    if (!(value instanceof Uint8Array) || value[0] !== 1) return;
    if (value.length < 3 || value.length % 2 !== 1) return;
    this.encoder ??= new lame.Mp3Encoder(1, this.rate, 64);
    const pcm = new Int16Array((value.length - 1) / 2);
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    for (let i = 0; i < pcm.length; i++)
      pcm[i] = view.getInt16(1 + i * 2, false);
    const bytes = this.encoder.encodeBuffer(pcm);
    if (bytes.length) this.write(Buffer.from(bytes));
  }
  finish() {
    if (!this.encoder) return;
    const bytes = this.encoder.flush();
    if (bytes.length) this.write(Buffer.from(bytes));
    this.encoder = null;
  }
}

export function installNativeAudio(
  app,
  catalog,
  catalogReady,
  {
    Session = KiwiSession,
    // Finish before Vercel terminates the invocation, allowing the page to
    // reconnect to fresh live PCM. Never loop/replay already buffered audio.
    lifetimeMs = process.env.NATIVE_AUDIO_SEGMENT_MS
      ? Math.min(
          240000,
          Math.max(5000, Number(process.env.NATIVE_AUDIO_SEGMENT_MS) || 240000),
        )
      : process.env.VERCEL
        ? 240000
        : 0,
  } = {},
) {
  const streams = new Map();
  app.get("/api/audio/tune", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const record = streams.get(String(req.query.session || ""));
    if (!record || record.closed)
      return res.status(404).json({ error: "Аудиосеанс завершён" });
    let tune;
    try {
      tune = audioTune(req.query);
    } catch {
      return res.status(400).json({ error: "Некорректная настройка эфира" });
    }
    if (tune.receiver !== record.receiver)
      return res.status(409).json({ error: "Приёмник изменён" });
    const sequence = Number(req.query.sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1)
      return res.status(400).json({ error: "Неверный порядок настройки" });
    if (sequence > record.sequence) {
      record.sequence = sequence;
      record.tune = tune;
      record.session?.apply(tune);
    }
    res.json({ ...record.tune, sequence: record.sequence });
  });
  app.get("/api/audio", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Accept-Ranges", "none");
    let tune;
    try {
      tune = audioTune(req.query);
    } catch {
      return res.status(400).json({ error: "Некорректная настройка эфира" });
    }
    await catalogReady;
    if (req.destroyed) return;
    const receiver = catalog.find(tune.receiver);
    if (!receiver)
      return res.status(404).json({ error: "Неизвестный приёмник" });
    const id = String(req.query.session || "");
    if (id && !/^[a-f0-9-]{36}$/i.test(id))
      return res.status(400).json({ error: "Неверный идентификатор аудио" });
    const record = {
      receiver: tune.receiver,
      tune,
      sequence: 0,
      closed: false,
      session: null,
      end: null,
    };
    if (id) {
      streams.get(id)?.end?.();
      streams.set(id, record);
    }
    function forget() {
      record.closed = true;
      if (id && streams.get(id) === record) streams.delete(id);
    }
    let finished = false,
      closing = false,
      timer,
      retry,
      session,
      attempts = 0;
    const encode = new MP3Stream((bytes) => {
      if (finished || res.destroyed) return;
      if (res.writableLength > 256 * 1024) {
        end();
        return;
      }
      res.write(bytes);
    });
    function end() {
      if (finished || closing) return;
      closing = true;
      forget();
      clearTimeout(timer);
      clearTimeout(retry);
      session?.close();
      encode.finish();
      finished = true;
      res.end();
    }
    record.end = end;
    res.on("close", () => {
      forget();
      finished = true;
      clearTimeout(timer);
      clearTimeout(retry);
      session?.close();
    });
    function start() {
      if (finished || res.destroyed) return;
      session = new Session(
        receiver.url,
        (value) => {
          if (finished) return;
          if (value.type === "error") {
            session?.close();
            if (value.retryable === false || ++attempts > 3) {
              end();
              return;
            }
            clearTimeout(retry);
            retry = setTimeout(start, Math.min(5000, attempts * 1000));
            return;
          }
          if (value instanceof Uint8Array && value[0] === 1) attempts = 0;
          try {
            encode.accept(value);
          } catch {
            end();
          }
        },
        { audioOnly: true },
      );
      record.session = session;
      session.start(record.tune);
    }
    res.setHeader("Content-Type", "audio/mpeg");
    res.flushHeaders();
    if (lifetimeMs) timer = setTimeout(end, lifetimeMs);
    start();
  });
}
