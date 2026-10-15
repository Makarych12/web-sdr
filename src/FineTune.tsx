import type { ReactNode } from "react";
import { stepFrequency } from "./tuning";
import { VfoDial } from "./VfoDial";

export function FineTune({
  children,
  frequencyHz,
  stepHz,
  onTune,
  onEnd,
  viewCenterHz,
  zoom,
  maxZoom,
  onRecenter,
  onZoom,
}: {
  children?: ReactNode;
  frequencyHz: number;
  stepHz: number;
  onTune: (frequencyHz: number) => void;
  onEnd: () => void;
  viewCenterHz: number;
  zoom: number;
  maxZoom: number;
  onRecenter: () => void;
  onZoom: (zoom: number) => void;
}) {
  function nudge(steps: number) {
    onTune(stepFrequency(frequencyHz, stepHz, steps));
    onEnd();
  }
  return (
    <section className="fine-tune" aria-label="Точная настройка VFO">
      <div className="fine-readout">
        <label>ТОЧНАЯ ПОДСТРОЙКА · VFO A</label>
        <output aria-label="Частота точной подстройки">
          {frequencyHz.toLocaleString("de-DE")} <small>Hz</small>
        </output>
        <small>Шаг {stepHz} Hz · ← / → · PageDown / PageUp</small>
      </div>
      <div className="fine-nudges">{children}</div>
      <div className="fine-buttons">
        <div className="fine-primary">
          <button
            aria-label="Точная подстройка: частота минус шаг"
            onClick={() => nudge(-1)}
          >
            <b>−</b>
            <span>
              Частота − шаг<small>−{stepHz} Hz</small>
            </span>
          </button>
          <button
            aria-label="Точная подстройка: частота плюс шаг"
            onClick={() => nudge(1)}
          >
            <b>+</b>
            <span>
              Частота + шаг<small>+{stepHz} Hz</small>
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
        <div className="fine-view" role="group" aria-label="Обзор панорамы">
          <button onClick={onRecenter}>К частоте</button>
          <button
            aria-label="Настроиться на центр обзора"
            onClick={() => {
              onTune(viewCenterHz);
              onEnd();
            }}
          >
            Центр
          </button>
          <button
            aria-label="Zoom −"
            disabled={zoom <= 0}
            onClick={() => onZoom(zoom - 1)}
          >
            Zoom −
          </button>
          <button
            aria-label="Zoom +"
            disabled={zoom >= maxZoom}
            onClick={() => onZoom(zoom + 1)}
          >
            Zoom +
          </button>
        </div>
      </div>
      <VfoDial
        frequencyHz={frequencyHz}
        stepHz={stepHz}
        onTune={onTune}
        onEnd={onEnd}
        label="VFO — точная подстройка"
      />
    </section>
  );
}
