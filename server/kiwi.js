import WebSocket from "ws";
import { publicLookup, isPublicAddress } from "./catalog.js";
export const modes = {
  AM: ["am", -5000, 5000],
  USB: ["usb", 300, 2700],
  LSB: ["lsb", -2700, -300],
  CW: ["cw", 400, 800],
  FM: ["nbfm", -6000, 6000],
};
export function validateTune(v) {
  if (
    !Number.isFinite(v.frequency) ||
    v.frequency < 0 ||
    v.frequency > 30000 ||
    !Object.hasOwn(modes, v.mode) ||
    !Number.isInteger(v.zoom) ||
    v.zoom < 0 ||
    v.zoom > 14
  )
    throw Error("Некорректная частота, режим или масштаб");
  const value = { frequency: v.frequency, mode: v.mode, zoom: v.zoom };
  if (v.lowCut !== undefined || v.highCut !== undefined) {
    if (
      !Number.isFinite(v.lowCut) ||
      !Number.isFinite(v.highCut) ||
      v.lowCut < -6000 ||
      v.highCut > 6000 ||
      v.highCut - v.lowCut < 50
    )
      throw Error("Некорректная полоса фильтра");
    value.lowCut = v.lowCut;
    value.highCut = v.highCut;
  }
  if (v.viewCenter !== undefined) {
    if (
      !Number.isFinite(v.viewCenter) ||
      v.viewCenter < 0 ||
      v.viewCenter > 32000
    )
      throw Error("Неверный центр waterfall");
    value.viewCenter = v.viewCenter;
  }
  return value;
}
let lastStamp = 0;
export class KiwiSession {
  constructor(url, emit) {
    this.url = url;
    this.emit = emit;
    this.sockets = [];
    this.tune = { frequency: 10000, mode: "AM", zoom: 6 };
    this.bandwidth = 30000;
    this.rate = 12000;
    this.closed = false;
    this.lastAudio = this.lastWaterfall = Date.now();
  }
  send(ws, s) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(s);
  }
  start(tune) {
    this.tune = validateTune(tune);
    const stamp = (lastStamp = Math.max(Date.now(), lastStamp + 1));
    for (const type of ["SND", "W/F"]) {
      const u = new URL(this.url);
      u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
      u.pathname = `/ws/kiwi/${stamp}/${type}`;
      const ws = new WebSocket(u, {
        handshakeTimeout: 10000,
        followRedirects: true,
        maxRedirects: 3,
        lookup: publicLookup,
      });
      ws.on("redirect", (url) => {
        const u = new URL(url);
        const host = u.hostname.replace(/^\[|\]$/g, "");
        if (
          !["ws:", "wss:"].includes(u.protocol) ||
          host === "localhost" ||
          host.endsWith(".local") ||
          (/^\d+\.\d+\.\d+\.\d+$/.test(host) && !isPublicAddress(host))
        )
          this.fail("Небезопасный адрес перенаправления приёмника");
      });
      this.sockets.push(ws);
      ws.on("open", () => this.send(ws, "SET auth t=kiwi p="));
      ws.on("message", (data) => this.parse(ws, type, Buffer.from(data)));
      ws.on("error", (e) => this.fail(`${type}: ${e.message}`));
      ws.on("close", () => {
        if (!this.closed) this.fail("Приёмник закрыл соединение");
      });
    }
    this.timer = setInterval(() => {
      this.sockets.forEach((w) => this.send(w, "SET keepalive"));
      if (Date.now() - Math.min(this.lastAudio, this.lastWaterfall) > 20000)
        this.fail("Поток звука или waterfall прерван");
    }, 1000);
    this.timeout = setTimeout(
      () => this.fail("Нет данных от приёмника за 20 секунд"),
      20000,
    );
  }
  fail(message, code = "connection", retryable = true) {
    if (this.closed) return;
    this.emit({ type: "error", message, code, retryable });
    this.close();
  }
  parse(ws, type, b) {
    const tag = b.toString("ascii", 0, 3);
    if (tag === "MSG") {
      for (const pair of b.toString("utf8", 4).trim().split(/\s+/)) {
        const [key, ...rest] = pair.split("=");
        const val = rest.join("=");
        if (
          key === "too_busy" ||
          key === "down" ||
          key === "inactivity_timeout" ||
          key === "ip_limit" ||
          key === "tlimit" ||
          (key === "badp" && val !== "0")
        )
          return this.fail(
            key === "too_busy"
              ? "Все каналы приёмника заняты. Выберите другой приёмник или повторите позже."
              : key === "badp"
                ? "Приёмник требует пароль или ограничивает доступ."
                : `Приёмник остановил сеанс: ${key}=${val}`,
            key,
            !["badp", "ip_limit", "tlimit", "inactivity_timeout"].includes(key),
          );
        if (key === "audio_rate")
          this.send(ws, `SET AR OK in=${Number(val)} out=44100`);
        if (key === "bandwidth") this.bandwidth = Number(val) / 1000;
        if (key === "zoom_max")
          this.emit({
            type: "limits",
            maxZoom: Math.min(14, Number(val)),
            maxFrequency: this.bandwidth,
          });
        if (key === "sample_rate") {
          this.rate = Number(val);
          this.send(ws, "SET compression=0");
          this.send(ws, "SET ident_user=Wave-WebSDR");
          this.send(
            ws,
            "SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50",
          );
          this.send(ws, "SET squelch=0 max=0");
          this.send(ws, "SET gen=0 mix=-1");
          this.apply();
          this.emit({ type: "audio", sampleRate: this.rate });
        }
        if (key === "wf_setup") {
          this.send(ws, "SET wf_comp=0");
          this.send(ws, "SET maxdb=-10 mindb=-110");
          this.send(ws, "SET wf_speed=3");
          this.send(ws, "SET interp=13");
          this.apply();
        }
        if (key === "audio_passband") {
          const [lowCut, highCut] = val.split(",").map(Number);
          if (Number.isFinite(lowCut) && Number.isFinite(highCut))
            this.emit({ type: "filter", lowCut, highCut });
        }
        if (key === "wf_cal")
          this.emit({ type: "calibration", value: Number(val) });
      }
      return;
    }
    if (tag === "SND" && b.length >= 10) {
      if (b[3] & 0x10) return;
      this.lastAudio = Date.now();
      clearTimeout(this.timeout);
      this.emit({ type: "signal", rssi: b.readUInt16BE(8) / 10 - 127 });
      const packet = Buffer.alloc(b.length - 10 + 1);
      packet[0] = 1;
      b.copy(packet, 1, 10);
      this.emit(packet);
    }
    if (tag === "W/F" && b.length >= 16) {
      clearTimeout(this.timeout);
      const flags = b.readUInt32LE(8);
      if (flags & 0x10000 || b.length !== 1040) return;
      this.lastWaterfall = Date.now();
      this.emit({
        type: "view",
        bandwidth: this.bandwidth,
        zoom: flags & 0xffff,
        start: (b.readUInt32LE(4) * this.bandwidth) / (1024 * 2 ** 14),
        span: this.bandwidth / 2 ** (flags & 0xffff),
        sequence: b.readUInt32LE(12),
      });
      this.emit(Buffer.concat([Buffer.from([2]), b.subarray(16)]));
    }
  }
  apply(tune = this.tune) {
    tune = this.tune = validateTune(tune);
    const [mod, defaultLo, defaultHi] = modes[tune.mode];
    const lo = tune.lowCut ?? defaultLo,
      hi = tune.highCut ?? defaultHi;
    const audioCommand = `SET mod=${mod} low_cut=${lo} high_cut=${hi} freq=${tune.frequency.toFixed(3)}`;
    if (
      this.sockets[0]?.readyState === WebSocket.OPEN &&
      this.lastAudioCommand !== audioCommand
    ) {
      this.send(this.sockets[0], audioCommand);
      this.lastAudioCommand = audioCommand;
    }
    const viewCommand = `SET zoom=${tune.zoom} cf=${(tune.viewCenter ?? tune.frequency).toFixed(3)}`;
    if (
      this.sockets[1]?.readyState === WebSocket.OPEN &&
      this.lastViewCommand !== viewCommand
    ) {
      this.send(this.sockets[1], viewCommand);
      this.lastViewCommand = viewCommand;
    }
    this.emit({ type: "tuned", ...tune });
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    clearTimeout(this.timeout);
    this.sockets.forEach((w) => {
      if (w.readyState === WebSocket.CONNECTING) w.terminate();
      else w.close();
    });
  }
}
