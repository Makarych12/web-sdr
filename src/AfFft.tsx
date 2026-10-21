import { useEffect, useRef, useState, type MutableRefObject } from "react";

export type AfInput = ((samples: Float32Array, sampleRate: number) => void) | null;
const SIZE = 2048;

/** Analysis only: the playback samples are never modified or retained. */
export class AudioSpectrum {
  private ring = new Float32Array(SIZE);
  private real = new Float32Array(SIZE);
  private imag = new Float32Array(SIZE);
  private window = Float32Array.from({ length: SIZE }, (_, i) =>
    0.5 - 0.5 * Math.cos(2 * Math.PI * i / (SIZE - 1)));
  private position = 0;
  readonly bins = new Float32Array(SIZE / 2 + 1).fill(-100);
  sampleRate = 12000;
  push(samples: Float32Array, sampleRate: number) {
    if (!samples.length || sampleRate !== this.sampleRate) {
      this.ring.fill(0);
      this.bins.fill(-100);
      this.position = 0;
    }
    this.sampleRate = sampleRate;
    for (const sample of samples) {
      this.ring[this.position] = sample;
      this.position = (this.position + 1) % SIZE;
    }
  }
  transform() {
    const { real, imag } = this;
    for (let i = 0, j = 0; i < SIZE; i++) {
      real[j] = this.ring[(this.position + i) % SIZE] * this.window[i];
      imag[j] = 0;
      let bit = SIZE >> 1;
      while (j & bit) { j ^= bit; bit >>= 1; }
      j ^= bit;
    }
    for (let length = 2; length <= SIZE; length *= 2) {
      const half = length / 2;
      for (let offset = 0; offset < half; offset++) {
        const angle = -2 * Math.PI * offset / length;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        for (let i = offset; i < SIZE; i += length) {
          const j = i + half;
          const r = real[j] * cos - imag[j] * sin;
          const m = real[j] * sin + imag[j] * cos;
          real[j] = real[i] - r; imag[j] = imag[i] - m;
          real[i] += r; imag[i] += m;
        }
      }
    }
    for (let i = 0; i < this.bins.length; i++) {
      const db = Math.max(-100, 20 * Math.log10(Math.max(1e-5,
        Math.hypot(real[i], imag[i]) * (i === 0 ? 2 : 4) / SIZE)));
      this.bins[i] += (db - this.bins[i]) * 0.45;
    }
    return this.bins;
  }
}

function SpectrumCanvas({ input }: { input: MutableRefObject<AfInput> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const model = new AudioSpectrum();
    const receive = (samples: Float32Array, sampleRate: number) => model.push(samples, sampleRate);
    input.current = receive;
    const element = canvas.current!;
    const ctx = element.getContext("2d")!;
    let frame = 0, last = -Infinity;
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      // Approximately 30–60 FPS, independent of the monitor refresh rate.
      if (time - last < 1000 / 60 - 1) return;
      last = time;
      const width = element.clientWidth, height = element.clientHeight;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      if (element.width !== Math.round(width * dpr) || element.height !== Math.round(height * dpr)) {
        element.width = Math.round(width * dpr);
        element.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#07121e";
      ctx.fillRect(0, 0, width, height);
      const left = 8, right = width - 12, top = 8, bottom = height - 20;
      ctx.font = "10px monospace";
      ctx.strokeStyle = "#20364c";
      ctx.fillStyle = "#9eb4cc";
      for (let khz = 0; khz <= 4; khz++) {
        const x = left + (right - left) * khz / 4;
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
        ctx.textAlign = khz === 0 ? "left" : khz === 4 ? "right" : "center";
        ctx.fillText(khz === 4 ? "4 kHz" : String(khz), x, height - 5);
      }
      const bins = model.transform();
      ctx.beginPath();
      const end = Math.min(bins.length - 1, Math.floor(4000 * SIZE / model.sampleRate));
      for (let i = 0; i <= end; i++) {
        const x = left + (right - left) * (i * model.sampleRate / SIZE) / 4000;
        const y = bottom - Math.max(0, Math.min(1, (bins[i] + 100) / 100)) * (bottom - top);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "#76e4ff";
      ctx.lineWidth = 1;
      ctx.shadowColor = "#44caff";
      ctx.shadowBlur = 4;
      ctx.stroke();
      ctx.shadowBlur = 0;
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      if (input.current === receive) input.current = null;
    };
  }, [input]);
  return <canvas ref={canvas} aria-label="Аудиоспектр от 0 до 4 кГц" role="img" />;
}

export function AfFft({ input }: { input: MutableRefObject<AfInput> }) {
  const [enabled, setEnabled] = useState(false);
  return <div className="af-fft">
    <button type="button" aria-label="AF-FFT" aria-pressed={enabled}
      onClick={() => setEnabled(!enabled)}>AF-FFT</button>
    {enabled && <div className="af-fft-display"><SpectrumCanvas input={input} /></div>}
  </div>;
}
