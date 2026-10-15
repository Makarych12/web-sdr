import { useEffect, useRef } from "react";
import "./frequency-nudges.css";

const buttons = [
  { label: "---", delta: -10000 },
  { label: "--", delta: -1000 },
  { label: "-", delta: -100 },
  { label: "+", delta: 100 },
  { label: "++", delta: 1000 },
  { label: "+++", delta: 10000 },
];

export function FrequencyNudges({
  onNudge,
}: {
  onNudge: (deltaHz: number) => void;
}) {
  const latest = useRef(onNudge);
  latest.current = onNudge;
  const held = useRef<number | null>(null);
  const delay = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const repeat = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  function stop() {
    clearTimeout(delay.current);
    clearInterval(repeat.current);
    held.current = null;
  }
  useEffect(() => {
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", stop);
    return () => {
      stop();
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", stop);
    };
  }, []);

  return (
    <div
      className="frequency-nudges"
      role="group"
      aria-label="Быстрая подстройка частоты"
    >
      {[buttons.slice(0, 3), buttons.slice(3)].map((group, index) => (
        <div className="frequency-nudges-group" key={index}>
          {group.map(({ label, delta }) => (
            <button
              type="button"
              key={label}
              aria-label={`Частота ${delta < 0 ? "минус" : "плюс"} ${Math.abs(delta)} Гц`}
              title={`${delta > 0 ? "+" : "−"}${Math.abs(delta).toLocaleString("ru-RU")} Гц`}
              onPointerDown={(e) => {
                if (
                  held.current !== null ||
                  (e.pointerType === "mouse" && e.button !== 0)
                )
                  return;
                e.preventDefault();
                e.currentTarget.focus({ preventScroll: true });
                e.currentTarget.setPointerCapture(e.pointerId);
                held.current = e.pointerId;
                latest.current(delta);
                delay.current = setTimeout(() => {
                  latest.current(delta);
                  repeat.current = setInterval(() => latest.current(delta), 80);
                }, 400);
              }}
              onPointerUp={(e) => {
                if (held.current === e.pointerId) stop();
              }}
              onPointerCancel={(e) => {
                if (held.current === e.pointerId) stop();
              }}
              onLostPointerCapture={(e) => {
                if (held.current === e.pointerId) stop();
              }}
              onClick={(e) => {
                // Pointer activation already happened on down. Keep native
                // keyboard and assistive-technology clicks (detail=0).
                if (e.detail === 0 && held.current === null)
                  latest.current(delta);
              }}
              onContextMenu={(e) => e.preventDefault()}
            >
              {label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
