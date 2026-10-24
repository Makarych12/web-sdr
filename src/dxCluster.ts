export const DX_URL = "https://www.hamqth.com/api/v2/spots?limit=200";
export const DX_INTERVAL = 60000;
export const DX_MAX_AGE = 30 * 60000;
export type DxSpot = { id: string; call: string; frequency: number; time: number; spotter: string; band: string; mode?: string | null };
export type DxRange = { min: number; max: number } | null;

// Band envelopes for filtering cluster reports, not mode allocations or licensing rules.
export const BANDS: readonly [string, number, number][] = [
  ["160M",1800,2000],["80M",3500,4000],["60M",5250,5450],["40M",7000,7300],
  ["30M",10100,10150],["20M",14000,14350],["17M",18068,18168],
  ["15M",21000,21450],["12M",24890,24990],["10M",28000,29700],
];

export function dxBand(frequency: number) { return BANDS.find(([,lo,hi]) => frequency >= lo && frequency <= hi)?.[0] ?? null; }

export function normalizeFrequencyKHz(raw: unknown): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const num = typeof raw === "number" ? raw : parseFloat(String(raw).trim());
  if (!Number.isFinite(num) || num <= 0) return null;
  let khz = num;
  if (num > 30000) {
    // Spot reported in Hz (e.g. 14080000 Hz)
    khz = num / 1000;
  } else if (num < 30) {
    // Spot reported in MHz (e.g. 14.08 MHz)
    khz = num * 1000;
  }
  // Round to nearest 1 Hz (0.001 kHz) to avoid IEEE 754 precision issues
  khz = Math.round(khz * 1000) / 1000;
  if (khz <= 0 || khz > 30000) return null;
  return khz;
}

export function parseDxSpots(value: unknown): DxSpot[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { spots?: unknown }).spots)) throw new Error("HamQTH: неизвестный формат ответа");
  const rows = (value as { spots: unknown[] }).spots;
  if (rows.length > 200) throw new Error("HamQTH: превышен размер ответа");
  const unique = new Map<string, DxSpot>();
  let recognized = 0;

  for (const value of rows) {
    if (!value || typeof value !== "object") continue;
    const s = value as Record<string, unknown>;
    if (typeof s.dxcall !== "string" || !/^[A-Z0-9/]{2,32}$/i.test(s.dxcall) ||
      typeof s.spotter !== "string" || !/^[A-Z0-9/#-]{2,32}$/i.test(s.spotter) ||
      typeof s.time !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s.time)) continue;

    const time = Date.parse(s.time);
    if (!Number.isFinite(time)) continue;

    const freq = normalizeFrequencyKHz(s.freq);
    if (freq === null) continue;

    recognized++;
    const band = dxBand(freq);
    if (!band) continue;

    const dxcall = s.dxcall.toUpperCase();
    const spotter = s.spotter.toUpperCase();
    const mode = typeof s.mode === "string" ? s.mode.trim().toUpperCase() : null;
    const id = `${dxcall}:${freq}:${time}:${spotter}`;

    // Deduplicate by callsign + frequency; keep the freshest spot report
    const dedupKey = `${dxcall}:${freq}`;
    const existing = unique.get(dedupKey);
    if (!existing || existing.time < time) {
      unique.set(dedupKey, { id, call: dxcall, frequency: freq, time, spotter, band, mode });
    }
  }

  if (rows.length && !recognized) throw new Error("HamQTH: отсутствуют корректные споты");
  return [...unique.values()].sort((a,b) => b.time - a.time);
}

export function freshDx(spots: DxSpot[], now: number, band: string | null = null) {
  return spots.filter(s => s.time <= now + 60000 && now - s.time <= DX_MAX_AGE && (!band || s.band === band));
}

export function dxAvailable(spot: DxSpot, range: DxRange) {
  return !!range && spot.frequency >= range.min && spot.frequency <= range.max;
}

export function projectDx(spots: DxSpot[], view: { start: number; span: number }, width: number) {
  if (!Number.isFinite(view.start) || !Number.isFinite(view.span) || view.span <= 0 || width <= 0) return [];
  const occupied: [number, number][][] = [[],[],[]];
  const seen = new Set<string>();
  const result: { spot: DxSpot; x: number; labelLeft: number; lane: number }[] = [];
  const labelWidth = Math.min(96, width);
  for (const spot of spots) {
    if (spot.frequency < view.start || spot.frequency > view.start + view.span) continue;
    const key = `${spot.call}:${spot.frequency}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const x = (spot.frequency - view.start) / view.span * width;
    const labelLeft = Math.max(0, Math.min(width - labelWidth, x - labelWidth / 2));
    const lane = occupied.findIndex(intervals => !intervals.some(([a,b]) => labelLeft < b + 4 && labelLeft + labelWidth > a - 4));
    if (lane < 0) continue;
    occupied[lane].push([labelLeft,labelLeft + labelWidth]);
    result.push({spot,x,labelLeft,lane});
    if (result.length === 12) break;
  }
  return result;
}
