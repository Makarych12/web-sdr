import { MODES, FILTER_WIDTHS, type Mode } from "./radio";
export type RadioSession = {
  frequency: number;
  mode: Mode;
  zoom: number;
  viewCenter: number;
  agc: "fast" | "slow" | "off";
  receiver: string;
  playing: boolean;
  width: number;
};
const key = "wave.radio.session";
export function readRadioSession(): RadioSession | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(key) || "null");
    if (
      !v ||
      !Number.isFinite(v.frequency) ||
      v.frequency < 0 ||
      v.frequency > 30000 ||
      !MODES.includes(v.mode) ||
      !FILTER_WIDTHS[v.mode as Mode].includes(v.width) ||
      !Number.isInteger(v.zoom) ||
      v.zoom < 0 ||
      v.zoom > 14 ||
      !Number.isFinite(v.viewCenter) ||
      v.viewCenter < 0 ||
      v.viewCenter > 32000 ||
      !["fast", "slow", "off"].includes(v.agc) ||
      typeof v.receiver !== "string" ||
      typeof v.playing !== "boolean"
    )
      return null;
    return v;
  } catch {
    return null;
  }
}
export function saveRadioSession(v: RadioSession) {
  try {
    sessionStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* Audio works when session storage is unavailable. */
  }
}
export function playbackSession() {
  const session = (navigator as Navigator & { audioSession?: { type: string } })
    .audioSession;
  if (session)
    try {
      session.type = "playback";
    } catch {
      /* Feature detection, no dependency on this experimental API. */
    }
}
