import { useEffect, useLayoutEffect, useRef } from "react";
import type { PointerEvent } from "react";
import { stepFrequency, STEPS_HZ } from "./tuning";
export function VfoDial({
  frequencyHz,
  stepHz,
  onTune,
  onEnd,
  label = "VFO — ручка настройки",
  onStepChange,
  stepOptions = STEPS_HZ,
  stepSource = "manual",
}: {
  frequencyHz: number;
  stepHz: number;
  onTune: (frequencyHz: number) => void;
  onEnd: () => void;
  label?: string;
  onStepChange?: (stepHz: number) => void;
  stepOptions?: readonly number[];
  stepSource?: "digit" | "manual";
}) {
  const previousFrequency = useRef(frequencyHz);
  const motion = useRef({
    angle: 0,
    target: 0,
    velocity: 0,
    frame: 0,
    time: 0,
    reduced: false,
  });
  function animate(time: number) {
    const m = motion.current;
    m.frame = 0;
    if (m.reduced) {
      m.angle = m.target;
      m.velocity = 0;
    } else {
      // A damped mechanical response; only the painted angle follows this spring.
      // Substeps keep it stable even after a slow/background frame.
      let remaining = Math.min((time - (m.time || time - 16)) / 1000, 0.05);
      while (remaining > 0) {
        const dt = Math.min(remaining, 0.008);
        m.velocity += (900 * (m.target - m.angle) - 54 * m.velocity) * dt;
        m.angle += m.velocity * dt;
        remaining -= dt;
      }
      if (Math.abs(m.target - m.angle) < 0.005 && Math.abs(m.velocity) < 0.05) {
        m.angle = m.target;
        m.velocity = 0;
      }
    }
    m.time = time;
    dial.current?.style.setProperty("--vfo-angle", `${m.angle}deg`);
    if (m.angle !== m.target || m.velocity !== 0)
      m.frame = requestAnimationFrame(animate);
  }
  function scheduleRotation() {
    const m = motion.current;
    if (!m.frame) {
      m.time = 0;
      m.frame = requestAnimationFrame(animate);
    }
  }
  useLayoutEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      motion.current.reduced = media.matches;
      scheduleRotation();
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
      cancelAnimationFrame(motion.current.frame);
      motion.current.frame = 0;
    };
  }, []);
  useLayoutEffect(() => {
    // Both values use integer Hz. Keep the angle unwrapped across whole revolutions.
    motion.current.target +=
      ((frequencyHz - previousFrequency.current) / stepHz) * 6;
    previousFrequency.current = frequencyHz;
    scheduleRotation();
  }, [frequencyHz, stepHz]);
  const dial = useRef<HTMLDivElement>(null);
  const latest = useRef({ frequencyHz, stepHz, onTune, onEnd });
  latest.current = { frequencyHz, stepHz, onTune, onEnd };
  function nudge(ticks: number) {
    const v = latest.current;
    // Apply integer ticks to the shared VFO; App commits the result synchronously.
    v.frequencyHz = stepFrequency(v.frequencyHz, v.stepHz, ticks);
    v.onTune(v.frequencyHz);
  }
  const drag = useRef<{ id: number; angle: number; carry: number } | null>(null);
  const pendingTicks = useRef(0),
    tuneFrame = useRef(0);
  useLayoutEffect(() => {
    // A queued movement belongs to the old step. Selecting a new step is not
    // a tuning action and must not replay it using the new multiplier.
    cancelAnimationFrame(tuneFrame.current);
    tuneFrame.current = 0;
    pendingTicks.current = 0;
    drag.current = null;
  }, [stepHz, stepSource]);
  function flushTicks() {
    cancelAnimationFrame(tuneFrame.current);
    tuneFrame.current = 0;
    const ticks = pendingTicks.current;
    pendingTicks.current = 0;
    if (ticks) nudge(ticks);
  }
  function finish() {
    flushTicks();
    latest.current.onEnd();
  }
  useEffect(() => () => cancelAnimationFrame(tuneFrame.current), []);
  useEffect(() => {
    const element = dial.current!;
    const wheel = (event: WheelEvent) => {
      if (document.activeElement !== element || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const sign = event.deltaY < 0 ? 1 : -1;
      nudge(sign);
      latest.current.onEnd();
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
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
    const d = drag.current;
    if (!d) return;
    d.carry += degrees;
    const ticks = Math.trunc(d.carry / 6);
    if (ticks) {
      d.carry -= ticks * 6;
      pendingTicks.current += ticks;
      if (!tuneFrame.current)
        tuneFrame.current = requestAnimationFrame(flushTicks);
    }
  }
  return (
    <div className="vfo-control">
      <div
        ref={dial}
        className="vfo-dial"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={30000000}
        aria-valuenow={frequencyHz}
        aria-valuetext={`${frequencyHz} Hz; шаг ${stepHz} Hz`}
        onPointerDown={(e) => {
          if ((e.pointerType === "mouse" && e.button !== 0) || drag.current)
            return;
          e.preventDefault();
          e.currentTarget.focus({ preventScroll: true });
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
          finish();
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={(e) => {
          if (drag.current?.id !== e.pointerId) return;
          drag.current = null;
          finish();
        }}
        onLostPointerCapture={(e) => {
          if (drag.current?.id === e.pointerId) {
            drag.current = null;
            finish();
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
          e.stopPropagation();
          const sign = ["ArrowUp", "ArrowRight", "PageUp"].includes(e.key)
            ? 1
            : -1;
          const mult = e.key.startsWith("Page") ? 10 : 1;
          nudge(sign * mult);
          finish();
        }}
      >
        <div className="vfo-face">
          <i />
        </div>
        <span>VFO</span>
      </div>
      <small>Поверните ручку · {stepHz} Hz / шаг</small>
      {onStepChange && (
        <label className="dial-step">
          СВОЙ ШАГ
          <select
            aria-label={`Шаг: ${label}`}
            value={stepSource === "digit" ? "digit" : String(stepHz)}
            onKeyDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value) && value > 0) onStepChange(value);
            }}
          >
            {stepSource === "digit" && (
              <option value="digit" disabled>
                Разряд:{" "}
                {stepHz >= 1000000
                  ? `${stepHz / 1000000} MHz`
                  : stepHz >= 1000
                    ? `${stepHz / 1000} kHz`
                    : `${stepHz} Hz`}
              </option>
            )}
            {stepSource === "manual" && !stepOptions.includes(stepHz) && (
              <option value={stepHz}>
                {stepHz >= 1000 ? `${stepHz / 1000} kHz` : `${stepHz} Hz`} ·
                текущий
              </option>
            )}
            {stepOptions.map((n) => (
              <option key={n} value={n}>
                {n >= 1000 ? `${n / 1000} kHz` : `${n} Hz`}
              </option>
            ))}
          </select>
          <small>
            {stepSource === "digit" ? "По выбранной цифре" : "Ручной шаг"}
          </small>
        </label>
      )}
    </div>
  );
}
