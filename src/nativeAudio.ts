import type { StreamConfig } from "./connection";
// View zoom/pan never restart or retune the native audio stream.
export function nativeAudioURL(
  base: string,
  config: StreamConfig,
  session?: string,
) {
  const url = new URL("/api/audio", base);
  if (session) url.searchParams.set("session", session);
  for (const key of [
    "receiver",
    "frequency",
    "mode",
    "lowCut",
    "highCut",
    "agc",
  ] as const)
    if (config[key] !== undefined)
      url.searchParams.set(key, String(config[key]));
  return url.href;
}
export const needsNativeBackground =
  typeof navigator !== "undefined" &&
  /Android|iPhone|iPad/i.test(navigator.userAgent);
