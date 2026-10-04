import { useEffect, useRef, useState } from "react";
import { signalLabel } from "./radio";
export function SMeter({ rssi }: { rssi: number | null }) {
  const target = useRef(rssi),
    level = useRef(-127),
    peak = useRef(-127),
    hold = useRef(0);
  target.current = rssi;
  const [display, setDisplay] = useState({ level: -127, peak: -127 });
  useEffect(() => {
    const id = setInterval(() => {
      const v = target.current;
      if (v === null) {
        level.current = peak.current = -127;
        setDisplay({ level: -127, peak: -127 });
        return;
      }
      level.current += (v - level.current) * (v > level.current ? 0.7 : 0.12);
      const now = performance.now();
      if (level.current >= peak.current) {
        peak.current = level.current;
        hold.current = now + 900;
      } else if (now > hold.current)
        peak.current = Math.max(level.current, peak.current - 1);
      setDisplay({ level: level.current, peak: peak.current });
    }, 80);
    return () => clearInterval(id);
  }, []);
  const percent = (value: number) =>
    Math.max(0, Math.min(100, ((value + 127) / 114) * 100));
  return (
    <div className="smeter">
      <div className="smeter-top">
        <label>S-METER</label>
        <strong>
          {rssi === null ? "—" : signalLabel(display.level)}{" "}
          <small>
            {rssi === null ? "Нет сигнала" : `${display.level.toFixed(1)} dBm`}
          </small>
        </strong>
      </div>
      <div
        className="smeter-track"
        role="meter"
        aria-label="Уровень радиосигнала"
        aria-valuemin={-127}
        aria-valuemax={-13}
        aria-valuenow={Math.round(display.level)}
        aria-valuetext={
          rssi === null
            ? "Нет подключения"
            : `${signalLabel(display.level)}, ${display.level.toFixed(1)} dBm`
        }
      >
        <div
          className="smeter-fill"
          style={{ width: `${percent(display.level)}%` }}
        />
        <i
          className="smeter-peak"
          style={{ left: `${percent(display.peak)}%` }}
        />
        <i className="smeter-s9" style={{ left: `${percent(-73)}%` }} />
      </div>
      <div className="smeter-scale">
        {[-121, -109, -97, -85, -73, -53, -33, -13].map((v) => (
          <span key={v} style={{ left: `${percent(v)}%` }}>
            {v <= -73 ? `S${(v + 127) / 6}` : `+${v + 73}`}
          </span>
        ))}
      </div>
    </div>
  );
}
