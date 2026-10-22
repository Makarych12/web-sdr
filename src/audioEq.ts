export type EqSettings = { enabled: boolean; bass: number; mid: number; treble: number };
export const EQ_PRESETS = {
  FLAT: { bass: 0, mid: 0, treble: 0 },
  VOICE: { bass: -6, mid: 3, treble: 1 },
  DX: { bass: -12, mid: 5, treble: -6 },
  MUSIC: { bass: 3, mid: -1, treble: 3 },
} as const;
export const DEFAULT_EQ: EqSettings = { enabled: false, ...EQ_PRESETS.FLAT };
export function validEq(value: unknown): value is EqSettings {
  const v = value as EqSettings;
  return !!v && typeof v.enabled === "boolean" && [v.bass, v.mid, v.treble].every(n => Number.isFinite(n) && n >= -12 && n <= 12);
}
export const EQ_BANDS = { bass: 300, mid: 1650, treble: 2600, q: 0.9 } as const;
/** RBJ coefficients match native shelf S=1 and peaking Q; used only for headroom. */
function coefficients(kind: 'bass'|'mid'|'treble', gain: number, rate: number) {
  const A=10**(gain/40),w=2*Math.PI*EQ_BANDS[kind]/rate,c=Math.cos(w),sin=Math.sin(w);
  const alpha=sin/(2*EQ_BANDS.q),s=Math.SQRT2*sin*Math.sqrt(A);
  let b:number[],a:number[];
  if(kind==='mid'){b=[1+alpha*A,-2*c,1-alpha*A];a=[1+alpha/A,-2*c,1-alpha/A];}
  else if(kind==='bass'){b=[A*((A+1)-(A-1)*c+s),2*A*((A-1)-(A+1)*c),A*((A+1)-(A-1)*c-s)];a=[(A+1)+(A-1)*c+s,-2*((A-1)+(A+1)*c),(A+1)+(A-1)*c-s];}
  else {b=[A*((A+1)+(A-1)*c+s),-2*A*((A-1)+(A+1)*c),A*((A+1)+(A-1)*c-s)];a=[(A+1)-(A-1)*c+s,2*((A-1)-(A+1)*c),(A+1)-(A-1)*c-s];}
  return {b,a};
}
export function eqHeadroom(settings: EqSettings, rate=48000) {
  if(settings.bass===0&&settings.mid===0&&settings.treble===0)return 1;
  const filters=(['bass','mid','treble'] as const).map(k=>coefficients(k,settings[k],rate));
  let peak=0;
  for(let i=0;i<=512;i++){
    const f=i===0?0:i===512?rate/2:20*(rate/40)**(i/512),w=2*Math.PI*f/rate;
    let magnitude=1;
    for(const {b,a} of filters){
      const norm=(v:number[])=>Math.hypot(v[0]+v[1]*Math.cos(w)+v[2]*Math.cos(2*w),v[1]*Math.sin(w)+v[2]*Math.sin(2*w));
      magnitude*=norm(b)/norm(a);
    }
    peak=Math.max(peak,magnitude);
  }
  // Compensate the actual cascade peak, not the sum of unrelated band boosts.
  // 1.5 dB transient reserve; never boost overall level automatically.
  return Math.min(1,10**(-1.5/20)/Math.max(peak,1e-12));
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
    this.bass = context.createBiquadFilter(); this.bass.type = "lowshelf"; this.bass.frequency.value = EQ_BANDS.bass;
    this.mid = context.createBiquadFilter(); this.mid.type = "peaking"; this.mid.frequency.value = EQ_BANDS.mid; this.mid.Q.value = EQ_BANDS.q;
    this.treble = context.createBiquadFilter(); this.treble.type = "highshelf"; this.treble.frequency.value = EQ_BANDS.treble;
    this.input.connect(this.dry).connect(this.output);
    this.preamp.connect(this.bass).connect(this.mid).connect(this.treble).connect(this.wet).connect(this.output);
    this.bass.gain.value = settings.bass; this.mid.gain.value = settings.mid; this.treble.gain.value = settings.treble;
    this.preamp.gain.value = eqHeadroom(settings,context.sampleRate);
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
    const headroom = eqHeadroom(settings,this.context.sampleRate), previous = this.preamp.gain.value;
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
