import { FILTER_WIDTHS, type Mode } from "./radio";
import { validCuts, type Cuts } from "./tuning";

export type SavedFrequency = {
  id: string;
  frequency: number;
  mode: Mode;
  width?: number;
  cuts?: Cuts;
  name?: string;
};

// Preserve the existing wave.frequencies format, including unnamed legacy entries.
export const savedFrequencies = (value: unknown): value is SavedFrequency[] =>
  Array.isArray(value) && value.length <= 1000 && value.every((entry) =>
    entry && typeof entry.id === "string" &&
    Number.isFinite(entry.frequency) && entry.frequency >= 0 && entry.frequency <= 30000 &&
    Object.hasOwn(FILTER_WIDTHS, entry.mode) &&
    (entry.cuts === undefined || validCuts(entry.cuts)) &&
    (entry.width === undefined || FILTER_WIDTHS[entry.mode as Mode].includes(entry.width)) &&
    (entry.name === undefined || (typeof entry.name === "string" && entry.name.length <= 120)));

export function memoryId(frequency: number, mode: Mode) {
  return `${frequency}-${mode}`;
}

export function mergeMemories(existing: SavedFrequency[], incoming: SavedFrequency[]) {
  const merged = new Map<string, SavedFrequency>();
  for (const entry of [...existing, ...incoming]) {
    const id = memoryId(entry.frequency, entry.mode);
    merged.set(id, { id, frequency: entry.frequency, mode: entry.mode,
      ...(entry.width === undefined ? {} : { width: entry.width }),
      ...(entry.cuts === undefined ? {} : { cuts: { ...entry.cuts } }),
      ...(entry.name === undefined ? {} : { name: entry.name.trim() }) });
  }
  if (merged.size > 1000) throw new Error("В памяти допускается не более 1000 станций");
  return [...merged.values()];
}

export function parseMemoryJson(text: string): SavedFrequency[] {
  const value: unknown = JSON.parse(text);
  if (!savedFrequencies(value)) throw new Error("Некорректный список станций JSON");
  return mergeMemories([], value);
}
