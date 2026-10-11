const steps = [0.001, 0.01, 0.1, 1, 5, 10];
export function StepControl({
  step,
  onChange,
}: {
  step: number;
  onChange: (step: number) => void;
}) {
  const index = steps.indexOf(step);
  function change(direction: number) {
    onChange(steps[Math.max(0, Math.min(steps.length - 1, index + direction))]);
  }
  return (
    <div
      className="step-control"
      role="group"
      aria-label="Шаг настройки"
      onKeyDown={(e) => {
        const direction = ["ArrowRight", "ArrowUp"].includes(e.key)
          ? 1
          : ["ArrowLeft", "ArrowDown"].includes(e.key)
            ? -1
            : 0;
        if (direction) {
          e.preventDefault();
          change(direction);
        }
      }}
    >
      <button
        type="button"
        aria-label="Уменьшить шаг настройки"
        aria-disabled={index === 0}
        onClick={() => change(-1)}
      >
        −
      </button>
      <output aria-label="Текущий шаг настройки" aria-live="polite">
        <span className="step-caption">ШАГ:</span>{" "}
        <span className="step-value" key={step}>
          {step < 1 ? `${step * 1000} Hz` : `${step} kHz`}
        </span>
      </output>
      <button
        type="button"
        aria-label="Увеличить шаг настройки"
        aria-disabled={index === steps.length - 1}
        onClick={() => change(1)}
      >
        +
      </button>
    </div>
  );
}
