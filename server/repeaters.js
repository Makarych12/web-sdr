// Isolated, lazy catalogue: no timers, SDR sockets, credentials or paid services.
const SOURCE = "https://hearham.com/api/repeaters/v1";
const TTL = 60 * 60 * 1000;
let cached;
let loading;
const number = (v) =>
  v === null || v === undefined || v === ""
    ? undefined
    : Number.isFinite(Number(v))
      ? Number(v)
      : undefined;
const text = (v) => (typeof v === "string" ? v.trim() : "");
const mhz = (v) => {
  const n = number(v);
  return n === undefined ? undefined : `${n / 1e6} МГц`;
};
export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function parseHearHam(data) {
  if (!Array.isArray(data))
    throw new Error("Неверный формат каталога HearHam.");
  const ids = new Set();
  return data.flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    const lat = number(r.latitude),
      lon = number(r.longitude);
    if (
      lat === undefined ||
      lon === undefined ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180 ||
      (lat === 0 && lon === 0) ||
      !Number.isSafeInteger(r.id) ||
      ids.has(r.id)
    )
      return [];
    ids.add(r.id);
    return [
      {
        id: `hearham/${r.id}`,
        lat,
        lon,
        callsign: text(r.callsign),
        name: text(r.city),
        frequency: number(r.frequency) > 0 ? mhz(r.frequency) : undefined,
        shift: mhz(r.offset),
        tones:
          [
            [r.encode, "TX"],
            [r.decode, "RX"],
          ]
            .flatMap(([value, label]) =>
              text(value) ? [`${label}: ${text(value)}`] : [],
            )
            .join(" · ") || undefined,
        source: `https://hearham.com/repeaters/${r.id}`,
      },
    ];
  });
}
async function catalogue() {
  if (cached && Date.now() - cached.at < TTL) return cached;
  if (!loading) {
    loading = (async () => {
      const response = await fetch(SOURCE, {
        signal: AbortSignal.timeout(20000),
        headers: {
          Accept: "application/json",
          "User-Agent": "UR4MTN-WebSDR/1.0 (https://web-sdr.vercel.app)",
        },
      });
      if (!response.ok)
        throw new Error(`HearHam вернул HTTP ${response.status}.`);
      if (!response.headers.get("content-type")?.includes("json"))
        throw new Error("HearHam вернул ответ вместо JSON-каталога.");
      const rows = parseHearHam(await response.json());
      if (!rows.length)
        throw new Error("HearHam вернул каталог без корректных координат.");
      cached = { at: Date.now(), rows };
      return cached;
    })().finally(() => {
      loading = undefined;
    });
  }
  return loading;
}
export async function repeaterHandler(req, res) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Разрешён только GET." });
  const lat = number(req.query.lat),
    lon = number(req.query.lon),
    radius = number(req.query.radius);
  if (
    lat === undefined ||
    lon === undefined ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180 ||
    radius === undefined ||
    radius < 1 ||
    radius > 250
  )
    return res
      .status(400)
      .json({
        error: "Укажите корректные координаты и радиус от 1 до 250 км.",
      });
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const data = await catalogue();
    const rows = data.rows
      .map((r) => ({ ...r, distanceKm: distanceKm({ lat, lon }, r) }))
      .filter((r) => r.distanceKm <= radius)
      .sort((a, b) => a.distanceKm - b.distanceKm);
    res.json({
      source: "HearHam",
      sourceUrl: SOURCE,
      fetchedAt: new Date(data.at).toISOString(),
      count: rows.length,
      rows: rows.slice(0, 250),
    });
  } catch (error) {
    res
      .status(503)
      .json({
        error: `Не удалось загрузить репитеры. ${
          error.name === "TimeoutError"
            ? "Каталог HearHam не ответил вовремя."
            : error.message
        } Нажмите «Повторить загрузку».`,
      });
  }
}
