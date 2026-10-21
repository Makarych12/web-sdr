/** Conservative speech-band activity heuristic, not speech recognition. */
export class ScanVoiceActivity {
  private readonly size = 512;
  private ring = new Float32Array(512);
  private real = new Float32Array(512);
  private imag = new Float32Array(512);
  private window = Float32Array.from({ length: 512 }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / 512));
  private envelopes = new Float32Array(12);
  private votes = new Uint8Array(8);
  private position = 0;
  private filled = 0;
  private pending = 0;
  private frames = 0;
  private rate = 0;
  private low = 0;
  private high = 0;
  active = false;
  push(samples: Float32Array, rate: number, lowCut: number, highCut: number) {
    const low = lowCut >= 0 ? lowCut : highCut <= 0 ? -highCut : 0;
    const high = Math.max(Math.abs(lowCut), Math.abs(highCut));
    if (rate !== this.rate || low !== this.low || high !== this.high) {
      this.position = this.filled = this.pending = this.frames = 0;
      this.envelopes.fill(0); this.votes.fill(0); this.active = false;
      this.rate = rate; this.low = low; this.high = high;
    }
    for (const sample of samples) {
      this.ring[this.position] = sample;
      this.position = (this.position + 1) & 511;
      this.filled = Math.min(this.size, this.filled + 1);
      if (++this.pending >= 256 && this.filled === this.size) {
        this.pending = 0;
        this.analyse();
      }
    }
  }
  private analyse() {
    const n = this.size, real = this.real, imag = this.imag;
    for (let i = 0, j = 0; i < n; i++) {
      real[j] = this.ring[(this.position + i) & 511] * this.window[i];
      imag[j] = 0;
      let bit = n >> 1;
      while (j & bit) { j ^= bit; bit >>= 1; }
      j ^= bit;
    }
    for (let length = 2; length <= n; length *= 2) {
      const half = length / 2;
      for (let offset = 0; offset < half; offset++) {
        const angle = -2 * Math.PI * offset / length;
        const c = Math.cos(angle), s = Math.sin(angle);
        for (let i = offset; i < n; i += length) {
          const j = i + half;
          const r = real[j] * c - imag[j] * s, m = real[j] * s + imag[j] * c;
          real[j] = real[i] - r; imag[j] = imag[i] - m;
          real[i] += r; imag[i] += m;
        }
      }
    }
    // Exclude the selected filter's skirts, which otherwise make noise look tonal.
    const first = Math.max(1, Math.ceil(Math.max(250, this.low + 30) * n / this.rate));
    const last = Math.min(n / 2 - 1, Math.floor(Math.min(3200, this.high - 80) * n / this.rate));
    if (last - first < 40) { this.active = false; return; }
    let total = 0, logPower = 0, peak = 0, peakBin = first;
    let band0 = 0, band1 = 0, band2 = 0, band3 = 0;
    for (let i = first; i <= last; i++) {
      const p = real[i] * real[i] + imag[i] * imag[i];
      imag[i] = p;
      total += p; logPower += Math.log(Math.max(1e-18, p));
      if (p > peak) { peak = p; peakBin = i; }
      const band = Math.min(3, Math.floor((i - first) * 4 / (last - first + 1)));
      if (band === 0) band0 += p; else if (band === 1) band1 += p; else if (band === 2) band2 += p; else band3 += p;
    }
    const narrow = imag[Math.max(first, peakBin - 1)] + peak + imag[Math.min(last, peakBin + 1)];
    const flatness = Math.exp(logPower / (last - first + 1)) / Math.max(1e-18, total / (last - first + 1));
    const bands = Number(band0 > total * 0.1) + Number(band1 > total * 0.1) + Number(band2 > total * 0.1) + Number(band3 > total * 0.1);
    this.envelopes[this.frames % this.envelopes.length] = Math.sqrt(total) / n;
    const count = Math.min(this.frames + 1, this.envelopes.length);
    let min = Infinity, max = 0;
    for (let i = 0; i < count; i++) { min = Math.min(min, this.envelopes[i]); max = Math.max(max, this.envelopes[i]); }
    const modulation = (max - min) / Math.max(1e-12, max + min);
    const candidate = count >= 6 && total / (n * n) > 1e-10 && bands >= 2 &&
      narrow / Math.max(1e-18, total) < 0.6 && flatness > 0.015 && flatness < 0.45 && modulation > 0.16;
    this.votes[this.frames % this.votes.length] = Number(candidate);
    let votes = 0;
    for (const vote of this.votes) votes += vote;
    this.active = votes >= 3;
    this.frames++;
  }
}
