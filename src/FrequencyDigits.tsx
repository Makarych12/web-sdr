import { parseFrequency, stepFrequency, STEPS_HZ } from "./tuning";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Mode } from "./radio";
import "./frequency-digits.css";
const bands: [string, number, Mode][] = [
  ["2200m", 136, "CW"],
  ["630m", 474, "CW"],
  ["160m", 1840, "LSB"],
  ["80m", 3750, "LSB"],
  ["60m", 5357, "USB"],
  ["40m", 7100, "LSB"],
  ["30m", 10120, "USB"],
  ["20m", 14200, "USB"],
  ["17m", 18100, "USB"],
  ["15m", 21200, "USB"],
  ["12m", 24920, "USB"],
  ["10m", 28400, "USB"],
  ["6m", 50313, "USB"],
  ["2m", 144300, "USB"],
];
const stepLabel = (hz: number) =>
  hz >= 1000000
    ? `${hz / 1000000} MHz`
    : hz >= 1000
      ? `${hz / 1000} kHz`
      : `${hz} Hz`;
export type FrequencyStepSelection = {
  power: number;
  stepHz: number;
  source: "digit" | "manual";
};
export function FrequencyDigits({
  hz,
  selection,
  onSelectStep,
  onTune,
  range,
  onBand,
}: {
  hz: number;
  selection: FrequencyStepSelection;
  onSelectStep: (power: number, stepHz: number) => void;
  onTune: (hz: number) => void;
  range: { min: number; max: number } | null;
  onBand: (khz: number, mode: Mode) => void;
}) {
  const ref = useRef<HTMLOutputElement>(null),
    host = useRef<HTMLDivElement>(null);
  const { power, stepHz: step, source } = selection;
  const [open, setOpen] = useState(false),
    [showBands, setShowBands] = useState(false);
  const [draftMHz, setDraftMHz] = useState("");
  const [bandMode, setBandMode] = useState<Mode | null>(null);
  const [entryError, setEntryError] = useState("");
  function openBands() {
    setDraftMHz((hz / 1000000).toFixed(6));
    setBandMode(null);
    setEntryError("");
    setShowBands(true);
    setOpen(true);
  }
  function confirmFrequency() {
    const value = parseFrequency(`${draftMHz.trim()} MHz`);
    if (
      value === null ||
      (range && (value < range.min * 1000 || value > range.max * 1000))
    ) {
      setEntryError("Введите частоту в пределах диапазона приёмника.");
      return;
    }
    if (bandMode) onBand(value / 1000, bandMode);
    else onTune(value);
    setOpen(false);
  }
  const menuRef = useRef<HTMLElement>(null);
  const latest = useRef({ hz, step, onTune });
  latest.current = { hz, step, onTune };
  function select(p: number) {
    onSelectStep(p, 10 ** p);
  }
  function nudge(ticks: number) {
    const v = latest.current;
    v.hz = stepFrequency(v.hz, v.step, ticks);
    v.onTune(v.hz);
  }
  useEffect(() => {
    const el = ref.current!;
    const wheel = (e: WheelEvent) => {
      if (!e.deltaY || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      const v = latest.current;
      v.hz = stepFrequency(v.hz, v.step, e.deltaY < 0 ? 1 : -1);
      v.onTune(v.hz);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!host.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        ref.current
          ?.querySelector<HTMLButtonElement>(`[data-power="${power}"]`)
          ?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    host.current?.addEventListener("keydown", escape);
    const node = host.current;
    return () => {
      document.removeEventListener("pointerdown", outside);
      node?.removeEventListener("keydown", escape);
    };
  }, [open, power]);
  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current!;
    menu.showPopover();
    const position = () => {
      const anchor = host.current!.getBoundingClientRect();
      const box = menu.getBoundingClientRect();
      const left = Math.max(
        12,
        Math.min(anchor.left, innerWidth - box.width - 12),
      );
      const below = anchor.bottom + 5;
      const top =
        below + box.height <= innerHeight - 12
          ? below
          : anchor.top - box.height - 5 >= 12
            ? anchor.top - box.height - 5
            : Math.max(12, innerHeight - box.height - 12);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(menu);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      if (menu.matches(":popover-open")) menu.hidePopover();
    };
  }, [open]);
  const digits = String(Math.round(hz)).padStart(8, "0").split("");
  return (
    <div
      ref={host}
      className="frequency-digit-control"
      onKeyDown={(e) => {
        if (
          [
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "PageUp",
            "PageDown",
          ].includes(e.key)
        )
          e.stopPropagation();
      }}
    >
      <output
        ref={ref}
        className="digital-frequency"
        aria-label="Текущая частота Hz"
        aria-valuenow={hz}
      >
        {digits.map((digit, i) => {
          const p = digits.length - i - 1;
          return (
            <span key={p} className="frequency-digit-cell">
              <button
                type="button"
                className={
                  "frequency-digit " +
                  (source === "digit" && power === p ? "active" : "")
                }
                data-power={p}
                aria-label={`Шаг ${stepLabel(10 ** p)}${p >= 6 ? ": диапазоны и частота" : ""}`}
                aria-haspopup={p >= 6 ? "dialog" : undefined}
                aria-pressed={source === "digit" && power === p}
                title={`Выбрать ${stepLabel(10 ** p)} · колесо изменяет выбранный шаг`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (p >= 6) openBands();
                  else {
                    select(p);
                    setOpen(false);
                  }
                }}
                onKeyDown={(e) => {
                  if (
                    ["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(
                      e.key,
                    )
                  ) {
                    e.preventDefault();
                    nudge(
                      (["ArrowUp", "PageUp"].includes(e.key) ? 1 : -1) *
                        (e.key.startsWith("Page") ? 10 : 1),
                    );
                  } else if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
                    e.preventDefault();
                    const next = Math.max(
                      0,
                      Math.min(
                        digits.length - 1,
                        p + (e.key === "ArrowLeft" ? 1 : -1),
                      ),
                    );
                    select(next);
                    ref.current
                      ?.querySelector<HTMLButtonElement>(
                        `[data-power="${next}"]`,
                      )
                      ?.focus();
                  }
                }}
              >
                {digit}
              </button>
              {p % 3 === 0 && i < digits.length - 1 && (
                <span className="frequency-dot" aria-hidden="true">
                  .
                </span>
              )}
            </span>
          );
        })}
        <button
          type="button"
          className="frequency-unit"
          aria-label="MHz: диапазоны и частота"
          aria-expanded={open && showBands}
          onClick={() => {
            if (open && showBands) setOpen(false);
            else openBands();
          }}
        >
          MHz
        </button>
      </output>
      <div className="digit-step-caption">
        {source === "digit"
          ? `Шаг: ${stepLabel(step)} · оба валкодера`
          : `Ручные шаги валкодеров · цифры ${stepLabel(step)}`}
        <button
          type="button"
          aria-label="Открыть меню шага"
          onClick={() => {
            setShowBands(false);
            setOpen((v) => !v);
          }}
        >
          ⋯
        </button>
      </div>
      {open && (
        <section
          ref={menuRef}
          popover="manual"
          className="frequency-digit-menu"
          role="dialog"
          aria-label={showBands ? "Диапазоны и частота" : "Меню настройки шага"}
        >
          <div className="digit-menu-head">
            <strong>
              {showBands ? "Диапазоны и частота" : "Шаг настройки"}
            </strong>
            <button
              type="button"
              aria-label="Закрыть меню частоты"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          {showBands ? (
            <form
              className="digit-frequency-entry"
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                confirmFrequency();
              }}
            >
              <label>
                Частота · MHz
                <input
                  aria-label="Прямая частота MHz"
                  inputMode="decimal"
                  type="text"
                  value={draftMHz}
                  onChange={(e) => {
                    setDraftMHz(e.target.value.replace(",", "."));
                    setBandMode(null);
                    setEntryError("");
                  }}
                />
              </label>
              {entryError && <small role="alert">{entryError}</small>}
              <button type="submit" className="digit-confirm">
                Настроить
              </button>
            </form>
          ) : (
            <>
              <div
                className="digit-power-options"
                role="group"
                aria-label="Выбор шага"
              >
                {Array.from({ length: 8 }, (_, p) => 7 - p).map((p) => (
                  <button
                    type="button"
                    key={p}
                    aria-pressed={source === "digit" && power === p}
                    onClick={() => {
                      select(p);
                      setShowBands(false);
                    }}
                  >
                    {stepLabel(10 ** p)}
                  </button>
                ))}
              </div>
              <label>
                Шаг цифр и обоих валкодеров
                <select
                  aria-label="Шаг цифровой шкалы"
                  value={step}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    onSelectStep(Math.floor(Math.log10(n)), n);
                  }}
                >
                  {[...STEPS_HZ, 100000, 1000000, 10000000].map((n) => (
                    <option key={n} value={n}>
                      {stepLabel(n)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="digit-menu-nudges">
                <button
                  type="button"
                  aria-label="Цифровая шкала: минус шаг"
                  onClick={() => nudge(-1)}
                >
                  − {stepLabel(step)}
                </button>
                <button
                  type="button"
                  aria-label="Цифровая шкала: плюс шаг"
                  onClick={() => nudge(1)}
                >
                  + {stepLabel(step)}
                </button>
              </div>
            </>
          )}
          <button
            type="button"
            className="digit-bands-toggle"
            aria-expanded={showBands}
            onClick={() => {
              if (showBands) setShowBands(false);
              else openBands();
            }}
          >
            Радиолюбительские диапазоны {showBands ? "↑" : "↓"}
          </button>
          {showBands && (
            <div
              className="digit-band-options"
              role="group"
              aria-label="Диапазоны принимающего SDR"
            >
              {bands
                .filter(([, f]) => range && f >= range.min && f <= range.max)
                .map(([band, f, mode]) => (
                  <button
                    type="button"
                    key={band}
                    aria-pressed={
                      bandMode === mode && Number(draftMHz) === f / 1000
                    }
                    onClick={() => {
                      setDraftMHz((f / 1000).toFixed(6));
                      setBandMode(mode);
                      setEntryError("");
                    }}
                  >
                    <b>{band}</b>
                    <small>
                      {f / 1000} MHz · {mode}
                    </small>
                  </button>
                ))}
              {!range && <p>Диапазон приёмника ещё не получен.</p>}
            </div>
          )}
          <small>
            Цифры kHz и Hz задают шаг обоим валкодерам. Ручной выбор в «СВОЙ
            ШАГ» выключает подсветку шага; следующее нажатие на цифру снова
            включает выбранный шаг. Кнопки «ШАГ» работают отдельно.
          </small>
        </section>
      )}
    </div>
  );
}
