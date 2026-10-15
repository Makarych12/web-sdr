import { useEffect, useRef } from "react";
export function FrequencyDigits({
  hz,
  stepHz,
  onTune,
}: {
  hz: number;
  stepHz: number;
  onTune: (hz: number) => void;
}) {
  const ref = useRef<HTMLOutputElement>(null);
  const latest = useRef({ hz, stepHz, onTune });
  latest.current = { hz, stepHz, onTune };
  useEffect(() => {
    const el = ref.current!;
    const wheel = (e: WheelEvent) => {
      const power = (e.target as HTMLElement).dataset.power;
      if (power === undefined || !e.deltaY) return;
      e.preventDefault();
      const v = latest.current;
      v.hz = Math.max(
        0,
        Math.min(
          30000000,
          v.hz +
            (e.deltaY < 0 ? 1 : -1) *
              (e.shiftKey ? v.stepHz : 10 ** Number(power)),
        ),
      );
      v.onTune(v.hz);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  return (
    <output
      ref={ref}
      className="digital-frequency"
      aria-label="Текущая частота Hz"
      aria-valuenow={hz}
    >
      {String(hz)
        .padStart(7, "0")
        .split("")
        .map((digit, i, digits) => (
          <span key={i} data-power={digits.length - i - 1}>
            {digit}
            {(digits.length - i - 1) % 3 === 0 && i < digits.length - 1
              ? "."
              : ""}
          </span>
        ))}
      <small>MHz</small>
    </output>
  );
}
