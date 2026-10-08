import { projectView, sameView, type SpectrumView } from "./spectrumView";

// Calibrated Kiwi power only: gamma expands weak signals without inventing bins.
export function waterfallColor(bin: number, calibration: number): number[] {
  const stops = [
    [0, 5, 10, 26],
    [0.13, 29, 20, 76],
    [0.3, 49, 55, 158],
    [0.46, 31, 133, 219],
    [0.62, 44, 207, 219],
    [0.76, 112, 224, 139],
    [0.9, 255, 194, 79],
    [1, 255, 245, 207],
  ];
  const power = Math.max(0, Math.min(1, (bin - 255 + calibration + 115) / 90));
  const t = power ** 0.72;
  const index = stops.findIndex((stop) => stop[0] >= t);
  const high = stops[Math.max(1, index)],
    low = stops[Math.max(1, index) - 1];
  const mix = (t - low[0]) / (high[0] - low[0]);
  return [1, 2, 3]
    .map((channel) =>
      Math.round(low[channel] + (high[channel] - low[channel]) * mix),
    )
    .concat(255);
}
/** Owns drawing and history; React changes never resize or replace the canvases. */
export class SpectrumRenderer {
  private history = document.createElement("canvas");
  private strip: ImageData;
  private rows: SpectrumView[] = [];
  private last?: { bins: Uint8Array; view: SpectrumView };
  private view: SpectrumView;
  private frame = 0;
  private palette = new Uint8ClampedArray(256 * 4);
  private calibration = NaN;
  private motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private scrollFrom = 0;
  private scrollAt = 0;
  private rowHeight = 2;
  private motionChanged = () => {
    this.scrollFrom = 0;
    this.schedule();
  };
  frames = 0;
  constructor(
    private spectrum: HTMLCanvasElement,
    private waterfall: HTMLCanvasElement,
    view: SpectrumView,
  ) {
    this.view = view;
    this.history.width = waterfall.width;
    this.history.height = waterfall.height;
    this.strip = this.history
      .getContext("2d")!
      .createImageData(waterfall.width, 1);
    this.setCalibration(-13);
    this.motion.addEventListener("change", this.motionChanged);
  }
  setCalibration(value: number) {
    if (this.calibration === value) return;
    this.calibration = value;
    for (let i = 0; i < 256; i++) {
      this.palette.set(waterfallColor(i, value), i * 4);
    }
    this.schedule();
  }
  setView(view: SpectrumView) {
    this.view = view;
    this.scrollFrom = 0;
    this.schedule();
  }
  append(bins: Uint8Array, view: SpectrumView) {
    if (!bins.length) return;
    const now = performance.now();
    // Translate received rows into place; never interpolate signal power or add data.
    this.scrollFrom = this.motion.matches
      ? 0
      : this.scrollOffset(now) - this.rowHeight;
    this.scrollAt = now;
    const ctx = this.history.getContext("2d")!;
    const { width, height } = this.history;
    ctx.drawImage(
      this.history,
      0,
      0,
      width,
      height - this.rowHeight,
      0,
      this.rowHeight,
      width,
      height - this.rowHeight,
    );
    for (let x = 0; x < width; x++) {
      const bin =
        bins[Math.min(bins.length - 1, Math.floor((x / width) * bins.length))];
      this.strip.data.set(this.palette.subarray(bin * 4, bin * 4 + 4), x * 4);
    }
    for (let y = 0; y < this.rowHeight; y++) {
      ctx.putImageData(this.strip, 0, y);
      this.rows.unshift({ ...view });
    }
    this.rows.length = Math.min(this.rows.length, height);
    this.last = { bins, view };
    this.schedule();
  }
  clear() {
    this.rows = [];
    this.last = undefined;
    this.scrollFrom = 0;
    this.history
      .getContext("2d")!
      .clearRect(0, 0, this.history.width, this.history.height);
    this.schedule();
  }
  private schedule() {
    if (!this.frame)
      this.frame = requestAnimationFrame((now) => {
        this.frame = 0;
        this.render(now);
      });
  }
  private scrollOffset(now: number) {
    return this.motion.matches
      ? 0
      : this.scrollFrom * Math.max(0, 1 - (now - this.scrollAt) / 100);
  }
  private render(now: number) {
    this.frames++;
    const wc = this.waterfall.getContext("2d")!,
      sc = this.spectrum.getContext("2d")!;
    const width = this.waterfall.width;
    const offset = this.scrollOffset(now);
    wc.clearRect(0, 0, width, this.waterfall.height);
    // Adjacent rows sharing a range are projected in one GPU draw, not per pixel.
    for (let y = 0; y < this.rows.length;) {
      const source = this.rows[y];
      let end = y + 1;
      while (end < this.rows.length && sameView(source, this.rows[end])) end++;
      const p = projectView(source, this.view, width);
      wc.drawImage(
        this.history,
        0,
        y,
        width,
        end - y,
        p.x,
        y + offset,
        p.width,
        end - y,
      );
      y = end;
    }
    this.waterfall.dataset.rows = String(this.rows.length);
    this.waterfall.dataset.frames = String(this.frames);
    if (offset) this.schedule();
    sc.clearRect(0, 0, this.spectrum.width, this.spectrum.height);
    const sw = this.spectrum.width,
      sh = this.spectrum.height;
    sc.fillStyle = "#03070c";
    sc.fillRect(0, 0, sw, sh);
    // A frequency grid, not signal data. Quarter ticks match the HTML frequency scale.
    sc.lineWidth = 1;
    for (let i = 1; i < 32; i++) {
      sc.strokeStyle = i % 8 === 0 ? "#21313d" : "#101e29";
      sc.beginPath();
      sc.moveTo((sw * i) / 32, 0);
      sc.lineTo((sw * i) / 32, sh);
      sc.stroke();
    }
    sc.strokeStyle = "#15242e";
    for (let i = 1; i < 6; i++) {
      sc.beginPath();
      sc.moveTo(0, (sh * i) / 6);
      sc.lineTo(sw, (sh * i) / 6);
      sc.stroke();
    }
    if (!this.last) return;
    const { bins, view } = this.last;
    const p = projectView(view, this.view, this.spectrum.width);
    const trace = new Path2D();
    for (let i = 0; i < bins.length; i++) {
      const t = Math.max(
        0,
        Math.min(1, (bins[i] - 255 + this.calibration + 115) / 90),
      );
      const x = p.x + (i / bins.length) * p.width,
        y = this.spectrum.height * (1 - t);
      if (!i) trace.moveTo(x, y);
      else trace.lineTo(x, y);
    }
    const area = new Path2D(trace);
    area.lineTo(p.x + ((bins.length - 1) / bins.length) * p.width, sh);
    area.lineTo(p.x, sh);
    area.closePath();
    const fill = sc.createLinearGradient(0, 0, 0, sh);
    fill.addColorStop(0, "#ffbd5966");
    fill.addColorStop(0.35, "#60efa949");
    fill.addColorStop(0.65, "#1cb5e538");
    fill.addColorStop(1, "#50369913");
    sc.fillStyle = fill;
    sc.fill(area);
    const line = sc.createLinearGradient(0, 0, 0, sh);
    line.addColorStop(0, "#ffe7a4");
    line.addColorStop(0.3, "#b4ff92");
    line.addColorStop(0.6, "#47f5ed");
    line.addColorStop(1, "#5387ed");
    sc.strokeStyle = line;
    sc.lineWidth = 1.8;
    sc.shadowColor = "#47d8e9";
    sc.shadowBlur = 4;
    sc.stroke(trace);
    sc.shadowBlur = 0;
  }
  dispose() {
    this.motion.removeEventListener("change", this.motionChanged);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.rows = [];
    this.last = undefined;
  }
}
