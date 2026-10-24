import { useEffect, useRef, useState } from "react";
import "./frequency-nudges.css";

const deltas = [-10000, -1000, -100, 100, 1000, 10000];
const stepLabel = (delta: number) => Math.abs(delta) >= 1000 ? `${Math.abs(delta) / 1000} kHz` : `${Math.abs(delta)} Hz`;

export function FrequencyNudges({ onNudge }: { onNudge: (deltaHz: number) => void }) {
  const latest = useRef(onNudge);
  latest.current = onNudge;
  const held = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [active, setActive] = useState<number | null>(null);

  function stop() {
    clearTimeout(timer.current);
    timer.current = undefined;
    held.current = null;
    setActive(null);
  }
  function begin(token: string, delta: number) {
    if (held.current !== null) return;
    held.current = token;
    setActive(delta);
    latest.current(delta);
    const tick = () => {
      timer.current = undefined;
      if (held.current !== token) return;
      latest.current(delta);
      if (held.current === token) timer.current = setTimeout(tick, 80);
    };
    if (held.current === token) timer.current = setTimeout(tick, 400);
  }
  useEffect(() => {
    const release = () => { if (held.current?.startsWith("pointer:")) stop(); };
    window.addEventListener("blur", stop);
    window.addEventListener("pagehide", stop);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    document.addEventListener("visibilitychange", stop);
    return () => {
      stop();
      window.removeEventListener("blur", stop);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      document.removeEventListener("visibilitychange", stop);
    };
  }, []);

  return <div className="frequency-nudges" role="group" aria-label="Быстрая подстройка частоты" data-direction={active === null ? "idle" : active < 0 ? "down" : "up"}>
    {[deltas.slice(0, 3), deltas.slice(3)].map((group, index) => <div className="frequency-nudges-group" key={index}>
      {group.map(delta => <button type="button" key={delta}
        className={active === delta ? "nudge-held" : ""}
        aria-label={`Частота ${delta < 0 ? "минус" : "плюс"} ${Math.abs(delta)} Гц`}
        aria-describedby="frequency-nudge-hint"
        title={`${delta < 0 ? "Уменьшить" : "Увеличить"} на ${stepLabel(delta)}`}
        onPointerDown={e => {
          if (held.current !== null || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
          e.preventDefault();
          e.currentTarget.focus({ preventScroll: true });
          e.currentTarget.setPointerCapture(e.pointerId);
          begin(`pointer:${e.pointerId}`, delta);
        }}
        onPointerUp={e => { if (held.current === `pointer:${e.pointerId}`) stop(); }}
        onPointerCancel={e => { if (held.current === `pointer:${e.pointerId}`) stop(); }}
        onLostPointerCapture={e => { if (held.current === `pointer:${e.pointerId}`) stop(); }}
        onKeyDown={e => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault(); e.stopPropagation();
          if (!e.repeat) begin(`key:${e.key}`, delta);
        }}
        onKeyUp={e => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault(); e.stopPropagation();
          if (held.current === `key:${e.key}`) stop();
        }}
        onBlur={stop}
        onClick={e => { if (e.detail === 0 && held.current === null) latest.current(delta); }}
        onContextMenu={e => e.preventDefault()}
      >
        <svg className="nudge-arrow" width="17" height="14" viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={delta > 0 ? { transform: "rotate(180deg)" } : undefined}><path d="M17 8H3m6-6L3 8l6 6"/></svg>
        <span>{stepLabel(delta)}</span>
      </button>)}
    </div>)}
    <output className="nudge-motion" aria-live="off">{active === null ? "← НИЖЕ · ВЫШЕ →" : `${active < 0 ? "← НИЖЕ" : "ВЫШЕ →"} · ${stepLabel(active)}`}</output>
    <small id="frequency-nudge-hint">Нажми — шаг · Удерживай — перестройка</small>
  </div>;
}
