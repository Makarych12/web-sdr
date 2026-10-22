export type EqSettings = { enabled: boolean; bass: number; mid: number; treble: number };
export const EQ_PRESETS = {
  FLAT: { bass: 0, mid: 0, treble: 0 },
  VOICE: { bass: -6, mid: 0, treble: -3 },
  DX: { bass: -9, mid: 2, treble: -6 },
  MUSIC: { bass: 2, mid: -1, treble: 2 },
} as const;
export const DEFAULT_EQ: EqSettings = { enabled: false, ...EQ_PRESETS.FLAT };
export function validEq(value: unknown): value is EqSettings {
  const v = value as EqSettings;
  return !!v && typeof v.enabled === "boolean" && [v.bass, v.mid, v.treble].every(n => Number.isFinite(n) && n >= -12 && n <= 12);
}
/** Signal headroom, not an automatic loudness boost. Flat and OFF are unity. */
export function eqHeadroom(settings: EqSettings) {
  const positive = [settings.bass, settings.mid, settings.treble].reduce((sum, g) => sum + Math.max(0, g), 0);
  return settings.bass === 0 && settings.mid === 0 && settings.treble === 0 ? 1 : 10 ** (-(positive + 6) / 20);
}

/** Playback-only EQ. Connect output to the existing volume node; never to REC/FFT. */
export class AudioEq {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly bass: BiquadFilterNode;
  readonly mid: BiquadFilterNode;
  readonly treble: BiquadFilterNode;
  readonly preamp: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private connected = false;
  private detach: ReturnType<typeof setTimeout> | undefined;
  constructor(private context: BaseAudioContext, settings: EqSettings = DEFAULT_EQ) {
    this.input = context.createGain(); this.output = context.createGain();
    this.dry = context.createGain(); this.wet = context.createGain(); this.preamp = context.createGain();
    this.bass = context.createBiquadFilter(); this.bass.type = "lowshelf"; this.bass.frequency.value = 250;
    this.mid = context.createBiquadFilter(); this.mid.type = "peaking"; this.mid.frequency.value = 1250; this.mid.Q.value = 0.8;
    this.treble = context.createBiquadFilter(); this.treble.type = "highshelf"; this.treble.frequency.value = 3000;
    this.input.connect(this.dry).connect(this.output);
    this.preamp.connect(this.bass).connect(this.mid).connect(this.treble).connect(this.wet).connect(this.output);
    this.bass.gain.value = settings.bass; this.mid.gain.value = settings.mid; this.treble.gain.value = settings.treble;
    this.preamp.gain.value = eqHeadroom(settings);
    this.dry.gain.value = settings.enabled ? 0 : 1; this.wet.gain.value = settings.enabled ? 1 : 0;
    if (settings.enabled) this.attach();
  }
  private attach() { if (!this.connected) { this.input.connect(this.preamp); this.connected = true; } }
  update(settings: EqSettings) {
    if (!validEq(settings)) return;
    if (this.detach !== undefined) { clearTimeout(this.detach); this.detach = undefined; }
    const now = this.context.currentTime;
    const ramp = (param: AudioParam, target: number, seconds: number, start = now) => {
      param.cancelAndHoldAtTime(now);
      if (start > now) param.setValueAtTime(param.value, start);
      param.linearRampToValueAtTime(target, start + seconds);
    };
    // Establish safe headroom before raising any band; release after coefficients settle.
    const headroom = eqHeadroom(settings), previous = this.preamp.gain.value;
    ramp(this.preamp.gain, Math.min(previous, headroom), 0.008);
    this.preamp.gain.linearRampToValueAtTime(headroom, now + 0.07);
    ramp(this.bass.gain, settings.bass, 0.04, now + 0.01);
    ramp(this.mid.gain, settings.mid, 0.04, now + 0.01);
    ramp(this.treble.gain, settings.treble, 0.04, now + 0.01);
    if (settings.enabled) this.attach();
    ramp(this.dry.gain, settings.enabled ? 0 : 1, 0.05);
    ramp(this.wet.gain, settings.enabled ? 1 : 0, 0.05);
    if (!settings.enabled) {
      const deadline = now + 0.06;
      const detach = () => {
        if (this.context.state !== "running" || this.context.currentTime >= deadline) {
          // A suspended context is inaudible: resume directly into exact bypass.
          if (this.context.state !== "running") {
            this.dry.gain.cancelScheduledValues(this.context.currentTime);
            this.wet.gain.cancelScheduledValues(this.context.currentTime);
            this.dry.gain.setValueAtTime(1, this.context.currentTime);
            this.wet.gain.setValueAtTime(0, this.context.currentTime);
          }
          if (this.connected) this.input.disconnect(this.preamp);
          this.connected = false; this.detach = undefined;
        } else this.detach = setTimeout(detach, 100);
      };
      this.detach = setTimeout(detach, 80);
    }
  }
}
