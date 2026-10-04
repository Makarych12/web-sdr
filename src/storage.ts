import { useState, useEffect } from "react";
export function readStored<T>(
  key: string,
  fallback: T,
  valid: (value: unknown) => value is T,
): T {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
export function useStoredState<T>(
  key: string,
  fallback: T,
  valid: (value: unknown) => value is T,
) {
  const [value, setValue] = useState(() => readStored(key, fallback, valid));
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Reception still works if storage is unavailable. */
    }
  }, [key, value]);
  return [value, setValue] as const;
}
export const stringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 2000 && v.every((x) => typeof x === "string");
export const finiteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
