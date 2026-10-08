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
  }
  setCalibration(value: number) {
    if (this.calibration === value) return;
    this.calibration = value;
    for (let i = 0; i < 256; i++) {
      this.palette.set(waterfallColor(i, value), i * 4);
    }
  }
  setView(view: SpectrumView) {
    this.view = view;
    this.schedule();
  }
  append(bins: Uint8Array, view: SpectrumView) {
    const ctx = this.history.getContext("2d")!;
    const { width, height } = this.history;
    ctx.drawImage(
      this.history,
      0,
      0,
      width,
      height - 1,
      0,
      1,
      width,
      height - 1,
    );
    for (let x = 0; x < width; x++) {
      const bin =
        bins[Math.min(bins.length - 1, Math.floor((x / width) * bins.length))];
      this.strip.data.set(this.palette.subarray(bin * 4, bin * 4 + 4), x * 4);
    }
    ctx.putImageData(this.strip, 0, 0);
    this.rows.unshift({ ...view });
    if (this.rows.length > height) this.rows.pop();
    this.last = { bins, view };
    this.schedule();
  }
  clear() {
    this.rows = [];
    this.last = undefined;
    this.history
      .getContext("2d")!
      .clearRect(0, 0, this.history.width, this.history.height);
    this.schedule();
  }
  private schedule() {
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.render();
      });
  }
  private render() {
    this.frames++;
    const wc = this.waterfall.getContext("2d")!,
      sc = this.spectrum.getContext("2d")!;
    const width = this.waterfall.width;
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
        y,
        p.width,
        end - y,
      );
      y = end;
    }
    sc.clearRect(0, 0, this.spectrum.width, this.spectrum.height);
    if (!this.last) return;
    const { bins, view } = this.last;
    const p = projectView(view, this.view, this.spectrum.width);
    sc.strokeStyle = "#4ee3c2";
    sc.lineWidth = 1.5;
    sc.beginPath();
    for (let i = 0; i < bins.length; i++) {
      const t = Math.max(
        0,
        Math.min(1, (bins[i] - 255 + this.calibration + 115) / 90),
      );
      const x = p.x + (i / bins.length) * p.width,
        y = this.spectrum.height * (1 - t);
      if (!i) sc.moveTo(x, y);
      else sc.lineTo(x, y);
    }
    sc.stroke();
    this.waterfall.dataset.rows = String(this.rows.length);
    this.waterfall.dataset.frames = String(this.frames);
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.rows = [];
    this.last = undefined;
  }
}
