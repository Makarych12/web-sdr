/* Independent mono IIR notch; FFT is a control signal only in AUTO. */
class DSPNotch extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.auto = false;
    this.frequency = 1000;
    this.width = 50;
    this.autoDepth = 9;
    this.banks = [new Float64Array(7), new Float64Array(7)];
    this.bankFrequency = new Float64Array(2);
    this.bankWidth = new Float64Array(2);
    this.active = 0;
    this.running = false;
    this.switching = false;
    this.bankMix = this.mix = 0;
    this.fadeStep = 1 / Math.max(1, Math.round(sampleRate * 0.04));
    this.size = 2048;
    this.mask = this.size - 1;
    this.ring = new Float32Array(this.size);
    this.real = new Float32Array(this.size);
    this.imag = new Float32Array(this.size);
    this.power = new Float32Array(this.size / 2 + 1);
    this.window = new Float32Array(this.size);
    this.reverse = new Uint16Array(this.size);
    this.cos = new Float32Array(this.size / 2);
    this.sin = new Float32Array(this.size / 2);
    for (let i = 0; i < this.size; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / this.size);
      let value = i, reversed = 0;
      for (let bit = 0; bit < 11; bit++) { reversed = (reversed << 1) | (value & 1); value >>= 1; }
      this.reverse[i] = reversed;
      if (i < this.size / 2) {
        this.cos[i] = Math.cos(2 * Math.PI * i / this.size);
        this.sin[i] = Math.sin(2 * Math.PI * i / this.size);
      }
    }
    this.analysisInterval = Math.round(sampleRate * 0.125);
    this.reported = null;
    this.resetAnalysis();
    this.port.onmessage = ({ data }) => {
      if (typeof data.enabled === "boolean" && data.enabled !== this.enabled) {
        this.enabled = data.enabled;
        this.resetAnalysis();
      }
      if (typeof data.auto === "boolean" && data.auto !== this.auto) {
        this.auto = data.auto;
        this.resetAnalysis();
      }
      if (Number.isFinite(data.frequency)) this.frequency = Math.max(100, Math.min(4000, data.frequency));
      if (Number.isFinite(data.width)) this.width = Math.max(10, Math.min(200, data.width));
      if (Number.isFinite(data.autoDepth)) this.autoDepth = Math.max(0, Math.min(18, data.autoDepth));
      if (data.reset) this.resetAnalysis();
    };
  }
  report(frequency) {
    if (frequency === null ? this.reported === null : this.reported !== null && Math.abs(frequency - this.reported) < 2) return;
    this.reported = frequency;
    this.port.postMessage({ type: "notch", frequency });
  }
  resetAnalysis() {
    this.write = this.filled = this.sinceAnalysis = 0;
    this.analysisLength = 0;
    this.candidate = this.candidateAge = this.missed = 0;
    this.locked = false;
    this.detected = 1000;
    this.report(null);
  }
  configure(index, frequency, width) {
    const omega = 2 * Math.PI * Math.min(frequency, sampleRate * 0.49) / sampleRate;
    const alpha = Math.sin(omega) / (2 * frequency / width);
    const bank = this.banks[index];
    bank[0] = bank[2] = 1 / (1 + alpha);
    bank[1] = bank[3] = -2 * Math.cos(omega) / (1 + alpha);
    bank[4] = (1 - alpha) / (1 + alpha);
    bank[5] = bank[6] = 0;
    this.bankFrequency[index] = frequency;
    this.bankWidth[index] = width;
  }
  filter(bank, input) {
    const output = bank[0] * input + bank[5];
    bank[5] = bank[1] * input - bank[3] * output + bank[6];
    bank[6] = bank[2] * input - bank[4] * output;
    return output;
  }
  beginAnalysis() {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      const j = this.reverse[i];
      this.real[j] = this.ring[(this.write + i) & this.mask] * this.window[i];
      this.imag[j] = 0;
    }
    this.analysisLength = 2;
  }
  analysisStep() {
    // One FFT stage per render block avoids an AUTO CPU burst on the audio thread.
    const n = this.size, length = this.analysisLength;
    const halfLength = length / 2, stride = n / length;
    for (let offset = 0; offset < halfLength; offset++) {
      const c = this.cos[offset * stride], s = -this.sin[offset * stride];
      for (let i = offset; i < n; i += length) {
        const j = i + halfLength;
        const r = this.real[j] * c - this.imag[j] * s;
        const m = this.real[j] * s + this.imag[j] * c;
        this.real[j] = this.real[i] - r; this.imag[j] = this.imag[i] - m;
        this.real[i] += r; this.imag[i] += m;
      }
    }
    this.analysisLength *= 2;
    if (this.analysisLength > n) { this.analysisLength = 0; this.analyse(); }
  }
  analyse() {
    const n = this.size, half = n / 2;
    for (let i = 0; i <= half; i++) this.power[i] = this.real[i] ** 2 + this.imag[i] ** 2;
    const first = Math.max(2, Math.floor(100 * n / sampleRate));
    const last = Math.min(half - 2, Math.ceil(4000 * n / sampleRate));
    let peak = first, total = 0;
    for (let i = first; i <= last; i++) {
      total += this.power[i];
      if (this.power[i] > this.power[peak]) peak = i;
    }
    let floor = 0, neighbours = 0;
    for (let offset = -12; offset <= 12; offset++) {
      const i = peak + offset;
      if (Math.abs(offset) < 3 || i < 1 || i >= half) continue;
      floor += this.power[i]; neighbours++;
    }
    floor /= Math.max(1, neighbours);
    const centre = this.power[peak];
    const narrowPower = this.power[peak - 1] + centre + this.power[peak + 1];
    // An audible narrow whistle can contain far less energy than broadband speech.
    let tonal = centre > Math.max(1e-8, floor * 32) && narrowPower > total * 0.02;
    // Reject a clear family of speech harmonics instead of notching its fundamental.
    let harmonics = 0;
    for (let multiple = 2; multiple <= 4; multiple++) {
      const bin = peak * multiple;
      if (bin > last - 1) break;
      if (Math.max(this.power[bin - 1], this.power[bin], this.power[bin + 1]) > Math.max(centre * 0.12, floor * 10)) harmonics++;
    }
    if (harmonics >= 2) tonal = false;
    if (tonal) {
      const left = Math.log(Math.max(1e-20, this.power[peak - 1]));
      const mid = Math.log(Math.max(1e-20, centre));
      const right = Math.log(Math.max(1e-20, this.power[peak + 1]));
      const denominator = left - 2 * mid + right;
      const delta = denominator === 0 ? 0 : Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / denominator));
      const frequency = Math.max(100, Math.min(4000, (peak + delta) * sampleRate / n));
      if (this.candidateAge > 0 && Math.abs(frequency - this.candidate) < Math.max(6, sampleRate / n * 0.35)) {
        this.candidate += (frequency - this.candidate) * 0.25;
        this.candidateAge += this.analysisInterval / sampleRate;
      } else {
        this.candidate = frequency;
        this.candidateAge = this.analysisInterval / sampleRate;
      }
      if (this.candidateAge >= 1) {
        this.locked = true;
        this.detected = this.candidate;
        this.missed = 0;
        this.report(this.detected);
        return;
      }
    } else this.candidateAge = 0;
    this.missed += this.analysisInterval / sampleRate;
    if (this.missed >= 0.5) { this.locked = false; this.report(null); }
  }
  process(inputs, outputs) {
    const source = inputs[0]?.[0], output = outputs[0]?.[0];
    if (!output) return true;
    if (!this.enabled && this.mix === 0) {
      this.running = false;
      if (source) output.set(source); else output.fill(0);
      return true;
    }
    const analyse = this.enabled && this.auto;
    const wanted = this.enabled && (!this.auto || this.locked);
    const frequency = this.auto ? this.detected : this.frequency;
    if (wanted && !this.running) {
      this.configure(this.active, frequency, this.width);
      this.running = true;
      this.switching = false;
    }
    if (wanted && !this.switching && (Math.abs(this.bankFrequency[this.active] - frequency) > 0.1 || this.bankWidth[this.active] !== this.width)) {
      this.configure(1 - this.active, frequency, this.width);
      this.bankMix = 0;
      this.switching = true;
    }
    const targetMix = wanted ? (this.auto ? 1 - 10 ** (-this.autoDepth / 20) : 1) : 0;
    for (let i = 0; i < output.length; i++) {
      const dry = source ? source[i] : 0;
      if (analyse) {
        this.ring[this.write] = dry;
        this.write = (this.write + 1) & this.mask;
        this.filled = Math.min(this.size, this.filled + 1);
        this.sinceAnalysis++;
      }
      if (!wanted && this.mix === 0) { output[i] = dry; this.running = false; continue; }
      let wet = this.filter(this.banks[this.active], dry);
      if (this.switching) {
        const next = this.filter(this.banks[1 - this.active], dry);
        this.bankMix = Math.min(1, this.bankMix + this.fadeStep);
        wet += this.bankMix * (next - wet);
        if (this.bankMix === 1) { this.active = 1 - this.active; this.switching = false; }
      }
      this.mix += Math.max(-this.fadeStep, Math.min(this.fadeStep, targetMix - this.mix));
      output[i] = this.mix === 0 ? dry : dry + this.mix * (wet - dry);
    }
    if (analyse) {
      if (this.analysisLength) this.analysisStep();
      else if (this.filled === this.size && this.sinceAnalysis >= this.analysisInterval) {
        this.sinceAnalysis = 0;
        this.beginAnalysis();
      }
    }
    return true;
  }
}
registerProcessor("dsp-notch", DSPNotch);
