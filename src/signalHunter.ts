import { sameView, type SpectrumView } from "./spectrumView";
export type EnergyPeak = {
  id: number;
  frequency: number;
  excessDb: number;
  levelDb: number;
  lastSeen: number;
};
type Track = EnergyPeak & {
  bin: number;
  hits: number;
  firstSeen: number;
  visible: boolean;
};
/** Read-only energy detector for the existing 1024-bin, 1 dB/byte RF FFT.
 * No audio processing, decoding, station identification or network access.
 */
export class SignalHunter {
  private values: Float32Array | null = null;
  private view: SpectrumView | null = null;
  private sampled = -Infinity;
  private tracks: Track[] = [];
  private nextId = 1;
  private histogram = new Uint16Array(256);
  private floors = new Float32Array(1024);
  private sensitivity: number;
  constructor(sensitivity = 55) {
    this.sensitivity = Math.max(0, Math.min(100, sensitivity));
  }
  get thresholdDb() {
    return 22 - this.sensitivity * 0.17;
  }
  reset() {
    this.values = null;
    this.view = null;
    this.sampled = -Infinity;
    this.tracks = [];
  }
  push(
    bins: Uint8Array,
    view: SpectrumView,
    calibration: number,
    time: number,
  ) {
    if (
      bins.length !== 1024 ||
      !Number.isFinite(time) ||
      !Number.isFinite(view.start) ||
      !Number.isFinite(view.span) ||
      view.start < 0 ||
      view.span <= 0
    )
      return;
    if (
      !this.view ||
      !sameView(this.view, view) ||
      time - this.sampled > 1800
    ) {
      this.reset();
      this.view = { ...view };
    }
    if (time - this.sampled < 180) return;
    const dt = Number.isFinite(this.sampled)
      ? Math.max(0.001, (time - this.sampled) / 1000)
      : 0.2;
    this.sampled = time;
    const alpha = 1 - Math.exp(-dt / 0.25);
    if (!this.values) this.values = Float32Array.from(bins);
    else
      for (let i = 0; i < 1024; i++)
        this.values[i] += alpha * (bins[i] - this.values[i]);
    const values = this.values,
      hist = this.histogram,
      radius = 24;
    hist.fill(0);
    const at = (i: number) =>
      Math.round(values[Math.max(0, Math.min(1023, i))]);
    for (let j = -radius; j <= radius; j++) hist[at(j)]++;
    for (let i = 0; i < 1024; i++) {
      let sum = 0,
        level = 0;
      for (; level < 255; level++) {
        sum += hist[level];
        if (sum >= 15) break;
      }
      this.floors[i] = level;
      hist[at(i - radius)]--;
      hist[at(i + radius + 1)]++;
    }
    const threshold = this.thresholdDb,
      candidates: { bin: number; excess: number; level: number }[] = [];
    for (let i = 3; i < 1021; i++) {
      const excess = values[i] - this.floors[i];
      // The current frame must also contain energy: a single transient must
      // not mature into a marker merely because the EMA has a release tail.
      if (
        excess < threshold ||
        bins[i] - this.floors[i] < threshold ||
        bins[i] >= 254 ||
        values[i] < values[i - 1] ||
        values[i] <= values[i + 1]
      )
        continue;
      let weight = 0,
        weighted = 0;
      for (let j = i - 2; j <= i + 2; j++) {
        const w = Math.max(0, values[j] - this.floors[i] - excess * 0.5);
        weight += w;
        weighted += j * w;
      }
      candidates.push({
        bin: weight ? weighted / weight : i,
        excess,
        level: values[i],
      });
    }
    // Non-maximum suppression merges neighboring peaks; bounded work/state.
    const merged: typeof candidates = [];
    for (const c of candidates.sort((a, b) => b.excess - a.excess)) {
      if (!merged.some((p) => Math.abs(p.bin - c.bin) < 5)) merged.push(c);
      if (merged.length === 40) break;
    }
    const used = new Set<number>();
    const offset = Number.isFinite(calibration)
      ? Math.max(-100, Math.min(100, calibration))
      : -13;
    for (const c of merged) {
      let best: Track | undefined,
        distance = 4;
      for (const track of this.tracks) {
        const d = Math.abs(track.bin - c.bin);
        if (
          !used.has(track.id) &&
          time - track.lastSeen <= 1400 &&
          d < distance
        ) {
          best = track;
          distance = d;
        }
      }
      if (!best) {
        best = {
          id: this.nextId++,
          bin: c.bin,
          frequency: 0,
          excessDb: c.excess,
          levelDb: c.level - 255 + offset,
          hits: 0,
          firstSeen: time,
          lastSeen: time,
          visible: false,
        };
        this.tracks.push(best);
      }
      used.add(best.id);
      if (time - best.lastSeen > 600) {
        best.hits = 0;
        best.firstSeen = time;
      }
      best.bin += (c.bin - best.bin) * 0.3;
      best.hits++;
      best.lastSeen = time;
      best.excessDb += (c.excess - best.excessDb) * 0.3;
      best.levelDb += (c.level - 255 + offset - best.levelDb) * 0.3;
      best.frequency =
        Math.round((view.start + (best.bin / 1024) * view.span) * 1000) / 1000;
      if (best.hits >= 5 && time - best.firstSeen >= 900) best.visible = true;
    }
    this.tracks = this.tracks
      .filter((t) => time - t.lastSeen < 1800)
      .sort((a, b) => b.lastSeen - a.lastSeen || b.excessDb - a.excessDb)
      .slice(0, 64);
  }
  snapshot(time: number): EnergyPeak[] {
    return this.tracks
      .filter((t) => t.visible && time - t.lastSeen < 1400)
      .sort((a, b) => b.excessDb - a.excessDb)
      .slice(0, 20)
      .map(({ id, frequency, excessDb, levelDb, lastSeen }) => ({
        id,
        frequency,
        excessDb,
        levelDb,
        lastSeen,
      }));
  }
}
