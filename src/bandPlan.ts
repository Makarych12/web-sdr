/** kHz, IARU Region 1 HF usage summary, checked against RSGB January 2026.
 * Source pages 7,8,10–16: https://rsgb.services/public/bandplans/
 * SSB denotes phone-compatible all-mode areas, not exclusive assignments.
 * Beacon windows and FM/satellite areas are deliberately not labeled SSB/DATA.
 * National 60m allocations differ; they are not inferred from UK channels.
 */
export type BandUsage = "CW" | "DATA" | "SSB" | "SSB/DATA";
export type BandSegment = {
  band: string;
  start: number;
  end: number;
  usage: BandUsage;
};
function band(band: string, rows: [number, number, BandUsage][]): BandSegment[] {
  return rows.map(([start, end, usage]) => ({ band, start, end, usage }));
}
export const BAND_PLAN: readonly BandSegment[] = [
  ...band("160m", [[1810, 1838, "CW"], [1838, 1840, "DATA"], [1840, 1843, "SSB/DATA"], [1843, 2000, "SSB"]]),
  ...band("80m", [[3500, 3570, "CW"], [3570, 3600, "DATA"], [3600, 3620, "SSB/DATA"], [3620, 3800, "SSB"]]),
  ...band("40m", [[7000, 7040, "CW"], [7040, 7050, "DATA"], [7050, 7060, "SSB/DATA"], [7060, 7200, "SSB"]]),
  ...band("30m", [[10100, 10130, "CW"], [10130, 10150, "DATA"]]),
  ...band("20m", [[14000, 14070, "CW"], [14070, 14099, "DATA"], [14101, 14112, "SSB/DATA"], [14112, 14350, "SSB"]]),
  ...band("17m", [[18068, 18095, "CW"], [18095, 18109, "DATA"], [18111, 18120, "SSB/DATA"], [18120, 18168, "SSB"]]),
  ...band("15m", [[21000, 21070, "CW"], [21070, 21149, "DATA"], [21151, 21450, "SSB"]]),
  ...band("12m", [[24890, 24915, "CW"], [24915, 24929, "DATA"], [24931, 24940, "SSB/DATA"], [24940, 24990, "SSB"]]),
  ...band("10m", [[28000, 28070, "CW"], [28070, 28190, "DATA"], [28300, 28320, "SSB/DATA"], [28320, 29000, "SSB"], [29200, 29300, "DATA"]]),
];
/** Clip to exactly the same view used by the scale's existing tuning gesture. */
export function visibleBandPlan(view: { start: number; span: number }) {
  if (!Number.isFinite(view.start) || !Number.isFinite(view.span) || view.span <= 0) return [];
  return BAND_PLAN.flatMap((segment) => {
    const start = Math.max(view.start, segment.start);
    const end = Math.min(view.start + view.span, segment.end);
    return end > start ? [{
      ...segment,
      left: (start - view.start) / view.span * 100,
      width: (end - start) / view.span * 100,
    }] : [];
  });
}
