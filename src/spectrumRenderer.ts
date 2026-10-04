import { projectView, sameView, type SpectrumView } from "./spectrumView";
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
      const t = Math.max(0, Math.min(1, (i - 255 + value + 115) / 90));
      this.palette.set(
        [
          8 + Math.max(0, t - 0.45) * 400,
          18 + t * 200,
          40 + Math.sin(t * Math.PI) * 170,
          255,
        ],
        i * 4,
      );
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
