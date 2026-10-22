import { useEffect, useState } from "react";
import { DX_INTERVAL, DX_URL, parseDxSpots, type DxSpot } from "./dxCluster";
export function useDxCluster() {
  const [enabled, setEnabled] = useState(false);
  const [spots, setSpots] = useState<DxSpot[]>([]);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    let disposed = false, due = 0, failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | null = null;
    const schedule = () => {
      clearTimeout(timer);
      if (!disposed && document.visibilityState === "visible") timer = setTimeout(() => void poll(), Math.max(0,due-Date.now()));
    };
    async function poll() {
      if (disposed || request || document.visibilityState !== "visible") return;
      if (Date.now() < due) { schedule(); return; }
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(),10000);
      let retry = DX_INTERVAL;
      try {
        if (!navigator.onLine) throw new Error("Нет подключения к сети");
        const response = await fetch(DX_URL, { signal: request.signal, credentials: "omit", referrerPolicy: "no-referrer" });
        if (!response.ok) {
          const header = response.headers.get("Retry-After");
          const delay = header && /^\d+$/.test(header) ? Number(header)*1000 : header ? Date.parse(header)-Date.now() : 0;
          if (Number.isFinite(delay)) retry = Math.max(retry,delay);
          throw new Error(`HamQTH: HTTP ${response.status}`);
        }
        const data = parseDxSpots(await response.json());
        if (!disposed) { setSpots(data); setUpdated(Date.now()); setNow(Date.now()); setError(""); }
        failures = 0;
      } catch (e) {
        failures++;
        retry = Math.max(retry, Math.min(300000, DX_INTERVAL * 2 ** Math.min(failures,3)));
        if (!disposed) setError(`DX-источник недоступен. ${e instanceof Error && e.name !== "AbortError" ? e.message : "Превышено время ожидания"}. Повтор автоматически.`);
      } finally {
        clearTimeout(timeout); request = null; due = Date.now()+retry; schedule();
      }
    }
    const visibility = () => { setNow(Date.now()); schedule(); };
    const aging = setInterval(() => { if (document.visibilityState === "visible") setNow(Date.now()); },15000);
    document.addEventListener("visibilitychange",visibility);
    void poll();
    return () => { disposed = true; clearTimeout(timer); clearInterval(aging); request?.abort(); document.removeEventListener("visibilitychange",visibility); };
  }, [enabled]);
  return { enabled, enable: () => setEnabled(true), spots, error, updated, now };
}
export type DxFeed = ReturnType<typeof useDxCluster>;
