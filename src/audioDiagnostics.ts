// Local-only evidence of interruptions. Never store URLs/session tokens.
type Entry = { at: string; event: string; state: Record<string, unknown> };
const key = "wave.audio.diagnostics";
let entries: Entry[] = [];
try {
  const saved = JSON.parse(sessionStorage.getItem(key) || "[]");
  if (Array.isArray(saved)) entries = saved.slice(-80);
} catch {}
export function audioDiagnostic(
  event: string,
  state: Record<string, unknown> = {},
) {
  entries.push({ at: new Date().toISOString(), event, state });
  entries = entries.slice(-80);
  try {
    sessionStorage.setItem(key, JSON.stringify(entries));
  } catch {}
}
export function audioDiagnosticReport() {
  return JSON.stringify(
    {
      version: "background-9",
      userAgent: navigator.userAgent,
      events: entries,
    },
    null,
    2,
  );
}
export function audioSnapshot(audio: HTMLAudioElement | null) {
  return audio
    ? {
        paused: audio.paused,
        ended: audio.ended,
        ready: audio.readyState,
        network: audio.networkState,
        time: Math.round(audio.currentTime * 100) / 100,
        error: audio.error?.code ?? null,
      }
    : null;
}
