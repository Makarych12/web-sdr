import {
  projectView,
  sameView,
  matchesRequest,
  type SpectrumView,
} from "./spectrumView";

export function clampByte(value: number) {
  return Math.round(
    Math.max(0, Math.min(255, Number.isFinite(value) ? value : 0)),
  );
}
const colorStops = [
  [0, 2, 5, 13],
  [0.18, 6, 21, 65],
  [0.36, 15, 75, 161],
  [0.54, 13, 175, 201],
  [0.7, 58, 204, 117],
  [0.84, 224, 213, 49],
  [0.95, 247, 121, 24],
  [1, 226, 44, 29],
];
/** One calibrated transfer curve for all receivers, bands and zoom levels. */
export function waterfallColor(
  bin: number,
  calibration: number,
  blackDb = -115,
  rangeDb = 90,
): number[] {
  blackDb = Number.isFinite(blackDb) ? blackDb : -115;
  rangeDb = Number.isFinite(rangeDb) && rangeDb > 0 ? rangeDb : 90;
  const db = Math.max(
    -100,
    Math.min(100, Number.isFinite(calibration) ? calibration : -13),
  );
  const power = Math.max(
    0,
    Math.min(1, (clampByte(bin) - 255 + db - blackDb) / rangeDb),
  );
  const t = power ** 0.85;
  const index = Math.max(
    1,
    colorStops.findIndex((stop) => stop[0] >= t),
  );
  const low = colorStops[index - 1],
    high = colorStops[index];
  const mix = (t - low[0]) / (high[0] - low[0]);
  return [1, 2, 3]
    .map((channel) =>
      clampByte(low[channel] + (high[channel] - low[channel]) * mix),
    )
    .concat(255);
}
/** The same robust noise estimate on every band, independent of its frequency.
 * A low percentile ignores isolated carriers; slow tracking avoids brightness
 * pumping. Only display contrast changes: PCM, RSSI and spectrum stay absolute.
 */
export class WaterfallLevels {
  private noise: number | undefined;
  readonly rangeDb = 75;
  reset() {
    this.noise = undefined;
  }
  update(bins: Uint8Array, calibration: number) {
    const histogram = new Uint16Array(256);
    for (const value of bins) histogram[value]++;
    const rank = Math.ceil(bins.length * 0.3);
    let count = 0,
      percentile = 0;
    for (; percentile < 255; percentile++) {
      count += histogram[percentile];
      if (count >= rank) break;
    }
    const db = Number.isFinite(calibration)
      ? Math.max(-100, Math.min(100, calibration))
      : -13;
    const target = percentile - 255 + db;
    this.noise =
      this.noise === undefined
        ? target
        : this.noise +
          Math.max(-0.25, Math.min(0.25, (target - this.noise) * 0.04));
    // Noise occupies dark navy/blue; power above it retains the full palette.
    return {
      blackDb: this.noise - 10,
      noiseDb: this.noise,
      rangeDb: this.rangeDb,
    };
  }
}
/** Limit only isolated, one-bin spikes; preserve contiguous narrow-band signals. */
export function limitWaterfallSpikes(bins: Uint8Array) {
  const result = bins.slice();
  for (let i = 1; i < bins.length - 1; i++) {
    const neighbor = Math.max(bins[i - 1], bins[i + 1]);
    if (bins[i] - neighbor > 80)
      result[i] = clampByte(neighbor + 48 + (bins[i] - neighbor - 48) * 0.25);
  }
  return result;
}
function validView(view: SpectrumView) {
  return (
    Number.isFinite(view.start) &&
    view.start >= 0 &&
    Number.isFinite(view.span) &&
    view.span > 0 &&
    (view.bandwidth === undefined ||
      (Number.isFinite(view.bandwidth) && view.bandwidth > 0)) &&
    (view.zoom === undefined ||
      (Number.isInteger(view.zoom) && view.zoom >= 0 && view.zoom <= 14))
  );
}
/** Bounded real-row queue; integer scroll, no interpolation, no redraw animation. */
export class SpectrumRenderer {
  private history = document.createElement("canvas");
  private strip!: ImageData;
  private last?: { bins: Uint8Array; view: SpectrumView };
  private view: SpectrumView;
  private frame = 0;
  private palette = new Uint8ClampedArray(256 * 4);
  private calibration = -13;
  private levels = new WaterfallLevels();
  private pending: { bins: Uint8Array; view: SpectrumView }[] = [];
  private sequence?: number;
  private rowCount = 0;
  private rowHeight = 2;
  frames = 0;
  constructor(
    private spectrum: HTMLCanvasElement,
    private waterfall: HTMLCanvasElement,
    view: SpectrumView,
  ) {
    this.view = view;
    this.resize();
    this.setCalibration(-13);
    this.clear();
  }
  setCalibration(value: number) {
    if (!Number.isFinite(value)) return;
    const next = Math.max(-100, Math.min(100, value));
    const changed = next !== this.calibration;
    this.calibration = next;
    for (let i = 0; i < 256; i++)
      this.palette.set(waterfallColor(i, this.calibration), i * 4);
    if (changed) this.clear(false);
  }
  setView(view: SpectrumView) {
    if (!validView(view)) return;
    if (!sameView(view, this.view)) {
      this.view = { ...view };
      this.clear(false);
    }
  }
  private resize() {
    if (this.waterfall.width < 1 || this.waterfall.height < 1) {
      this.pending = [];
      this.last = undefined;
      this.rowCount = 0;
      this.waterfall.dataset.rows = "0";
      return true;
    }
    if (
      this.history.width === this.waterfall.width &&
      this.history.height === this.waterfall.height &&
      this.strip
    )
      return false;
    this.history.width = this.waterfall.width;
    this.history.height = this.waterfall.height;
    this.strip = this.history
      .getContext("2d")!
      .createImageData(this.history.width, 1);
    this.clear(false);
    return true;
  }
  append(bins: Uint8Array, view: SpectrumView) {
    if (
      !(bins instanceof Uint8Array) ||
      bins.length !== 1024 ||
      this.waterfall.width < 1 ||
      this.waterfall.height < 1 ||
      !validView(view) ||
      !matchesRequest(view, this.view)
    )
      return false;
    if (view.sequence !== undefined) {
      if (
        !Number.isInteger(view.sequence) ||
        view.sequence < 0 ||
        view.sequence > 0xffffffff
      )
        return false;
      if (this.sequence !== undefined) {
        const delta = (view.sequence - this.sequence) >>> 0;
        if (delta === 0 || delta > 0x7fffffff) return false;
      }
      this.sequence = view.sequence;
    }
    this.resize();
    this.pending.push({ bins: limitWaterfallSpikes(bins), view: { ...view } });
    if (this.pending.length > 8) this.pending.shift();
    this.schedule();
    return true;
  }
  clear(resetSequence = true) {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.pending = [];
    this.last = undefined;
    this.rowCount = 0;
    this.levels.reset();
    if (resetSequence) this.sequence = undefined;
    for (const canvas of [this.history, this.waterfall]) {
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#03060b";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    this.waterfall.dataset.rows = "0";
    delete this.waterfall.dataset.noiseDb;
    delete this.waterfall.dataset.blackDb;
    delete this.waterfall.dataset.sequence;
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
    if (!this.resize() && this.pending.length) {
      const queue = this.pending.splice(0);
      const ctx = this.history.getContext("2d")!;
      const width = this.history.width,
        height = this.history.height;
      const shift = Math.min(height, queue.length * this.rowHeight);
      ctx.imageSmoothingEnabled = false;
      if (shift < height)
        ctx.drawImage(
          this.history,
          0,
          0,
          width,
          height - shift,
          0,
          shift,
          width,
          height - shift,
        );
      for (let n = 0; n < queue.length; n++) {
        const row = queue[n];
        const levels = this.levels.update(row.bins, this.calibration);
        for (let i = 0; i < 256; i++)
          this.palette.set(
            waterfallColor(i, this.calibration, levels.blackDb, levels.rangeDb),
            i * 4,
          );
        this.waterfall.dataset.noiseDb = levels.noiseDb.toFixed(2);
        this.waterfall.dataset.blackDb = levels.blackDb.toFixed(2);
        for (let x = 0; x < width; x++) {
          const bin = clampByte(
            row.bins[Math.min(1023, Math.floor((x * 1024) / width))],
          );
          this.strip.data.set(
            this.palette.subarray(bin * 4, bin * 4 + 4),
            x * 4,
          );
        }
        const y = (queue.length - 1 - n) * this.rowHeight;
        for (let i = 0; i < this.rowHeight && y + i < height; i++)
          ctx.putImageData(this.strip, 0, y + i);
        this.last = row;
      }
      this.rowCount = Math.min(height, this.rowCount + shift);
      const wc = this.waterfall.getContext("2d")!;
      wc.imageSmoothingEnabled = false;
      wc.drawImage(this.history, 0, 0);
      this.waterfall.dataset.rows = String(this.rowCount);
      this.waterfall.dataset.sequence = String(this.sequence ?? "");
    }
    this.waterfall.dataset.frames = String(this.frames);
    const sc = this.spectrum.getContext("2d")!;
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
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.pending = [];
    this.last = undefined;
  }
}
