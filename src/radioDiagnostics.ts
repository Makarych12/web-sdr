type Fields = Record<string, unknown>;
type Store = Pick<Storage, "getItem" | "setItem">;
const KEY = "ur4mtn.radio-diagnostics.v1";
const LIMIT = 120;

/** Bounded, synchronous persistence at lifecycle boundaries; no background timer. */
export class RadioDiagnostics {
  private rows: Fields[] = [];
  private lastPcm: number | null = null;
  private pcmSavedAt = -Infinity;
  snapshot: () => Fields = () => ({});
  persistent = true;
  constructor(private storage: Store | undefined, private now = Date.now) {
    try {
      const saved = JSON.parse(storage?.getItem(KEY) || "null");
      if (Array.isArray(saved?.rows)) this.rows = saved.rows.slice(-LIMIT);
      if (typeof saved?.lastPcm === "number") this.lastPcm = saved.lastPcm;
      if (!storage) this.persistent = false;
    } catch { this.persistent = false; }
  }
  pcm() {
    this.lastPcm = this.now();
    if (this.lastPcm - this.pcmSavedAt >= 5000) {
      this.pcmSavedAt = this.lastPcm;
      this.record("pcm");
    }
  }
  record(type: string, fields: Fields = {}) {
    const now = this.now();
    this.rows.push({ ...this.snapshot(), ...fields, type, at: new Date(now).toISOString(),
      lastPcm: this.lastPcm === null ? null : new Date(this.lastPcm).toISOString(),
      pcmAgeMs: this.lastPcm === null ? null : now - this.lastPcm });
    this.rows = this.rows.slice(-LIMIT);
    try {
      this.storage?.setItem(KEY, JSON.stringify({ rows: this.rows, lastPcm: this.lastPcm }));
    } catch { this.persistent = false; }
  }
  text() { return this.rows.map(row => JSON.stringify(row)).join("\n"); }
}
let storage: Storage | undefined;
try { storage = globalThis.localStorage; } catch { /* restricted browser storage */ }
export const radioDiagnostics = new RadioDiagnostics(storage);
let socketSequence = 0;
export function observeRadioSocket(socket: WebSocket) {
  const id = ++socketSequence;
  const url = new URL(socket.url);
  const fields = () => ({ id, endpoint: url.host + url.pathname, wssState: socket.readyState });
  radioDiagnostics.record("wss_created", fields());
  socket.addEventListener("open", () => radioDiagnostics.record("wss_open", fields()));
  socket.addEventListener("error", () => radioDiagnostics.record("wss_error", fields()));
  socket.addEventListener("close", event => radioDiagnostics.record("wss_close", {
    ...fields(), code: event.code, reason: event.reason, clean: event.wasClean,
  }));
}
