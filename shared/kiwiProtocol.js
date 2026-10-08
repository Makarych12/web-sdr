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
  if (v.agc !== undefined) {
    if (!["fast", "slow", "off"].includes(v.agc))
      throw Error("Некорректный режим AGC");
    value.agc = v.agc;
  }
  return value;
}
let lastStamp = 0;
export class KiwiProtocol {
  constructor(url, emit, socketFactory, { audioOnly = false } = {}) {
    this.audioOnly = audioOnly;
    this.socketFactory = socketFactory;
    this.url = url;
    this.emit = emit;
    this.sockets = [];
    this.tune = { frequency: 10000, mode: "AM", zoom: 6 };
    this.bandwidth = 30000;
    this.maxZoom = 14;
    this.rate = 12000;
    this.closed = false;
    this.audioReady = false;
    this.waterfallReady = false;
    this.lastAudio = this.lastWaterfall = Date.now();
  }
  send(ws, s) {
    if (ws?.readyState === 1) ws.send(s);
  }
  start(tune) {
    this.tune = validateTune(tune);
    const stamp = (lastStamp = Math.max(Date.now(), lastStamp + 1));
    for (const type of this.audioOnly ? ["SND"] : ["SND", "W/F"]) {
      const u = new URL(this.url);
      u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
      u.pathname = `/ws/kiwi/${stamp}/${type}`;
      const ws = this.socketFactory(u);
      this.sockets.push(ws);
      ws.on("open", () => this.send(ws, "SET auth t=kiwi p="));
      ws.on("message", (data) => this.parse(ws, type, new Uint8Array(data)));
      ws.on("error", (e) =>
        this.fail(`${type}: ${e.message || "Ошибка подключения"}`),
      );
      ws.on("close", (code, reason) => {
        if (!this.closed)
          this.fail(
            `Kiwi ${type}: соединение закрыто (${code || 1006}) ${reason || ""}`,
          );
      });
    }
    this.timer = setInterval(() => {
      this.sockets.forEach((w) => this.send(w, "SET keepalive"));
      if (
        Date.now() -
          (this.audioOnly
            ? this.lastAudio
            : Math.min(this.lastAudio, this.lastWaterfall)) >
        20000
      )
        this.fail("Поток звука или waterfall прерван");
    }, 1000);
    this.timeout = setTimeout(
      () => this.fail("Нет данных от приёмника за 20 секунд"),
      20000,
    );
  }
  fail(message, code = "connection", retryable = true) {
    if (this.closed) return;
    this.emit({
      type: "error",
      message,
      code,
      retryable,
      audioSilenceMs: Date.now() - this.lastAudio,
      waterfallSilenceMs: Date.now() - this.lastWaterfall,
    });
    this.close();
  }
  parse(ws, type, b) {
    const text = new TextDecoder();
    const tag = text.decode(b.subarray(0, 3));
    const data = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (tag === "MSG") {
      for (const pair of text.decode(b.subarray(4)).trim().split(/\s+/)) {
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
        if (key === "zoom_max" || key === "zoom_cap") {
          this.maxZoom = Math.min(this.maxZoom, Number(val));
          this.emit({
            type: "limits",
            maxZoom: this.maxZoom,
            maxFrequency: this.bandwidth,
          });
        }
        if (key === "sample_rate") {
          this.rate = Number(val);
          this.send(ws, "SET compression=0");
          this.send(ws, "SET ident_user=UR4MTN-WebSDR");

          this.send(ws, "SET squelch=0 max=0");
          this.send(ws, "SET gen=0 mix=-1");
          this.audioReady = true;
          this.apply();
          this.emit({ type: "audio", sampleRate: this.rate });
        }
        if (key === "wf_setup") {
          this.send(ws, "SET wf_comp=0");
          this.send(ws, "SET maxdb=-10 mindb=-110");
          this.send(ws, "SET wf_speed=3");
          this.send(ws, "SET interp=13");
          this.waterfallReady = true;
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
      this.emit({ type: "signal", rssi: data.getUint16(8, false) / 10 - 127 });
      const packet = new Uint8Array(b.length - 10 + 1);
      packet[0] = 1;
      packet.set(b.subarray(10), 1);
      this.emit(packet);
    }
    if (tag === "W/F" && b.length >= 16) {
      clearTimeout(this.timeout);
      const flags = data.getUint32(8, true);
      if (flags & 0x10000 || b.length !== 1040) return;
      this.lastWaterfall = Date.now();
      this.emit({
        type: "view",
        bandwidth: this.bandwidth,
        zoom: flags & 0xffff,
        start: (data.getUint32(4, true) * this.bandwidth) / (1024 * 2 ** 14),
        span: this.bandwidth / 2 ** (flags & 0xffff),
        sequence: data.getUint32(12, true),
      });
      const packet = new Uint8Array(b.length - 15);
      packet[0] = 2;
      packet.set(b.subarray(16), 1);
      this.emit(packet);
    }
  }
  apply(tune = this.tune) {
    tune = this.tune = validateTune(tune);
    tune.zoom = Math.min(this.maxZoom, tune.zoom);
    const [mod, defaultLo, defaultHi] = modes[tune.mode];
    const lo = tune.lowCut ?? defaultLo,
      hi = tune.highCut ?? defaultHi;
    const audioCommand = `SET mod=${mod} low_cut=${lo} high_cut=${hi} freq=${tune.frequency.toFixed(3)}`;
    if (
      this.audioReady &&
      this.sockets[0]?.readyState === 1 &&
      this.lastAudioCommand !== audioCommand
    ) {
      this.send(this.sockets[0], audioCommand);
      this.lastAudioCommand = audioCommand;
    }
    const agc = tune.agc ?? "slow";
    const agcCommand = `SET agc=${agc === "off" ? 0 : 1} hang=0 thresh=-100 slope=6 decay=${agc === "fast" ? 100 : 1000} manGain=50`;
    if (
      this.audioReady &&
      this.sockets[0]?.readyState === 1 &&
      this.lastAgcCommand !== agcCommand
    ) {
      this.send(this.sockets[0], agcCommand);
      this.lastAgcCommand = agcCommand;
    }
    const viewCommand = `SET zoom=${tune.zoom} cf=${(tune.viewCenter ?? tune.frequency).toFixed(3)}`;
    if (
      this.waterfallReady &&
      this.sockets[1]?.readyState === 1 &&
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
      if (w.readyState === 0 && w.terminate) w.terminate();
      else w.close();
    });
  }
}
