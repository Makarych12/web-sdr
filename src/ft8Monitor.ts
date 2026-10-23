import database from "./data/dxcc.json";
import type { Ft8Message } from "./ft8";

export const FT8_BANDS = [
  ["160m", 1840, 1800, 2000],
  ["80m", 3573, 3500, 4000],
  ["60m", 5357, 5250, 5450],
  ["40m", 7074, 7000, 7300],
  ["30m", 10136, 10100, 10150],
  ["20m", 14074, 14000, 14350],
  ["17m", 18100, 18068, 18168],
  ["15m", 21074, 21000, 21450],
  ["12m", 24915, 24890, 24990],
  ["10m", 28074, 28000, 29700],
  ["6m", 50313, 50000, 54000],
] as const;
export function bandFor(khz: number): string {
  return (
    FT8_BANDS.find(([, , lo, hi]) => khz >= lo && khz <= hi)?.[0] ?? "other"
  );
}
export const bandLabel = (band: string) =>
  band === "other" ? "Вне диапазонов" : band;
const ru = new Intl.DisplayNames(["ru"], { type: "region" }),
  en = new Intl.DisplayNames(["en"], { type: "region" });
const continentNames: Record<string, string> = {
  EU: "Европа",
  AS: "Азия",
  AF: "Африка",
  NA: "Северная Америка",
  SA: "Южная Америка",
  OC: "Океания",
  AN: "Антарктида",
};
const entities = database.entities
  .filter((e) => e.prefixRegex)
  .map((e) => {
    const source = e.prefixRegex.replaceAll("^", "").replaceAll("$", "");
    const prefix = source.replace(/\[[^\]]+\]\*/g, "");
    const translated =
      e.countryCode !== "ZZ" ? ru.of(e.countryCode) : undefined;
    return {
      ...e,
      label: translated
        ? en.of(e.countryCode) === e.name
          ? translated
          : `${e.name} · ${translated}`
        : e.name,
      full: new RegExp(`^(?:${source})$`),
      head: new RegExp(`^(?:${prefix})`),
    };
  });
export type Country = {
  id: string;
  name: string;
  continent: string;
  prefix: string;
};
export const UNKNOWN: Country = {
  id: "unknown",
  name: "Не определена",
  continent: "Не определён",
  prefix: "—",
};
const isBaseCall = (s: string) => /^(?=.{3,12}$)[A-Z0-9]*\d[A-Z]+$/.test(s);
const isCall = (s: string) =>
  /^(?=.{3,20}$)[A-Z0-9/]+$/.test(s) && s.split("/").some(isBaseCall);
function resolvePrefix(call: string): Country {
  const matches = entities
    .filter((e) => e.full.test(call))
    .map((e) => ({ e, matched: e.head.exec(call)?.[0] ?? "" }));
  const best = Math.max(0, ...matches.map((m) => m.matched.length));
  const winners = matches.filter((m) => m.matched.length === best);
  if (winners.length !== 1 || !best) return UNKNOWN;
  const { e, matched } = winners[0];
  return {
    id: String(e.entityCode),
    name: e.label,
    continent: e.continent.map((c) => continentNames[c] ?? c).join(" / "),
    prefix: matched,
  };
}
export function countryFor(raw: string): Country {
  const call = raw.toUpperCase();
  if (!isCall(call) || /\/(MM|AM)$/.test(call)) return UNKNOWN;
  const parts = call.replace(/\/(P|M|QRP)$/, "").split("/");
  if (parts.length === 1) return resolvePrefix(parts[0]);
  if (parts.length !== 2) return UNKNOWN;
  const full = parts.filter(isBaseCall);
  if (full.length !== 1) return UNKNOWN;
  const operating = parts.find((p) => p !== full[0]);
  if (!operating || /^\d+$/.test(operating)) return UNKNOWN;
  return resolvePrefix(operating);
}
export type Grid = {
  lat: number;
  lon: number;
  west: number;
  east: number;
  south: number;
  north: number;
};
export function maidenhead(raw: string): Grid | null {
  const s = raw.toUpperCase();
  if (!/^[A-R]{2}\d{2}([A-X]{2})?$/.test(s)) return null;
  let west = (s.charCodeAt(0) - 65) * 20 - 180 + Number(s[2]) * 2,
    south = (s.charCodeAt(1) - 65) * 10 - 90 + Number(s[3]);
  const width = s.length === 6 ? 1 / 12 : 2,
    height = s.length === 6 ? 1 / 24 : 1;
  if (s.length === 6) {
    west += (s.charCodeAt(4) - 65) / 12;
    south += (s.charCodeAt(5) - 65) / 24;
  }
  return {
    lat: south + height / 2,
    lon: west + width / 2,
    west,
    east: west + width,
    south,
    north: south + height,
  };
}
export type MessageKind =
  "cq" | "cqdx" | "region" | "report" | "end" | "grid" | "special";
export const TYPE_LABELS: Record<MessageKind, string> = {
  cq: "CQ",
  cqdx: "CQ DX",
  region: "CQ регион",
  report: "Рапорт",
  end: "73 / RRR",
  grid: "Локатор",
  special: "Спец. / текст",
};
export type Parsed = {
  kind: MessageKind;
  call: string;
  to: string;
  locator: string;
  region: string;
  explanation: string;
  country: Country;
};
export function parseFt8(raw: string): Parsed {
  const tokens = raw.trim().toUpperCase().split(/\s+/);
  let kind: MessageKind = "special",
    call = "",
    to = "",
    locator = "",
    region = "",
    explanation =
      "Специальное сообщение или свободный текст. Автоматическая интерпретация недоступна.";
  const knownCall = (t: string | undefined) =>
    !!t && (isCall(t) || /^<[A-Z0-9/]+>$/.test(t) || t === "<...>");
  if (tokens[0] === "CQ") {
    const modifier = knownCall(tokens[1]) ? "" : (tokens[1] ?? "");
    const index = modifier ? 2 : 1;
    if (
      (!modifier || /^[A-Z]{1,4}$|^\d{3}$/.test(modifier)) &&
      knownCall(tokens[index]) &&
      (tokens.length === index + 1 ||
        (tokens.length === index + 2 && maidenhead(tokens[index + 1])))
    ) {
      kind = modifier === "DX" ? "cqdx" : modifier ? "region" : "cq";
      call = tokens[index];
      locator = tokens[index + 1] ?? "";
      region = modifier;
      explanation =
        modifier === "DX"
          ? "Вызов дальних станций (CQ DX)."
          : modifier
            ? `Направленный вызов: ${modifier}. Это адресат вызова, не местоположение станции.`
            : "Общий вызов (CQ).";
    }
  } else if (
    tokens.length === 3 &&
    knownCall(tokens[0]) &&
    knownCall(tokens[1])
  ) {
    const extra = tokens[2];
    to = tokens[0];
    call = tokens[1];
    if (/^(R[+-]|[+-])\d{2}$/.test(extra)) {
      kind = "report";
      explanation = extra.startsWith("R")
        ? `${call} подтверждает приём и передаёт ${to} рапорт ${extra.slice(1)} dB.`
        : `${call} передаёт ${to} рапорт ${extra} dB.`;
    } else if (["RRR", "RR73", "73"].includes(extra)) {
      kind = "end";
      explanation =
        extra === "RRR"
          ? `${call} подтверждает приём сообщения от ${to}.`
          : `${call}: подтверждение / завершение обмена с ${to} (${extra}).`;
    } else if (maidenhead(extra)) {
      kind = "grid";
      locator = extra;
      explanation = `${call} передаёт ${to} локатор ${locator}.`;
    } else {
      call = "";
      to = "";
    }
  }
  if (/^<[A-Z0-9/]+>$/.test(call)) call = call.slice(1, -1);
  const country = countryFor(call);
  if (locator) explanation += ` Локатор ${locator} — приблизительная область.`;
  return {
    kind,
    call: call === "<...>" ? "" : call,
    to,
    locator,
    region,
    explanation,
    country,
  };
}
export type MonitorRow = Ft8Message &
  Parsed & { id: number; band: string; frequency: number; fresh: boolean };
export type History = Record<string, { rows: MonitorRow[]; count: number }>;
export const HISTORY_MAX = 3000;
export function appendHistory(
  history: History,
  batch: Ft8Message[],
  frequency: number,
  limit: number,
  sequence: () => number,
): History {
  const band = bandFor(frequency),
    old = history[band] ?? { rows: [], count: 0 },
    seen = new Set(old.rows.map((r) => r.call));
  const rows = batch.map((row) => {
    const parsed = parseFt8(row.message);
    const fresh = !!parsed.call && !seen.has(parsed.call);
    seen.add(parsed.call);
    return { ...row, ...parsed, id: sequence(), band, frequency, fresh };
  });
  const next = {
    ...history,
    [band]: {
      rows: [...rows, ...old.rows].slice(0, limit),
      count: old.count + rows.length,
    },
  };
  // Keep the newest retained rows across all bands. Counters include evicted rows.
  const all = Object.values(next)
    .flatMap((h) => h.rows)
    .sort((a, b) => b.id - a.id);
  if (all.length > HISTORY_MAX) {
    const keep = new Set(all.slice(0, HISTORY_MAX).map((r) => r.id));
    for (const [key, h] of Object.entries(next))
      next[key] = { ...h, rows: h.rows.filter((r) => keep.has(r.id)) };
  }
  return next;
}
export function csvRows(rows: MonitorRow[]): string {
  const cell = (v: unknown) => {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(?:\.\d+)?$/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return (
    "\ufeff" +
    [
      [
        "UTC",
        "SNR (approx dB)",
        "DT",
        "AUDIO Hz",
        "CALLSIGN",
        "DXCC (inferred)",
        "GRID",
        "TYPE",
        "MESSAGE",
        "BAND",
        "DIAL kHz",
      ],
      ...rows.map((r) => [
        new Date(r.utc).toISOString(),
        r.snr.toFixed(1),
        r.dt.toFixed(2),
        r.hz.toFixed(0),
        r.call,
        r.country.name,
        r.locator,
        TYPE_LABELS[r.kind],
        r.message,
        bandLabel(r.band),
        r.frequency,
      ]),
    ]
      .map((r) => r.map(cell).join(","))
      .join("\r\n")
  );
}
export function stations(rows: MonitorRow[]): MonitorRow[] {
  const unique = new Map<string, MonitorRow>();
  for (const r of [...rows].sort((a, b) => b.id - a.id))
    if (r.call && r.locator && maidenhead(r.locator)) {
      const key = `${r.call}|${r.locator}|${r.band}`;
      if (!unique.has(key)) unique.set(key, r);
    }
  return [...unique.values()];
}
