import { ScanVoiceActivity } from "./scanVoiceActivity";
export type ScanConfig = { start: number; end: number; step: number; squelch: number; dwell: number; activity?: "ALL" | "VOICE" };
export type ScanState = {
  phase: "STOP" | "WAIT" | "SCAN" | "HOLD";
  frequency: number | null;
  found: { frequency: number; rssi: number }[];
  skipped: number[];
  message: string;
  max: number | null;
};
type Options = {
  bounds: () => { min: number; max: number };
  tune: (frequency: number) => void;
  changed: (state: ScanState) => void;
  now?: () => number;
};

/** One VFO, driven by existing tune notifications and incoming RSSI events. */
export class FrequencyScanner {
  phase: ScanState["phase"] = "STOP";
  frequency: number | null = null;
  private config: ScanConfig | null = null;
  private found = new Map<number, number>();
  private skipped = new Set<number>();
  private limit: number | null = null;
  private sentAt = 0;
  private acknowledgedAt: number | null = null;
  private fresh = 0;
  private lastSignal = 0;
  private quietSince: number | null = null;
  private message = "";
  private voice: ScanVoiceActivity | null = null;
  private lastRssi = -Infinity;
  private peakRssi = -Infinity;
  private peakAt = 0;
  private lastAudio = 0;
  private readonly settleMs = 400;
  constructor(private options: Options) {}
  private now() { return this.options.now?.() ?? performance.now(); }
  private publish() {
    this.options.changed({ phase: this.phase, frequency: this.frequency,
      found: Array.from(this.found, ([frequency, rssi]) => ({ frequency, rssi })),
      skipped: [...this.skipped], message: this.message, max: this.limit });
  }
  limits(max: number) {
    if (!Number.isFinite(max) || max <= 0 || this.limit === max) return;
    this.limit = max;
    if (this.config && this.phase !== "STOP" && !this.inBounds(this.config))
      this.stop("Диапазон вне границ приёмника");
    else this.publish();
  }
  reset() {
    this.limit = null;
    this.stop();
  }
  private inBounds(config: ScanConfig) {
    const bounds = this.options.bounds();
    return this.limit !== null && config.start >= bounds.min &&
      config.end <= Math.min(bounds.max, this.limit, 30000);
  }
  start(config: ScanConfig) {
    if (![config.start, config.end, config.step, config.squelch, config.dwell].every(Number.isFinite) ||
      config.start > config.end || ![1, 5, 10, 25].includes(config.step) ||
      config.dwell < 0.5 || config.dwell > 5 || config.squelch < -140 || config.squelch > 0 ||
      !this.inBounds(config) || (config.activity !== undefined && !["ALL", "VOICE"].includes(config.activity))) {
      this.stop("Проверьте START / END и доступный диапазон приёмника");
      return;
    }
    this.config = { ...config };
    this.found.clear();
    this.message = "";
    this.move(config.start);
  }
  stop(message = "") {
    this.phase = "STOP";
    this.voice = null;
    this.message = message;
    this.publish();
  }
  private move(candidate: number) {
    const c = this.config!;
    if (!this.inBounds(c)) { this.stop("Диапазон вне границ приёмника"); return; }
    const count = Math.floor((c.end - c.start) / c.step + 1e-9) + 1;
    let index = Math.round((candidate - c.start) / c.step) % count;
    for (let checked = 0; checked < count; checked++, index = (index + 1) % count) {
      const frequency = Math.round((c.start + index * c.step) * 1000) / 1000;
      if (this.skipped.has(frequency)) continue;
      this.frequency = frequency;
      this.phase = "WAIT";
      this.acknowledgedAt = null;
      this.fresh = 0;
      this.voice = c.activity === "VOICE" ? new ScanVoiceActivity() : null;
      this.lastRssi = this.peakRssi = -Infinity;
      this.lastAudio = 0;
      this.quietSince = null;
      this.sentAt = this.lastSignal = this.now();
      this.publish();
      this.options.tune(frequency);
      return;
    }
    this.stop("Все частоты диапазона пропущены");
  }
  tuned(frequency: number) {
    if (this.phase !== "WAIT" || frequency !== this.frequency || this.acknowledgedAt !== null) return;
    this.acknowledgedAt = this.now();
  }
  signal(rssi: number) {
    if (this.phase === "STOP" || !Number.isFinite(rssi)) return;
    const now = this.now(), c = this.config!;
    this.lastSignal = now;
    if (this.acknowledgedAt === null || now - this.acknowledgedAt < this.settleMs) return;
    this.lastRssi = rssi;
    if (rssi >= this.peakRssi || now - this.peakAt > 250) { this.peakRssi = rssi; this.peakAt = now; }
    this.fresh++;
    if (c.activity !== "VOICE") this.evaluate();
  }
  audio(samples: Float32Array, rate: number, lowCut: number, highCut: number) {
    if (this.phase === "STOP" || !this.voice || this.acknowledgedAt === null ||
      this.now() - this.acknowledgedAt < this.settleMs) return;
    this.lastAudio = this.now();
    this.voice.push(samples, rate, lowCut, highCut);
    this.evaluate();
  }
  private evaluate() {
    if (this.fresh < 2 || this.acknowledgedAt === null) return;
    const now = this.now(), c = this.config!;
    if (now - this.lastSignal > 200) return;
    if (this.skipped.has(this.frequency!)) { this.move(this.frequency! + c.step); return; }
    const voiceMode = c.activity === "VOICE";
    const rssi = voiceMode && now - this.peakAt <= 250 ? this.peakRssi : this.lastRssi;
    const audioActive = !voiceMode || (this.voice!.active && now - this.lastAudio < 200);
    const threshold = this.phase === "HOLD" ? c.squelch - 3 : c.squelch;
    if (rssi >= threshold && audioActive) {
      const old = this.found.get(this.frequency!);
      this.found.set(this.frequency!, Math.max(old ?? -Infinity, rssi));
      this.quietSince = null;
      if (this.phase !== "HOLD" || old === undefined || rssi > old) {
        this.phase = "HOLD";
        this.publish();
      }
      return;
    }
    if (this.phase === "HOLD") {
      // Hysteresis and a quiet dwell prevent chatter around the threshold.
      if (!voiceMode && rssi > c.squelch - 3) { this.quietSince = null; return; }
      this.quietSince ??= now;
      if (now - this.quietSince < c.dwell * 1000) return;
    } else {
      if (this.phase === "WAIT") { this.phase = "SCAN"; this.publish(); }
      // DWELL is observation time after settling, not time spent waiting for tuning.
      if (now - this.acknowledgedAt - this.settleMs < c.dwell * 1000) return;
    }
    this.move(this.frequency! + c.step);
  }
  tick() {
    if (this.phase === "STOP") return;
    const now = this.now();
    if ((this.acknowledgedAt === null && now - this.sentAt > 5000) ||
      now - this.lastSignal > 5000 ||
      (this.config?.activity === "VOICE" && now - (this.lastAudio || this.sentAt) > 5000))
      this.stop("Нет подтверждения настройки или свежего RSSI");
  }
  skip(frequency: number) {
    this.skipped.add(frequency);
    if (this.phase !== "STOP" && this.frequency === frequency &&
      this.acknowledgedAt !== null && this.fresh >= 2)
      this.move(frequency + this.config!.step);
    else this.publish();
  }
  unskip(frequency: number) { this.skipped.delete(frequency); this.publish(); }
}
