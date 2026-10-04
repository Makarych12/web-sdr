export type Mode = "AM" | "USB" | "LSB" | "CW" | "FM";
export const MODES: Mode[] = ["AM", "USB", "LSB", "CW", "FM"];
export const DEFAULT_WIDTHS: Record<Mode, number> = {
  AM: 10000,
  USB: 2400,
  LSB: 2400,
  CW: 400,
  FM: 12000,
};
export const FILTER_WIDTHS: Record<Mode, number[]> = {
  AM: [2500, 5000, 8000, 10000],
  USB: [1000, 1800, 2400, 3000, 5000],
  LSB: [1000, 1800, 2400, 3000, 5000],
  CW: [100, 250, 400, 800, 1000],
  FM: [6000, 9000, 12000],
};
export function passband(mode: Mode, width: number) {
  switch (mode) {
    case "USB":
      return { lowCut: 300, highCut: 300 + width };
    case "LSB":
      return { lowCut: -300 - width, highCut: -300 };
    case "CW":
      return { lowCut: 600 - width / 2, highCut: 600 + width / 2 };
    default:
      return { lowCut: -width / 2, highCut: width / 2 };
  }
}
export function signalLabel(db: number) {
  if (db > -73) return `S9 +${Math.round(db + 73)}`;
  return `S${Math.max(0, Math.min(9, Math.floor((db + 127) / 6)))}`;
}
