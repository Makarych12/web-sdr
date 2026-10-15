import type { Mode } from "./radio";
export const STEPS_HZ = [1, 5, 10, 50, 100, 500, 1000, 5000, 10000];
export const MODE_STEP: Record<Mode, number> = {
  USB: 10,
  LSB: 10,
  CW: 1,
  AM: 100,
  FM: 1000,
};
export type Cuts = { lowCut: number; highCut: number };
export type Preset = "Narrow" | "Normal" | "Wide";
export function parseFrequency(text: string): number | null {
  const match = text
    .trim()
    .replace(",", ".")
    .match(/^(\d+)(?:\.(\d+))?\s*(Hz|kHz|MHz)?$/i);
  if (!match) return null;
  const places = { hz: 0, khz: 3, mhz: 6 }[(match[3] || "khz").toLowerCase()]!;
  const fraction = match[2] || "";
  if (fraction.slice(places).replace(/0/g, "")) return null;
  const value =
    Number(match[1]) * 10 ** places +
    Number(fraction.slice(0, places).padEnd(places, "0"));
  return Number.isSafeInteger(value) && value >= 0 && value <= 30000000
    ? value
    : null;
}
export function stepFrequency(hz: number, step: number, ticks: number) {
  return Math.max(
    0,
    Math.min(30000000, Math.round(hz) + Math.round(step) * Math.trunc(ticks)),
  );
}
export function filterPreset(mode: Mode, preset: Preset): Cuts {
  const index = ["Narrow", "Normal", "Wide"].indexOf(preset);
  if (mode === "USB" || mode === "LSB") {
    const lo = [400, 300, 100][index],
      hi = [2200, 2700, 3000][index];
    return mode === "USB"
      ? { lowCut: lo, highCut: hi }
      : { lowCut: -hi, highCut: -lo };
  }
  const half = (
    mode === "CW"
      ? [250, 250, 500]
      : mode === "FM"
        ? [3000, 5000, 6000]
        : [3000, 5000, 6000]
  )[index];
  return { lowCut: -half, highCut: half };
}
export function validCuts(v: unknown): v is Cuts {
  const c = v as Cuts;
  return (
    !!c &&
    Number.isInteger(c.lowCut) &&
    Number.isInteger(c.highCut) &&
    c.lowCut >= -6000 &&
    c.highCut <= 6000 &&
    c.highCut - c.lowCut >= 50
  );
}
