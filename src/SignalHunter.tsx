import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { SignalHunter, type EnergyPeak } from "./signalHunter";
import type { SpectrumView } from "./spectrumView";
import "./signal-hunter.css";
export function SignalHunterControls({
  input,
  scope,
  view,
  connected,
  onTune,
}: {
  input: MutableRefObject<SignalHunter | null>;
  scope: RefObject<HTMLDivElement | null>;
  view: SpectrumView;
  connected: boolean;
  onTune: (khz: number) => void;
}) {
  const [enabled, setEnabled] = useState(false),
    [sensitivity, setSensitivity] = useState(55),
    [peaks, setPeaks] = useState<EnergyPeak[]>([]),
    [width, setWidth] = useState(0),
    [now, setNow] = useState(0);
  const viewKey = `${view.start}:${view.span}:${view.zoom ?? ""}`;
  const currentKey = useRef(viewKey);
  currentKey.current = viewKey;
  const [snapshotKey, setSnapshotKey] = useState(viewKey);
  useEffect(() => {
    if (!enabled) {
      input.current = null;
      setPeaks([]);
      return;
    }
    const detector = new SignalHunter(sensitivity);
    input.current = detector;
    setPeaks([]);
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const time = performance.now();
      setNow(time);
      setPeaks(detector.snapshot(time));
      setSnapshotKey(currentKey.current);
    }, 250);
    return () => {
      clearInterval(timer);
      detector.reset();
      if (input.current === detector) input.current = null;
    };
  }, [enabled, sensitivity, input]);
  useEffect(() => {
    input.current?.reset();
    setPeaks([]);
    setSnapshotKey(viewKey);
  }, [viewKey, connected, input]);
  useEffect(() => {
    const host = scope.current;
    if (!host) return;
    const resize = new ResizeObserver(() => setWidth(host.clientWidth));
    setWidth(host.clientWidth);
    resize.observe(host);
    return () => resize.disconnect();
  }, [scope]);
  const visible: { peak: EnergyPeak; x: number }[] = [];
  if (enabled && connected && snapshotKey === viewKey && width > 0) {
    for (const peak of peaks) {
      const x = ((peak.frequency - view.start) / view.span) * width;
      if (
        x < 22 ||
        x > width - 22 ||
        visible.some((p) => Math.abs(p.x - x) < 46)
      )
        continue;
      visible.push({ peak, x });
      if (visible.length === 10) break;
    }
  }
  return (
    <>
      <div
        className="signal-hunter-controls"
        role="group"
        aria-label="SMART SIGNAL HUNTER"
      >
        <button
          type="button"
          className={enabled ? "active" : ""}
          aria-pressed={enabled}
          disabled={!enabled && !connected}
          onClick={() => setEnabled((v) => !v)}
        >
          HUNTER {enabled ? "ON" : "OFF"}
        </button>
        <label>
          Чувствительность{" "}
          <input
            type="range"
            aria-label="Чувствительность HUNTER"
            min="0"
            max="100"
            step="5"
            value={sensitivity}
            onChange={(e) => setSensitivity(Number(e.target.value))}
          />
          <output>{sensitivity}%</output>
        </label>
        <span className="hunter-count">
          {enabled
            ? connected
              ? `Метки ${visible.length} / пики ${peaks.length}`
              : "Ожидание FFT"
            : "Поиск устойчивой энергии"}
        </span>
        <small>
          Энергия ≠ распознанная станция · порог +
          {(22 - sensitivity * 0.17).toFixed(1)} dB к локальному фону
        </small>
      </div>
      {enabled &&
        scope.current &&
        createPortal(
          <div className="hunter-markers" aria-label="Найденные пики энергии">
            {visible.map(({ peak, x }) => {
              const y = Math.max(
                14,
                Math.min(85, 100 - ((peak.levelDb + 115) / 90) * 100),
              );
              return (
                <button
                  type="button"
                  key={peak.id}
                  className="hunter-marker"
                  data-hunter-id={peak.id}
                  data-hunter-frequency={peak.frequency}
                  aria-label={`Энергия ${peak.frequency.toFixed(3)} kHz, над фоном ${peak.excessDb.toFixed(0)} dB`}
                  title={`${peak.frequency.toFixed(3)} kHz · энергия +${peak.excessDb.toFixed(1)} dB над локальным фоном. Это не распознавание станции. Точность ограничена FFT.`}
                  style={{
                    left: `${(x / width) * 100}%`,
                    top: `${y}%`,
                    opacity: Math.max(
                      0.4,
                      1 - Math.max(0, now - peak.lastSeen - 500) / 1500,
                    ),
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (
                      connected &&
                      snapshotKey === viewKey &&
                      performance.now() - peak.lastSeen < 1400
                    )
                      onTune(peak.frequency);
                  }}
                >
                  <i aria-hidden="true" />
                  <span>{peak.frequency.toFixed(view.span < 100 ? 3 : 1)}</span>
                </button>
              );
            })}
          </div>,
          scope.current,
        )}
    </>
  );
}
