/* Mono Wiener NR. Runs only in the existing playback AudioContext. */
class WienerNR extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 1024;
    this.hop = this.size / 2;
    this.mask = this.size - 1;
    this.input = new Float32Array(this.size);
    this.overlap = new Float32Array(this.size * 2);
    this.real = new Float32Array(this.size);
    this.imag = new Float32Array(this.size);
    this.window = new Float32Array(this.size);
    this.reverse = new Uint16Array(this.size);
    this.cos = new Float32Array(this.hop);
    this.sin = new Float32Array(this.hop);
    this.power = new Float32Array(this.hop + 1);
    this.noise = new Float32Array(this.hop + 1);
    this.minimum = new Float32Array(this.hop + 1);
    this.previousPower = new Float32Array(this.hop + 1);
    this.desiredGain = new Float32Array(this.hop + 1);
    this.gain = new Float32Array(this.hop + 1).fill(1);
    for (let i = 0; i < this.size; i++) {
      // Periodic sqrt-Hann gives unity overlap-add with a 50% hop.
      this.window[i] = Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / this.size));
      let value = i, reversed = 0;
      for (let bit = 0; bit < 10; bit++) {
        reversed = (reversed << 1) | (value & 1);
        value >>= 1;
      }
      this.reverse[i] = reversed;
      if (i < this.hop) {
        this.cos[i] = Math.cos(2 * Math.PI * i / this.size);
        this.sin[i] = Math.sin(2 * Math.PI * i / this.size);
      }
    }
    this.enabled = false;
    this.strength = 0.4;
    this.amount = this.strength;
    this.mix = 0;
    this.fadeStep = 1 / Math.max(1, Math.round(sampleRate * 0.05));
    this.minimumPeriod = Math.max(1, Math.round(sampleRate * 0.5 / this.hop));
    this.working = false;
    this.clear();
    this.port.onmessage = ({ data }) => {
      if (typeof data.enabled === "boolean") this.enabled = data.enabled;
      if (Number.isFinite(data.strength)) this.strength = Math.max(0, Math.min(1, data.strength));
      if (data.reset) {
        // Keep overlap and gain continuity; only the noise estimate is invalidated.
        this.noiseReady = false;
        this.bootstrapFrames = 0;
        this.minimumFrames = 0;
      }
    };
  }
  clear() {
    this.input.fill(0);
    this.overlap.fill(0);
    this.gain.fill(1);
    this.previousPower.fill(0);
    this.write = this.read = this.pending = this.samples = 0;
    this.noiseReady = false;
    this.bootstrapFrames = 0;
    this.minimumFrames = 0;
  }
  fft(inverse) {
    const n = this.size, real = this.real, imag = this.imag;
    for (let i = 0; i < n; i++) {
      const j = this.reverse[i];
      if (j <= i) continue;
      const r = real[i], m = imag[i];
      real[i] = real[j]; imag[i] = imag[j];
      real[j] = r; imag[j] = m;
    }
    for (let length = 2; length <= n; length *= 2) {
      const half = length / 2, stride = n / length;
      for (let offset = 0; offset < half; offset++) {
        const c = this.cos[offset * stride];
        const s = this.sin[offset * stride] * (inverse ? 1 : -1);
        for (let i = offset; i < n; i += length) {
          const j = i + half;
          const r = real[j] * c - imag[j] * s;
          const m = real[j] * s + imag[j] * c;
          real[j] = real[i] - r; imag[j] = imag[i] - m;
          real[i] += r; imag[i] += m;
        }
      }
    }
  }
  frame() {
    const n = this.size, half = this.hop;
    let energy = 0;
    for (let i = 0; i < n; i++) {
      const value = this.input[(this.write + i) & this.mask] * this.window[i];
      this.real[i] = value;
      this.imag[i] = 0;
      energy += value * value;
    }
    this.fft(false);
    if (this.enabled && this.strength > 0) this.amount += (this.strength - this.amount) * 0.2;
    const initialise = !this.noiseReady && this.samples >= n && energy > 1e-10;
    const updateMinimum = ++this.minimumFrames >= this.minimumPeriod;
    // Bound attenuation of weak consonants and phrase endings. A 24 dB
    // floor plus slow decision-directed attack risked masking low-SNR speech.
    const floor = 10 ** (-(4 + 10 * this.amount) / 20);
    for (let i = 0; i <= half; i++) {
      const p = this.real[i] * this.real[i] + this.imag[i] * this.imag[i];
      if (initialise) {
        this.power[i] = this.minimum[i] = p;
        this.noise[i] = p;
        this.previousPower[i] = 0;
      } else if (this.noiseReady) {
        this.power[i] += 0.2 * (p - this.power[i]);
        this.minimum[i] = Math.min(this.minimum[i], this.power[i]);
        if (this.bootstrapFrames < 16) {
          // A single periodogram has deep random nulls. Average the first ~170 ms.
          this.noise[i] += (p - this.noise[i]) / (this.bootstrapFrames + 1);
          this.minimum[i] = this.power[i];
        } else if (updateMinimum) {
          const estimate = Math.max(1e-12, this.minimum[i] * 2.0);
          // Limit upward adaptation, rather than freezing forever after a noise jump.
          const target = Math.min(estimate, this.noise[i] * 1.5 + 1e-12);
          this.noise[i] += 0.3 * (target - this.noise[i]);
          this.minimum[i] = this.power[i];
        } else if (this.power[i] < this.noise[i]) {
          this.noise[i] += 0.04 * (this.power[i] - this.noise[i]);
        }
      }
      // Decision-directed a priori SNR: retain coherent speech, suppress random
      // periodogram peaks rather than treating each noise peak as new speech.
      const noise = Math.max(this.noise[i], 1e-12);
      const posterior = p / noise;
      const prior = 0.90 * this.previousPower[i] / noise +
        0.10 * Math.max(0, posterior - 1);
      const suppression = 1 + 0.75 * this.amount;
      this.desiredGain[i] = this.noiseReady || initialise
        ? Math.max(floor, prior / (prior + suppression)) : 1;
    }
    if (initialise) this.noiseReady = true;
    if (this.noiseReady && this.bootstrapFrames < 16) this.bootstrapFrames++;
    if (updateMinimum || initialise) this.minimumFrames = 0;
    for (let i = 0; i <= half; i++) {
      const target = 0.25 * this.desiredGain[Math.max(0, i - 1)] +
        0.5 * this.desiredGain[i] + 0.25 * this.desiredGain[Math.min(half, i + 1)];
      this.gain[i] += (target - this.gain[i]) * (target > this.gain[i] ? 0.75 : 0.12);
      // Store this frame's enhanced power, after updating the actual gain.
      this.previousPower[i] = (this.real[i] ** 2 + this.imag[i] ** 2) * this.gain[i] ** 2;
      this.real[i] *= this.gain[i]; this.imag[i] *= this.gain[i];
      if (i > 0 && i < half) {
        this.real[n - i] *= this.gain[i]; this.imag[n - i] *= this.gain[i];
      }
    }
    this.fft(true);
    for (let i = 0; i < n; i++)
      this.overlap[(this.read + i) & (n * 2 - 1)] += this.real[i] * this.window[i] / n;
  }
  process(inputs, outputs) {
    const source = inputs[0]?.[0], output = outputs[0]?.[0];
    if (!output) return true;
    const wanted = this.enabled && this.strength > 0;
    if (!wanted && this.mix === 0) {
      if (this.working) { this.clear(); this.working = false; }
      // Exact zero-latency bypass: no FFT, buffering or gain operations.
      if (source) output.set(source); else output.fill(0);
      return true;
    }
    if (!this.working) { this.clear(); this.working = true; this.amount = this.strength; }
    for (let i = 0; i < output.length; i++) {
      const dry = source ? source[i] : 0;
      if (!wanted && this.mix === 0) { output[i] = dry; continue; }
      this.input[this.write] = dry;
      this.write = (this.write + 1) & this.mask;
      const wet = this.overlap[this.read];
      this.overlap[this.read] = 0;
      this.read = (this.read + 1) & (this.size * 2 - 1);
      this.samples++;
      if (++this.pending === this.hop) { this.pending = 0; this.frame(); }
      const targetMix = wanted && this.samples > this.size ? 1 : 0;
      this.mix += Math.max(-this.fadeStep, Math.min(this.fadeStep, targetMix - this.mix));
      output[i] = this.mix === 0 ? dry : dry + this.mix * (wet - dry);
    }
    return true;
  }
}
registerProcessor("wiener-nr", WienerNR);
