import { VfoDial } from "./VfoDial";

export function FineTune({
  frequency,
  step,
  onTune,
  onEnd,
}: {
  frequency: number;
  step: number;
  onTune: (frequency: number) => void;
  onEnd: () => void;
}) {
  function nudge(steps: number) {
    onTune(frequency + steps * step);
    onEnd();
  }
  return (
    <section className="fine-tune" aria-label="Точная подстройка под waterfall">
      <div className="fine-readout">
        <label>ТОЧНАЯ ПОДСТРОЙКА · VFO A</label>
        <output aria-label="Частота точной подстройки">
          {Math.round(frequency * 1000).toLocaleString("de-DE")}{" "}
          <small>Hz</small>
        </output>
        <small>Шаг {step * 1000} Hz · ← / → · PageDown / PageUp</small>
      </div>
      <div className="fine-buttons">
        <div className="fine-primary">
          <button
            aria-label="Точная подстройка: частота минус шаг"
            onClick={() => nudge(-1)}
          >
            <b>−</b>
            <span>
              Частота − шаг<small>−{step * 1000} Hz</small>
            </span>
          </button>
          <button
            aria-label="Точная подстройка: частота плюс шаг"
            onClick={() => nudge(1)}
          >
            <b>+</b>
            <span>
              Частота + шаг<small>+{step * 1000} Hz</small>
            </span>
          </button>
        </div>
        <div
          className="fine-multipliers"
          role="group"
          aria-label="Количество шагов подстройки"
        >
          {[-10, -1, 1, 10].map((n) => (
            <button
              key={n}
              aria-label={`Подстройка ${n > 0 ? "+" : "−"}${Math.abs(n)} шагов`}
              onClick={() => nudge(n)}
            >
              {n > 0 ? "+" : "−"}
              {Math.abs(n)} <small>шаг{Math.abs(n) === 1 ? "" : "ов"}</small>
            </button>
          ))}
        </div>
      </div>
      <VfoDial
        frequency={frequency}
        step={step}
        onTune={onTune}
        onEnd={onEnd}
        label="VFO — точная подстройка"
      />
    </section>
  );
}
