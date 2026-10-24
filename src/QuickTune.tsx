import { useEffect, useState } from "react";
import { MODES, type Mode } from "./radio";
import { dxBand } from "./dxCluster";
import { useStoredState } from "./storage";
import {
  defaultQuickFrequencies,
  parseQuickFrequency,
  validQuickFrequencies,
  rememberQuickFrequency,
  quickKey,
  quickLabel,
  type QuickFrequency,
} from "./quickTune";
import "./quickTune.css";
export function QuickTune({
  frequency,
  mode,
  width,
  connected,
  onTune,
}: {
  frequency: number;
  mode: Mode;
  width: number;
  connected: boolean;
  onTune: (frequency: number, mode: Mode, width?: number) => void;
}) {
  const [saved, setSaved] = useStoredState(
    "wave.quick.saved",
    defaultQuickFrequencies,
    validQuickFrequencies,
  );
  const [recent, setRecent] = useStoredState<QuickFrequency[]>(
    "wave.quick.recent",
    [],
    validQuickFrequencies,
  );
  const [draft, setDraft] = useState(""),
    [unit, setUnit] = useState<"kHz" | "MHz">("kHz"),
    [draftMode, setDraftMode] = useState<Mode>(mode),
    [name, setName] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (!connected || frequency <= 0) return;
    const timer = setTimeout(
      () =>
        setRecent((list) =>
          rememberQuickFrequency(list, {
            frequency,
            mode,
            width,
            name: quickLabel(frequency),
          }),
        ),
      2000,
    );
    return () => clearTimeout(timer);
  }, [frequency, mode, width, connected, setRecent]);
  function save(entry: QuickFrequency, preserveName = false) {
    if (
      saved.length >= 24 &&
      !saved.some((v) => quickKey(v) === quickKey(entry))
    ) {
      setError(
        "Можно закрепить до 24 частот. Удалите ненужную и добавьте новую.",
      );
      return false;
    }
    const existing = saved.find((v) => quickKey(v) === quickKey(entry));
    if (preserveName && existing) entry = { ...entry, name: existing.name };
    setSaved((list) => rememberQuickFrequency(list, entry, 24));
    setError("");
    setNotice(`Сохранено: ${entry.name} · ${entry.mode}`);
    return true;
  }
  function card(entry: QuickFrequency, pinned: boolean, index: number) {
    const active =
      Math.abs(entry.frequency - frequency) < 0.0005 && entry.mode === mode;
    return (
      <div className={"quick-card" + (active ? " active" : "")} key={quickKey(entry)}>
        <button
          className="quick-station"
          aria-label={`Настроить ${entry.name}, ${entry.frequency} кГц, ${entry.mode}`}
          aria-pressed={active}
          onClick={() => onTune(entry.frequency, entry.mode, entry.width)}
        >
          {pinned && <span className="quick-channel">CH {String(index + 1).padStart(2, "0")}
            <span className="quick-state">{active ? (connected ? "В эфире" : "Выбрана") : ""}</span>
          </span>}
          <strong className={"quick-value" + (quickLabel(entry.frequency).replace(" MHz", "").length > 7 ? " quick-value-precise" : "")}>{quickLabel(entry.frequency).replace(" MHz", "")}<small>MHz</small></strong>
          <span className="quick-title" title={entry.name}>{entry.name}</span>
          <span className="quick-meta"><span>{dxBand(entry.frequency) ?? (entry.frequency < 3000 ? "ДВ / СВ" : "КВ")}</span><span className="quick-mode">{entry.mode}</span></span>
        </button>
        {pinned ? <details className="quick-menu" onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false;
        }} onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.currentTarget.open = false;
            event.currentTarget.querySelector("summary")?.focus();
          }
        }}>
          <summary aria-label={`Меню станции ${entry.name}`} title="Действия со станцией">⋯</summary>
          <button type="button" onClick={() => setSaved((list) => list.filter((v) => quickKey(v) !== quickKey(entry)))}
            aria-label={`Убрать из быстрой настройки ${entry.name}`}>Удалить из памяти</button>
        </details> : <button type="button" className="quick-action" aria-label={`Закрепить ${entry.name}`}
          onClick={() => save(entry, true)}>☆</button>}
      </div>
    );
  }
  return (
    <section className="quick-tune panel" aria-label="Быстрая настройка">
      <div className="quick-heading">
        <div>
          <span className="eyebrow">ВАШИ ЧАСТОТЫ</span>
          <h3>MEMORY BANK <span className="quick-count">{String(saved.length).padStart(2, "0")} / 24</span></h3>
        </div>
        <button
          className="quick-save"
          onClick={() =>
            save({ frequency, mode, width, name: quickLabel(frequency) }, true)
          }
          disabled={frequency <= 0}
        >
          ☆ Сохранить текущую
        </button>
      </div>
      <div className="quick-list" aria-label="Закреплённые частоты">
        {saved.map((v, index) => card(v, true, index))}
      </div>
      {!saved.length && (
        <p className="quick-hint">
          Закрепите текущую частоту или добавьте свою ниже.
        </p>
      )}
      <details className="quick-manual">
        <summary>＋ Добавить частоту вручную</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = parseQuickFrequency(draft, unit);
            if (f === null) {
              setNotice("");
              setError(
                "Введите частоту больше 0 и до 30000 кГц / 30 МГц. Например: 14200 кГц или 14,2 МГц.",
              );
              return;
            }
            if (
              save({
                frequency: f,
                mode: draftMode,
                name: name.trim() || quickLabel(f),
              })
            ) {
              setDraft("");
              setName("");
            }
          }}
        >
          <label className="quick-frequency">
            Частота
            <div>
              <input
                aria-label="Частота для быстрой настройки"
                inputMode="decimal"
                placeholder={unit === "kHz" ? "14200" : "14,2"}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                required
              />
              <select
                aria-label="Единицы частоты"
                value={unit}
                onChange={(e) => setUnit(e.target.value as "kHz" | "MHz")}
              >
                <option value="kHz">кГц</option>
                <option value="MHz">МГц</option>
              </select>
            </div>
          </label>
          <label>
            Режим
            <select
              aria-label="Режим быстрой настройки"
              value={draftMode}
              onChange={(e) => setDraftMode(e.target.value as Mode)}
            >
              {MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="quick-name">
            Название
            <input
              aria-label="Название частоты"
              placeholder="Например: вечерний эфир"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button type="submit" className="quick-submit">
            Добавить
          </button>
        </form>
      </details>
      {error && (
        <p className="quick-error" role="alert">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="quick-notice" role="status">
          {notice}
        </p>
      )}
      <div className="quick-recent">
      <div className="quick-recent-heading">
        <h4>Недавние</h4>
        {recent.length > 0 && (
          <button onClick={() => setRecent([])}>Очистить историю</button>
        )}
      </div>
      {!recent.length && <p className="quick-hint">Здесь появятся последние частоты после настройки.</p>}
      <div className="quick-recent-list" aria-label="Недавние частоты">
        {recent.map((v, index) => card(v, false, index))}
      </div>
      </div>
    </section>
  );
}
