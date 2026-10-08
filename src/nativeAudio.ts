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
  (/Android|iPhone|iPad/i.test(navigator.userAgent) ||
    (navigator as Navigator & { userAgentData?: { mobile: boolean } })
      .userAgentData?.mobile === true ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

// Autoplay denial and an interrupted play() are not evidence of a bad stream.
export function nativeStreamUnavailable(
  error: unknown,
  mediaError: number | null,
) {
  const name =
    error && typeof error === "object" && "name" in error ? error.name : "";
  if (name === "AbortError" || name === "NotAllowedError") return false;
  return name === "NotSupportedError" || [2, 3, 4].includes(mediaError ?? 0);
}
