import { gateway } from "./gateway";
export type Point = { lat: number; lon: number };
export type Repeater = Point & {
  id: string;
  callsign: string;
  frequency?: string;
  shift?: string;
  tones?: string;
  name?: string;
  source: string;
};
export type RepeaterResult = {
  rows: Repeater[];
  count: number;
  fetchedAt: string;
  source: string;
};
export function distanceKm(a: Point, b: Point) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export async function nearbyRepeaters(
  point: Point,
  radius: number,
  signal: AbortSignal,
): Promise<RepeaterResult> {
  let response: Response;
  try {
    response = await fetch(
      `${gateway.http}/api/repeaters?${new URLSearchParams({
        lat: String(point.lat),
        lon: String(point.lon),
        radius: String(radius),
      })}`,
      { signal, cache: "no-store" },
    );
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(
      "Нет связи с каталогом репитеров. Проверьте интернет и нажмите «Повторить загрузку».",
    );
  }
  let data: RepeaterResult & { error?: string };
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "Сервер каталога вернул неверный ответ. Нажмите «Повторить загрузку».",
    );
  }
  if (!response.ok)
    throw new Error(
      data.error ||
        `Каталог недоступен (HTTP ${response.status}). Повторите загрузку.`,
    );
  if (
    !Array.isArray(data.rows) ||
    !Number.isInteger(data.count) ||
    data.count < data.rows.length ||
    data.source !== "HearHam" ||
    typeof data.fetchedAt !== "string" ||
    data.rows.some(
      (r) =>
        !r ||
        !Number.isFinite(r.lat) ||
        !Number.isFinite(r.lon) ||
        Math.abs(r.lat) > 90 ||
        Math.abs(r.lon) > 180 ||
        distanceKm(point, r) > radius + 0.01 ||
        typeof r.id !== "string" ||
        typeof r.callsign !== "string" ||
        !/^https:\/\/hearham\.com\/repeaters\/\d+$/.test(r.source),
    )
  )
    throw new Error(
      "Каталог вернул некорректные записи. Нажмите «Повторить загрузку».",
    );
  return data;
}
