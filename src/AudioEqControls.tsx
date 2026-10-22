import { useRef } from "react";
import { EQ_PRESETS, type EqSettings } from "./audioEq";
import "./audio-eq.css";

type Props = { settings: EqSettings; onChange: (settings: EqSettings) => void };
export function AudioEqControls({ settings, onChange }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <button type="button" className="eq-launch" aria-label="Панель AUDIO EQ" aria-pressed={settings.enabled} title={`EQ ${settings.enabled ? "ON" : "OFF"}`} onClick={() => dialog.current?.showModal()}>EQ</button>
    <dialog className="audio-eq-panel" ref={dialog} aria-labelledby="audio-eq-title" onKeyDown={e => e.stopPropagation()}>
      <header><strong id="audio-eq-title">AUDIO EQ</strong><button type="button" aria-label="Закрыть AUDIO EQ" onClick={() => dialog.current?.close()}>×</button></header>
      <button type="button" aria-pressed={settings.enabled} onClick={() => onChange({ ...settings, enabled: !settings.enabled })}>EQ {settings.enabled ? "ON" : "OFF"}</button>
      {(["bass", "mid", "treble"] as const).map(band => <label key={band}>{band.toUpperCase()} · {settings[band] > 0 ? "+" : ""}{settings[band]} dB
        <input type="range" aria-label={`EQ ${band.toUpperCase()}`} min="-12" max="12" step="1" value={settings[band]} onChange={e => onChange({ ...settings, [band]: Number(e.target.value) })} />
      </label>)}
      <div className="eq-presets">{Object.entries(EQ_PRESETS).map(([name, preset]) => <button type="button" key={name}
        aria-pressed={settings.bass === preset.bass && settings.mid === preset.mid && settings.treble === preset.treble}
        onClick={() => onChange({ enabled: settings.enabled, ...preset })}>{name}</button>)}</div>
      <p>300 Hz / 1,65 kHz / 2,6 kHz. REC и AF-FFT — без EQ. Для защиты пиков EQ может снижать громкость.</p>
    </dialog>
  </>;
}
