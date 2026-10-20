export type Point = { lat: number; lon: number };
export type Repeater = Point & {
  id: string;
  callsign: string;
  frequency: string;
  shift: string;
  tones: string;
  name: string;
  source: string;
};
type Element = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: Point;
  tags?: Record<string, string>;
};
const prefix = "communication:amateur_radio:repeater";

export function distanceKm(a: Point, b: Point) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function frequency(value?: string) {
  if (!value) return "нет данных";
  // OSM specifies Hz without a unit; retain compound/unknown source values.
  if (/^[+-]?\d+(\.\d+)?$/.test(value)) return `${Number(value) / 1e6} МГц`;
  return value;
}
export function parseRepeaters(elements: Element[]): Repeater[] {
  return elements.flatMap((e) => {
    const p = e.center || e,
      t = e.tags || {};
    if (
      !Number.isFinite(p.lat) ||
      !Number.isFinite(p.lon) ||
      Math.abs(p.lat!) > 90 ||
      Math.abs(p.lon!) > 180
    )
      return [];
    const rawCall = t["communication:amateur_radio:callsign"] || t[prefix];
    const callsign =
      rawCall && !["yes", "no", "1", "true"].includes(rawCall.toLowerCase())
        ? rawCall
        : "Позывной не указан";
    return [
      {
        lat: p.lat!,
        lon: p.lon!,
        id: `${e.type}/${e.id}`,
        callsign,
        name: t.name || "Радиолюбительский репитер",
        frequency: frequency(
          t[`${prefix}:frequency_out`] ||
            t["communication:amateur_radio:frequency_out"],
        ),
        shift: frequency(
          t[`${prefix}:shift`] || t["communication:amateur_radio:shift"],
        ),
        tones:
          [
            ["ctcss", "CTCSS"],
            ["dcs", "DCS"],
            ["toneburst", "Тон вызова"],
          ]
            .flatMap(([key, label]) =>
              t[`${prefix}:${key}`]
                ? [
                    `${label}: ${t[`${prefix}:${key}`]}${key === "dcs" ? "" : " Гц"}`,
                  ]
                : [],
            )
            .join(" · ") || "нет данных",
        source: `https://www.openstreetmap.org/${e.type}/${e.id}`,
      },
    ];
  });
}
const cache = new Map<string, { time: number; rows: Repeater[] }>();
export async function nearbyRepeaters(
  point: Point,
  radius: number,
  signal: AbortSignal,
) {
  const key = `${point.lat.toFixed(3)},${point.lon.toFixed(3)},${radius}`;
  const saved = cache.get(key);
  if (saved && Date.now() - saved.time < 15 * 60_000) return saved.rows;
  const query = `[out:json][timeout:20];nwr(around:${radius * 1000},${point.lat},${point.lon})["${prefix}"]["${prefix}"!="no"];out center tags;`;
  const options: RequestInit = {
    method: "POST", body: new URLSearchParams({ data: query }), signal,
    credentials: "omit", referrerPolicy: "strict-origin-when-cross-origin",
  };
  let response: Response | undefined;
  try {
    response = await fetch("https://overpass-api.de/api/interpreter", options);
  } catch (error) {
    if (signal.aborted) throw error;
  }
  // At most one fallback request; do not retry a rate-limited service.
  if (!response || (!response.ok && response.status !== 429 && !signal.aborted))
    response = await fetch("https://overpass.kumi.systems/api/interpreter", options);
  if (!response.ok)
    throw new Error(
      `Каталог временно недоступен (${response.status}). Повторите поиск позже.`,
    );
  const data = await response.json();
  if (data.remark || !Array.isArray(data.elements))
    throw new Error(
      "Каталог не завершил поиск. Попробуйте позже или уменьшите радиус.",
    );
  const rows = parseRepeaters(data.elements)
    .filter((r) => distanceKm(point, r) <= radius)
    .sort((a, b) => distanceKm(point, a) - distanceKm(point, b));
  if (cache.size >= 5) cache.delete(cache.keys().next().value!);
  cache.set(key, { time: Date.now(), rows });
  return rows;
}
