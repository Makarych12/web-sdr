import { maidenhead, stations, type History } from "./ft8Monitor";
import { freshDx, type DxSpot } from "./dxCluster";
const rad = Math.PI / 180;
/** NOAA fractional-year approximation; UTC, geometric solar centre (no refraction).
 * https://gml.noaa.gov/grad/solcalc/solareqns.PDF */
export function solarPosition(utc: number) {
  const date = new Date(utc),
    year = date.getUTCFullYear();
  const days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
  const day = Math.floor((utc - Date.UTC(year, 0, 1)) / 86400000) + 1;
  const minutes =
    date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const g = ((2 * Math.PI) / days) * (day - 1 + (minutes / 60 - 12) / 24);
  const equation =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const declination =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const longitude = (((720 - minutes - equation) / 4 + 540) % 360) - 180;
  return { declination, longitude };
}
export function solarDot(lat: number, lon: number, utc: number) {
  const s = solarPosition(utc);
  return (
    Math.sin(lat * rad) * Math.sin(s.declination) +
    Math.cos(lat * rad) *
      Math.cos(s.declination) *
      Math.cos((lon - s.longitude) * rad)
  );
}
export function pathFrom(
  origin: { lat: number; lon: number },
  destination: { lat: number; lon: number },
) {
  const a = origin.lat * rad,
    b = destination.lat * rad,
    d = (destination.lon - origin.lon) * rad;
  const h =
    Math.sin((b - a) / 2) ** 2 +
    Math.cos(a) * Math.cos(b) * Math.sin(d / 2) ** 2;
  const km =
    6371 *
    2 *
    Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)));
  const y = Math.sin(d) * Math.cos(b),
    x = Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(d);
  const bearing =
    km < 0.001 || Math.hypot(x, y) < 1e-12
      ? null
      : (Math.atan2(y, x) / rad + 360) % 360;
  return { km, bearing };
}
export type PropagationPoint = {
  id: string;
  call: string;
  source: "DX" | "FT8";
  grid: string;
  lat: number;
  lon: number;
  frequency: number;
  utc: number;
};
export function propagationPoints(
  history: History,
  spots: DxSpot[],
  now: number,
) {
  const rows = stations(
    Object.values(history)
      .flatMap((b) => b.rows)
      .filter((r) => r.utc <= now + 60000 && now - r.utc <= 30 * 60000),
  ).sort((a, b) => b.utc - a.utc);
  const known = new Map<string, (typeof rows)[number]>();
  const points: PropagationPoint[] = [];
  for (const row of rows) {
    const grid = maidenhead(row.locator)!;
    if (!known.has(row.call)) known.set(row.call, row);
    points.push({
      id: `ft8:${row.id}`,
      call: row.call,
      source: "FT8",
      grid: row.locator,
      lat: grid.lat,
      lon: grid.lon,
      frequency: row.frequency,
      utc: row.utc,
    });
  }
  let missing = 0;
  for (const spot of freshDx(spots, now)) {
    const row = known.get(spot.call);
    if (!row) {
      missing++;
      continue;
    }
    const grid = maidenhead(row.locator)!;
    points.push({
      id: `dx:${spot.id}`,
      call: spot.call,
      source: "DX",
      grid: row.locator,
      lat: grid.lat,
      lon: grid.lon,
      frequency: spot.frequency,
      utc: spot.time,
    });
  }
  return { points, missing };
}
