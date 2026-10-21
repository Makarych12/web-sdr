import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { FrequencyScanner, type ScanConfig, type ScanState } from "./frequencyScanner";
import "./scan.css";

type Props = {
  controller: MutableRefObject<FrequencyScanner | null>;
  connected: boolean;
  min: number;
  max: number;
  frequency: number;
  onTune: (frequency: number) => void;
  onSelect: (frequency: number) => void;
  onSave: (frequency: number) => void;
  isSaved: (frequency: number) => boolean;
  voiceAvailable: boolean;
};
export function ScanPanel(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<ScanState>({ phase: "STOP", frequency: null,
    found: [], skipped: [], message: "", max: null });
  const [config, setConfig] = useState<ScanConfig>({ start: 7000, end: 7200, step: 5, squelch: -80, dwell: 1, activity: "ALL" });
  const [engine] = useState(() => new FrequencyScanner({
    bounds: () => ({ min: latest.current.min, max: latest.current.max }),
    tune: (frequency) => latest.current.onTune(frequency),
    changed: setState,
  }));
  useEffect(() => {
    props.controller.current = engine;
    return () => {
      engine.stop();
      if (props.controller.current === engine) props.controller.current = null;
    };
  }, [engine, props.controller]);
  useEffect(() => { if (!props.connected) engine.stop(); }, [engine, props.connected]);
  useEffect(() => {
    if (state.phase === "STOP") return;
    const timer = setInterval(() => engine.tick(), 200);
    return () => clearInterval(timer);
  }, [engine, state.phase]);
  const active = state.phase !== "STOP";
  const field = (key: keyof Omit<ScanConfig, "activity">, value: string) => {
    engine.stop();
    setConfig((old) => ({ ...old, [key]: value === "" ? NaN : Number(value.replace(",", ".")) }));
  };
  return <>
    <button type="button" className="scan-launch" aria-label="Панель SCAN"
      aria-pressed={active} onClick={() => dialog.current?.showModal()}>SCAN</button>
    <dialog ref={dialog} className="scan-panel" aria-labelledby="scan-title"
      onKeyDown={(e) => e.stopPropagation()}>
      <div className="scan-heading"><strong id="scan-title">SCAN</strong>
        <button type="button" aria-label="Закрыть панель SCAN" onClick={() => dialog.current?.close()}>×</button>
      </div>
      <form onSubmit={(e) => {
        e.preventDefault();
        if (active) engine.stop();
        else if (config.activity === "VOICE" && !props.voiceAvailable) engine.stop("Для VOICE выберите речевой режим и полосу не уже 1,2 кГц");
        else if (props.connected) engine.start(config);
      }}>
        <div className="scan-fields">
          <label>ACTIVITY<select aria-label="SCAN ACTIVITY" value={config.activity} onChange={(e) => {
            engine.stop(); setConfig((old) => ({ ...old, activity: e.target.value as "ALL" | "VOICE" }));
          }}><option value="ALL">ALL</option><option value="VOICE">VOICE</option></select></label>
          <label>START · kHz<input aria-label="SCAN START" type="number" step="0.001" min={props.min}
            max={Math.min(props.max, state.max ?? props.max)} required value={Number.isNaN(config.start) ? "" : config.start}
            onChange={(e) => field("start", e.target.value)} /></label>
          <label>END · kHz<input aria-label="SCAN END" type="number" step="0.001" min={props.min}
            max={Math.min(props.max, state.max ?? props.max)} required value={Number.isNaN(config.end) ? "" : config.end}
            onChange={(e) => field("end", e.target.value)} /></label>
          <label>STEP · kHz<select aria-label="SCAN STEP" value={config.step} onChange={(e) => field("step", e.target.value)}>
            {[1, 5, 10, 25].map((v) => <option key={v} value={v}>{v}</option>)}
          </select></label>
          <label>DWELL · s<input aria-label="SCAN DWELL" type="number" min="0.5" max="5" step="0.1" required
            value={Number.isNaN(config.dwell) ? "" : config.dwell} onChange={(e) => field("dwell", e.target.value)} /></label>
          <label className="scan-threshold">SQUELCH · {config.squelch} dBm<input aria-label="SCAN SQUELCH" type="range"
            min="-140" max="0" value={config.squelch} onChange={(e) => field("squelch", e.target.value)} /></label>
        </div>
        {config.activity === "VOICE" && <small>Оценка речевой активности, не распознавание речи. Для SSB: USB/LSB, STEP 1 kHz, DWELL 1–2 s.</small>}
        <small>Диапазон приёмника: {props.min}–{Math.min(props.max, state.max ?? props.max)} kHz</small>
        <div className="scan-actions">
          <button type="submit" disabled={!props.connected || state.max === null}
            aria-label={active ? "Остановить SCAN" : "Запустить SCAN"}>{active ? "STOP" : "SCAN"}</button>
          <button type="button" disabled={!props.connected} onClick={() => engine.skip(active ? state.frequency! : props.frequency)}>SKIP</button>
          <output aria-live="polite">{state.phase}{active ? ` · ${state.frequency} kHz` : ""}</output>
        </div>
      </form>
      {state.message && <p role="status">{state.message}</p>}
      {!!state.skipped.length && <div className="scan-skipped">SKIP: {state.skipped.map((frequency) =>
        <button type="button" key={frequency} aria-label={`Вернуть ${frequency} kHz`} onClick={() => engine.unskip(frequency)}>{frequency} ×</button>)}</div>}
      <strong>FOUND · {state.found.length}</strong>
      <div className="scan-found">{state.found.map(({ frequency, rssi }) =>
        <div key={frequency} className="memory-found-entry">
        <button type="button" key={frequency} disabled={!props.connected || frequency < props.min || frequency > Math.min(props.max, state.max ?? 0)}
          onClick={() => { engine.stop(); props.onSelect(frequency); }}>
          {frequency} kHz <span>{rssi.toFixed(1)} dBm</span>
        </button>
        <button type="button" aria-label={`Сохранить ${frequency} kHz в MEM`}
          disabled={props.isSaved(frequency)} onClick={() => props.onSave(frequency)}>{props.isSaved(frequency) ? "✓" : "SAVE"}</button>
        </div>)}</div>
    </dialog>
  </>;
}
