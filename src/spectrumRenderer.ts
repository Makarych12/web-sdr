import { displayLevels, resampleFft, spectrumCanvasSize } from "./spectrumLevels";
import { sdrProLevels, sdrProRow, type SdrProLevels } from "./sdrPro";
import { DEFAULT_WATERFALL_DISPLAY, validWaterfallDisplay, malahitRow, type WaterfallDisplay } from "./waterfallMode";
import { THEME_STOPS, validWaterfallTheme, type WaterfallTheme } from "./waterfallThemes";
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
/** One calibrated transfer curve for all receivers, bands and zoom levels. */
export function waterfallColor(
  bin: number,
  calibration: number,
  blackDb = -115,
  rangeDb = 90,
  theme: WaterfallTheme = "CLASSIC",
): number[] {
  const colorStops = THEME_STOPS[theme];
  blackDb = Number.isFinite(blackDb) ? blackDb : -115;
  rangeDb = Number.isFinite(rangeDb) && rangeDb > 0 ? rangeDb : 90;
  const db = Math.max(
    -100,
    Math.min(100, Number.isFinite(calibration) ? calibration : -13),
  );
  const power = Math.max(
    0,
    Math.min(1, (Math.max(0, Math.min(255, Number.isFinite(bin) ? bin : 0)) - 255 + db - blackDb) / rangeDb),
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
/** Packet-driven smoothing in dB: no timers, invented bins or moving peaks. */
export class SpectrumEnvelope {
  private values: Float32Array | null = null;
  private time = 0;
  reset() { this.values = null; this.time = 0; }
  update(bins: Uint8Array, time: number) {
    if (!this.values || this.values.length !== bins.length) this.values = Float32Array.from(bins);
    else {
      const dt = Math.max(.001, Math.min(1, (time - this.time) / 1000));
      for (let i = 0; i < bins.length; i++) {
        const tau = bins[i] > this.values[i] ? .035 : .28;
        this.values[i] += (1 - Math.exp(-dt / tau)) * (bins[i] - this.values[i]);
      }
    }
    this.time = time;
    return this.values;
  }
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
type HistoryRow = { bins:Uint8Array; blackDb:number; rangeDb:number; calibration:number; view:SpectrumView; pro:SdrProLevels };
/** Bounded real-row queue; at most one upward scroll per animation frame. */
export class SpectrumRenderer {
  private history = document.createElement("canvas");
  private strip!: ImageData;
  private envelope = new SpectrumEnvelope();
  private traceBins: Float32Array | null = null;
  private last?: { bins: Uint8Array; view: SpectrumView };
  private view: SpectrumView;
  private frame = 0;
  private palette = new Uint8ClampedArray(1024 * 4);
  private paletteKey = "";
  private pixelRatio = 1;
  private observer?: ResizeObserver;
  private noiseDb = -105;
  private scopeLevels() {
    return displayLevels(this.noiseDb, this.display.refLevel, this.display.levelRangeDb, this.display.autoLevel);
  }
  private calibration = -13;
  private theme: WaterfallTheme = 'CLASSIC';
  private display:WaterfallDisplay={...DEFAULT_WATERFALL_DISPLAY};
  private colorRows:HistoryRow[]=[];
  setWaterfallDisplay(display:WaterfallDisplay) {
    if(!validWaterfallDisplay(display)||JSON.stringify(display)===JSON.stringify(this.display))return;
    this.display={...display};
    this.stopProScroll();
    this.waterfall.dataset.mode=display.mode;
    this.repaintHistory();
  }
  private paintHistoryRow(ctx:CanvasRenderingContext2D,row:HistoryRow,previous:HistoryRow|undefined,y:number) {
    if(this.display.mode==='CLASSIC') {
      const levels=displayLevels(row.blackDb+10,this.display.refLevel,this.display.levelRangeDb,this.display.autoLevel);
      this.paintColorRow(ctx,row.bins,row.calibration,levels.blackDb,levels.rangeDb,y);
      return;
    }
    if(this.display.mode==='SDR PRO'){
      const pixels=sdrProRow(row.bins,row.pro,this.display.proContrast??1.1,this.display.proSensitivity??0);
      this.paintColorRow(ctx,pixels,0,-255,255,y);
      return;
    }
    const contiguous=previous&&sameView(row.view,previous.view);
    const noise=row.blackDb+10+255-row.calibration;
    const previousNoise=previous?previous.blackDb+10+255-previous.calibration:noise;
    const pixels=malahitRow(row.bins,contiguous?previous.bins:null,noise,previousNoise,this.display);
    // Existing theme LUT maps the enhanced measurements; it is not the algorithm.
    this.paintColorRow(ctx,pixels,0,-255,255,y);
  }
  private proScrollTimer:ReturnType<typeof setTimeout>|undefined;
  private proStepUntil=0;
  private proLastRowTime=0;
  private proPeriod=125;
  private stopProScroll() {
    if(this.proScrollTimer!==undefined)clearTimeout(this.proScrollTimer);
    this.proScrollTimer=undefined;this.proStepUntil=0;
  }
  private stepProScroll() {
    const now=performance.now();
    if(this.proLastRowTime)this.proPeriod+=.2*(Math.max(32,Math.min(500,now-this.proLastRowTime))-this.proPeriod);
    this.proLastRowTime=now;
    if(this.display.mode!=='SDR PRO' && !(this.display.mode==='CLASSIC' && this.theme==='OCEAN BLUE'))return;
    this.stopProScroll();
    const delay=Math.max(16,Math.min(80,this.proPeriod/2));
    this.proStepUntil=now+delay;
    this.proScrollTimer=setTimeout(()=>{this.proScrollTimer=undefined;this.proStepUntil=0;this.schedule();},delay);
  }
  private repaintFrame=0;
  private repainting=false;
  private repaintOnVisible=false;
  private repaintHistory() {
    if(!this.visible){this.repaintOnVisible=true;return;}
    this.repaintOnVisible=false;
    cancelAnimationFrame(this.repaintFrame);
    const ctx=this.history.getContext('2d')!,rows=this.colorRows.slice();
    let i=0,previous:HistoryRow|undefined;
    this.repainting=true;
    const chunk=()=>{
      this.repaintFrame=0;
      const start=performance.now();
      // Yield to PCM delivery between small history batches. Live rows already
      // use the new mode; locate old rows again because normal scrolling continues.
      do {
        const row=rows[i];
        if(!row)break;
        const index=this.colorRows.indexOf(row);
        if(index>=0){
          const y=this.history.height-this.colorRows.length+index;
          this.paintHistoryRow(ctx,row,previous,y);
          for(let next=index+1;this.colorRows[next]===row;next++)
            ctx.putImageData(this.strip,0,y+next-index);
        }
        previous=row;
        do { i++; } while(rows[i]===row);
      } while(i<rows.length&&performance.now()-start<2);
      this.schedule();
      if(i<rows.length)this.repaintFrame=requestAnimationFrame(chunk);
      else this.repainting=false;
    };
    chunk();
  }
  setTheme(theme:WaterfallTheme) {
    if(!validWaterfallTheme(theme)||theme===this.theme)return;
    this.theme=theme;
    this.repaintHistory();
    this.waterfall.dataset.theme=theme;
    this.schedule();
  }
  private paintColorRow(ctx:CanvasRenderingContext2D,bins:Uint8Array,calibration:number,blackDb:number,rangeDb:number,y:number) {
    const key=`${calibration}/${blackDb.toFixed(2)}/${rangeDb}/${this.theme}`;
    if(key!==this.paletteKey) {
      this.paletteKey=key;
      for(let i=0;i<1024;i++)this.palette.set(waterfallColor(i*255/1023,calibration,blackDb,rangeDb,this.theme),i*4);
    }
    const width=this.history.width, samples=resampleFft(bins,width);
    for(let x=0;x<width;x++){
      const color=Math.max(0,Math.min(1023,Math.round(samples[x]*1023/255)))*4;
      const pixel=x*4;
      this.strip.data[pixel]=this.palette[color];this.strip.data[pixel+1]=this.palette[color+1];
      this.strip.data[pixel+2]=this.palette[color+2];this.strip.data[pixel+3]=255;
    }
    ctx.putImageData(this.strip,0,y);
  }
  private levels = new WaterfallLevels();
  private pending: { bins: Uint8Array; view: SpectrumView }[] = [];
  private sequence?: number;
  private rowCount = 0;
  private rowViews: SpectrumView[] = [];
  private rowHeight = 2;
  private visible = document.visibilityState !== "hidden";
  setVisible(visible: boolean) {
    if (visible === this.visible) return;
    this.visible = visible;
    if(!visible) {
      this.stopProScroll();
      this.repaintOnVisible ||= this.repainting;
      cancelAnimationFrame(this.repaintFrame);
      this.repaintFrame=0;
      this.repainting=false;
    }
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.pending = [];
    if (visible) {
      if(this.repaintOnVisible)this.repaintHistory();
      this.schedule();
    }
  }
  frames = 0;
  constructor(
    private spectrum: HTMLCanvasElement,
    private waterfall: HTMLCanvasElement,
    view: SpectrumView,
  ) {
    this.view = view;
    this.waterfall.getContext("2d", { alpha: false });
    this.history.getContext("2d", { alpha: false });
    if (typeof ResizeObserver !== "undefined") {
      this.fitCanvases();
      this.observer = new ResizeObserver(() => { if(this.fitCanvases()) this.schedule(); });
      this.observer.observe(spectrum);
      this.observer.observe(waterfall);
    }
    this.resize();
    this.setCalibration(-13);
    this.clear();
  }
  setCalibration(value: number) {
    if (!Number.isFinite(value)) return;
    const next = Math.max(-100, Math.min(100, value));
    const changed = next !== this.calibration;
    this.calibration = next;
    this.paletteKey = "";
    if (changed) this.clear(false);
  }
  setView(view: SpectrumView) {
    if (!validView(view)) return;
    if (!sameView(view, this.view)) {
      this.view = { ...view };
      this.pending = [];
      // Restore 7f3a7f2 normalization for the newly received range, while keeping history.
      this.levels.reset();
      this.envelope.reset();
      this.traceBins = null;
      this.schedule();
    }
  }
  private fitCanvases() {
    const bounds=this.waterfall.getBoundingClientRect();
    if(bounds.width<1 || bounds.height<1)return false;
    const size=spectrumCanvasSize(bounds.width,bounds.height,window.devicePixelRatio||1);
    this.pixelRatio=size.ratio;
    this.rowHeight=Math.max(2,Math.round(2*size.ratio));
    let changed=false;
    for(const canvas of [this.spectrum,this.waterfall]) {
      const height=canvas===this.waterfall?size.height:Math.max(1,Math.round(canvas.getBoundingClientRect().height*size.ratio));
      if(canvas.width!==size.width || canvas.height!==height){
        canvas.width=size.width;canvas.height=height;changed=true;
      }
    }
    return changed;
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
    const ctx=this.history.getContext("2d")!;
    ctx.fillStyle="#020818";
    ctx.fillRect(0,0,this.history.width,this.history.height);
    this.colorRows=this.colorRows.slice(-this.history.height);
    this.rowViews=this.colorRows.map(row=>row.view);
    this.rowCount=this.colorRows.length;
    this.waterfall.dataset.rows=String(this.rowCount);
    if(this.colorRows.length)this.repaintHistory();
    return true;
  }
  append(bins: Uint8Array, view: SpectrumView) {
    if (!this.visible) return false;
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
    this.pending.push({ bins: bins.slice(), view: { ...view } });
    if (this.pending.length > 8) this.pending.shift();
    this.schedule();
    return true;
  }
  clear(resetSequence = true) {
    this.stopProScroll();this.proLastRowTime=0;this.proPeriod=125;
    cancelAnimationFrame(this.repaintFrame);
    this.repaintFrame=0;this.repainting=false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.pending = [];
    this.last = undefined;
    this.traceBins = null;
    this.envelope.reset();
    this.rowCount = 0;
    this.rowViews = [];
    this.colorRows = [];
    this.levels.reset();
    if (resetSequence) this.sequence = undefined;
    for (const canvas of [this.history, this.waterfall]) {
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#020818";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    this.waterfall.dataset.rows = "0";
    delete this.waterfall.dataset.noiseDb;
    delete this.waterfall.dataset.blackDb;
    delete this.waterfall.dataset.sequence;
    this.schedule();
  }
  private schedule() {
    if (this.visible && !this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.render();
      });
  }
  private render() {
    this.frames++;
    if (!this.resize() && this.pending.length) {
      // Spread packet bursts across frames instead of jumping several rows.
      const queue = this.pending.splice(0, 1);
      const ctx = this.history.getContext("2d")!;
      const width = this.history.width,
        height = this.history.height;
      const shift = Math.min(height, queue.length * this.rowHeight);
      this.rowViews.push(
        ...queue.flatMap((row) => Array(this.rowHeight).fill(row.view)),
      );
      if (this.rowViews.length > height)
        this.rowViews.splice(0, this.rowViews.length - height);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.imageSmoothingEnabled = false;
      if (shift < height)
        ctx.drawImage(
          this.history,
          0,
          shift,
          width,
          height - shift,
          0,
          0,
          width,
          height - shift,
        );
      for (let n = 0; n < queue.length; n++) {
        const row = queue[n];
        const levels = this.levels.update(row.bins, this.calibration);
        this.noiseDb=levels.noiseDb;
        this.waterfall.dataset.noiseDb = levels.noiseDb.toFixed(2);
        this.waterfall.dataset.blackDb = this.scopeLevels().blackDb.toFixed(2);
        const y = height - (queue.length - n) * this.rowHeight;
        const previous=this.colorRows.at(-1);
        const preceding=previous&&sameView(previous.view,row.view)&&previous.calibration===this.calibration?previous.pro:undefined;
        const stored={bins:row.bins,calibration:this.calibration,blackDb:levels.blackDb,rangeDb:levels.rangeDb,view:row.view,pro:sdrProLevels(row.bins,preceding)};
        this.stepProScroll();
        for(let i=0;i<this.rowHeight && y+i<height;i++)if(y+i>=0){
          if(i===0)this.paintHistoryRow(ctx,stored,previous,y+i);
          else ctx.putImageData(this.strip,0,y+i);
          this.colorRows.push(stored);
        }
        if(this.colorRows.length>height)this.colorRows.splice(0,this.colorRows.length-height);
        this.traceBins = this.theme==='OCEAN BLUE' ? Float32Array.from(row.bins) : this.envelope.update(row.bins, performance.now());
        this.last = row;
      }
      this.rowCount = Math.min(height, this.rowCount + shift);
      this.waterfall.dataset.rows = String(this.rowCount);
      this.waterfall.dataset.sequence = String(this.sequence ?? "");
    }
    const wc = this.waterfall.getContext("2d")!;
    wc.globalAlpha = 1;
    wc.globalCompositeOperation = "source-over";
    wc.fillStyle = "#020818";
    wc.fillRect(0, 0, this.waterfall.width, this.waterfall.height);
    wc.imageSmoothingEnabled = true;
    const scrollOffset=performance.now()<this.proStepUntil?Math.max(1,Math.floor(this.rowHeight/2)):0;
    // Most rows share a range. Project contiguous runs with one draw call,
    // keeping pan history without hundreds of canvas calls on every packet.
    for (let y = 0; y < this.rowViews.length;) {
      const view = this.rowViews[y];
      let end = y + 1;
      while (end < this.rowViews.length && sameView(this.rowViews[end], view))
        end++;
      const p = projectView(view, this.view, this.waterfall.width);
      const rowY = this.waterfall.height - this.rowViews.length + y;
      wc.drawImage(
        this.history,
        0,
        rowY,
        this.history.width,
        end - y,
        p.x,
        rowY+scrollOffset,
        p.width,
        end - y,
      );
      y = end;
    }
    this.waterfall.dataset.frames = String(this.frames);
    if (this.pending.length) this.schedule();
    const sc = this.spectrum.getContext("2d")!;
    sc.clearRect(0, 0, this.spectrum.width, this.spectrum.height);
    const sw = this.spectrum.width,
      sh = this.spectrum.height;
    sc.fillStyle = "#040d1d";
    sc.fillRect(0, 0, sw, sh);
    // A frequency grid, not signal data. Quarter ticks match the HTML frequency scale.
    sc.lineWidth = Math.max(1,this.pixelRatio*.6);
    for (let i = 1; i < 32; i++) {
      sc.strokeStyle = i % 8 === 0 ? "#1b344e" : "#0e1e33";
      sc.beginPath();
      sc.moveTo((sw * i) / 32, 0);
      sc.lineTo((sw * i) / 32, sh);
      sc.stroke();
    }
    const levels=this.scopeLevels();
    this.spectrum.dataset.refDb=levels.topDb.toFixed(2);
    this.spectrum.dataset.rangeDb=String(levels.rangeDb);
    this.waterfall.dataset.blackDb=levels.blackDb.toFixed(2);
    this.waterfall.dataset.rangeDb=String(levels.rangeDb);
    this.waterfall.dataset.refDb=levels.topDb.toFixed(2);
    sc.strokeStyle = "#1b2e46";
    for (let i = 1; i < 4; i++) {
      sc.beginPath();sc.moveTo(0,sh*i/4);sc.lineTo(sw,sh*i/4);sc.stroke();
    }
    // Tick labels use exactly the dB transform of both real FFT displays.
    const labelSize=9*this.pixelRatio;
    sc.font=`${labelSize}px ui-monospace, monospace`;
    sc.fillStyle="#8aa6be";
    for(let i=0;i<=4;i++) {
      const y=Math.max(labelSize+3,Math.min(sh-4,sh*i/4));
      sc.fillText(`${(levels.topDb-levels.rangeDb*i/4).toFixed(0)}${i===4?' dBm':''}`,6*this.pixelRatio,y);
    }
    if (!this.last) return;
    const { view } = this.last;
    const bins = this.traceBins ?? this.last.bins;
    const p = projectView(view, this.view, this.spectrum.width);
    // Use the same pixel footprints and interpolation as the waterfall row.
    const samples=resampleFft(bins,this.spectrum.width);
    const trace = new Path2D();
    for (let x = 0; x < samples.length; x++) {
      const t=Math.max(0,Math.min(1,(samples[x]-255+this.calibration-levels.blackDb)/levels.rangeDb));
      const px=p.x+x/this.spectrum.width*p.width, y=sh*(1-t);
      if (!x) trace.moveTo(px,y); else trace.lineTo(px,y);
    }
    const area = new Path2D(trace);
    area.lineTo(p.x + ((samples.length - 1) / samples.length) * p.width, sh);
    area.lineTo(p.x, sh);
    area.closePath();
    const fill = sc.createLinearGradient(0, 0, 0, sh);
    fill.addColorStop(0, "#12b9d55c");
    fill.addColorStop(0.35, "#1370ad45");
    fill.addColorStop(0.65, "#133c7630");
    fill.addColorStop(1, "#0b1b3910");
    sc.fillStyle = fill;
    sc.fill(area);
    const line = sc.createLinearGradient(0, 0, 0, sh);
    line.addColorStop(0, "#ffe7a4");
    line.addColorStop(0.3, "#b4ff92");
    line.addColorStop(0.6, "#47f5ed");
    line.addColorStop(1, "#5387ed");
    sc.strokeStyle = line;
    sc.lineWidth = Math.max(1,this.pixelRatio);
    sc.stroke(trace);
    sc.shadowBlur = 0;
  }
  dispose() {
    this.observer?.disconnect();
    this.stopProScroll();
    cancelAnimationFrame(this.repaintFrame);
    this.repaintFrame=0;this.repainting=false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.pending = [];
    this.last = undefined;
  }
}
