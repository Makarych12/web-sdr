import { MODES, FILTER_WIDTHS, type Mode } from "./radio";
export type QuickFrequency = {
  frequency: number;
  mode: Mode;
  name: string;
  width?: number;
};
export const defaultQuickFrequencies: QuickFrequency[] = [
  { frequency: 4625, mode: "USB", name: "4.625 MHz" },
  { frequency: 7074, mode: "USB", name: "40 м · 7.074 MHz" },
  { frequency: 10000, mode: "AM", name: "10 MHz" },
  { frequency: 14200, mode: "USB", name: "20 м · 14.200 MHz" },
];
export const quickKey = (v: QuickFrequency) => `${v.frequency}-${v.mode}`;
export function parseQuickFrequency(input: string, unit: "kHz" | "MHz") {
  const text = input.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const khz = Number(text) * (unit === "MHz" ? 1000 : 1);
  if (!Number.isFinite(khz) || khz <= 0 || khz > 30000) return null;
  const rounded = Math.round(khz * 1000) / 1000;
  return rounded > 0 ? rounded : null;
}
export function validQuickFrequencies(v: unknown): v is QuickFrequency[] {
  return (
    Array.isArray(v) &&
    v.length <= 24 &&
    v.every(
      (x) =>
        x &&
        typeof x.frequency === "number" &&
        Number.isFinite(x.frequency) &&
        x.frequency > 0 &&
        x.frequency <= 30000 &&
        MODES.includes(x.mode) &&
        typeof x.name === "string" &&
        x.name.length <= 40 &&
        (x.width === undefined ||
          FILTER_WIDTHS[x.mode as Mode].includes(x.width)),
    )
  );
}
export function rememberQuickFrequency(
  list: QuickFrequency[],
  entry: QuickFrequency,
  limit = 6,
) {
  return [entry, ...list.filter((v) => quickKey(v) !== quickKey(entry))].slice(
    0,
    limit,
  );
}
export function quickLabel(frequency: number) {
  return `${(frequency / 1000).toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} MHz`;
}
