import { useEffect, useState } from "react";
import "./notch.css";

type Props = {
  enabled: boolean;
  auto: boolean;
  frequency: number;
  width: number;
  detected: number | null;
  autoDepth: number;
  onEnabled: (enabled: boolean) => void;
  onAuto: (auto: boolean) => void;
  onFrequency: (frequency: number) => void;
  onWidth: (width: number) => void;
  onAutoDepth: (depth: number) => void;
};
export function NotchControls(props: Props) {
  const [frequency, setFrequency] = useState(String(props.frequency));
  const [width, setWidth] = useState(String(props.width));
  useEffect(() => setFrequency(String(props.frequency)), [props.frequency]);
  useEffect(() => setWidth(String(props.width)), [props.width]);
  return <div className="notch-widget" onKeyDown={(e) => e.stopPropagation()}>
    <button type="button" aria-label="Фильтр NOTCH" title="NOTCH — удаление свиста" aria-pressed={props.enabled}
      onClick={() => props.onEnabled(!props.enabled)}>NOTCH {props.enabled ? "ON" : "OFF"}</button>
    <div className="notch-settings">
      <small>NOTCH — удаление свиста</small>
      <label className="notch-auto"><input type="checkbox" aria-label="NOTCH AUTO" checked={props.auto}
        onChange={(e) => props.onAuto(e.target.checked)} />AUTO</label>
      <label>Частота · Hz<input type="number" aria-label="Частота NOTCH" min="100" max="4000" step="1"
        disabled={props.auto} value={frequency} onChange={(e) => {
          setFrequency(e.target.value);
          const value = Number(e.target.value);
          if (Number.isFinite(value) && value >= 100 && value <= 4000) props.onFrequency(value);
        }} onBlur={() => setFrequency(String(props.frequency))} /></label>
      <label>Ширина · Hz<input type="number" aria-label="Ширина NOTCH" min="10" max="200" step="1"
        value={width} onChange={(e) => {
          setWidth(e.target.value);
          const value = Number(e.target.value);
          if (Number.isFinite(value) && value >= 10 && value <= 200) props.onWidth(value);
        }} onBlur={() => setWidth(String(props.width))} /></label>
      {props.auto && <label>Глубина AUTO · {props.autoDepth} dB<input type="range" aria-label="Глубина AUTO NOTCH"
        min="0" max="60" step="1" value={props.autoDepth} onChange={(e) => props.onAutoDepth(Number(e.target.value))} /></label>}
      {props.auto && <output>{props.enabled && props.detected !== null
        ? `${Math.round(props.detected)} Hz · до ${props.autoDepth} dB` : "Поиск устойчивого тона"}</output>}
    </div>
  </div>;
}
