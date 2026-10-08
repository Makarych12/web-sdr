import { useRef, useState } from "react";
import type { PointerEvent } from "react";
export function VfoDial({
  frequency,
  step,
  onTune,
  onEnd,
  label = "VFO — ручка настройки",
}: {
  frequency: number;
  step: number;
  onTune: (f: number) => void;
  onEnd: () => void;
  label?: string;
}) {
  const [rotation, setRotation] = useState(0);
  const latest = useRef({ frequency, step, onTune, onEnd });
  latest.current = { frequency, step, onTune, onEnd };
  const drag = useRef<{ id: number; angle: number; carry: number } | null>(
    null,
  );
  function angle(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return (
      (Math.atan2(
        e.clientY - r.top - r.height / 2,
        e.clientX - r.left - r.width / 2,
      ) *
        180) /
      Math.PI
    );
  }
  function rotate(degrees: number) {
    setRotation((r) => r + degrees);
    const d = drag.current;
    if (!d) return;
    d.carry += degrees;
    const ticks = Math.trunc(d.carry / 6);
    if (ticks) {
      d.carry -= ticks * 6;
      const v = latest.current;
      v.onTune(Math.max(0, Math.min(30000, v.frequency + ticks * v.step)));
    }
  }
  return (
    <div className="vfo-control">
      <div
        className="vfo-dial"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={30000000}
        aria-valuenow={Math.round(frequency * 1000)}
        aria-valuetext={`${Math.round(frequency * 1000)} Hz; шаг ${step * 1000} Hz`}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, angle: angle(e), carry: 0 };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const a = angle(e);
          let delta = a - d.angle;
          if (delta > 180) delta -= 360;
          if (delta < -180) delta += 360;
          d.angle = a;
          rotate(delta);
        }}
        onPointerUp={(e) => {
          if (drag.current?.id !== e.pointerId) return;
          drag.current = null;
          latest.current.onEnd();
        }}
        onPointerCancel={() => {
          drag.current = null;
          latest.current.onEnd();
        }}
        onLostPointerCapture={() => {
          if (drag.current) {
            drag.current = null;
            latest.current.onEnd();
          }
        }}
        onKeyDown={(e) => {
          if (
            ![
              "ArrowUp",
              "ArrowRight",
              "ArrowDown",
              "ArrowLeft",
              "PageUp",
              "PageDown",
            ].includes(e.key)
          )
            return;
          e.preventDefault();
          const sign = ["ArrowUp", "ArrowRight", "PageUp"].includes(e.key)
            ? 1
            : -1;
          const mult = e.key.startsWith("Page") ? 10 : 1;
          setRotation((r) => r + sign * 6 * mult);
          latest.current.onTune(
            latest.current.frequency + sign * mult * latest.current.step,
          );
          latest.current.onEnd();
        }}
        onWheel={(e) => {
          if (document.activeElement !== e.currentTarget) return;
          const sign = e.deltaY < 0 ? 1 : -1;
          setRotation((r) => r + sign * 6);
          latest.current.onTune(
            latest.current.frequency + sign * latest.current.step,
          );
        }}
      >
        <div
          className="vfo-face"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          <i />
        </div>
        <span>VFO</span>
      </div>
      <small>Поверните ручку · {step * 1000} Hz / шаг</small>
    </div>
  );
}
