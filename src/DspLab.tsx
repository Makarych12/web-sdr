import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import "./dsp-lab.css";

export type DspLabSources = {
  before: AudioNode;
  nr: AudioNode;
  notch: AudioNode;
  eq: AudioNode;
};
type Stage = "all" | "nr" | "notch" | "eq";
const stages = ["before", "nr", "notch", "eq"] as const;
const names = { all: "Вся цепочка", nr: "NR", notch: "NOTCH", eq: "EQ" };
const pairs = { all: [0, 3], nr: [0, 1], notch: [1, 2], eq: [2, 3] } as const;

export function DspLab({
  sources,
  connected,
  nr,
  notch,
  eq,
}: {
  sources: MutableRefObject<DspLabSources | null>;
  connected: boolean;
  nr: boolean;
  notch: boolean;
  eq: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="dsp-lab-launch"
        aria-haspopup="dialog"
        aria-expanded={open}
        type="button"
        onClick={() => setOpen(true)}
      >
        DSP LAB
      </button>
      {open &&
        createPortal(
          <LabPanel
            sources={sources}
            connected={connected}
            enabled={{ nr, notch, eq }}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}
function LabPanel({
  sources,
  connected,
  enabled,
  onClose,
}: {
  sources: MutableRefObject<DspLabSources | null>;
  connected: boolean;
  enabled: { nr: boolean; notch: boolean; eq: boolean };
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<Stage>("all"),
    [trace, setTrace] = useState("both"),
    [hold, setHold] = useState(false);
  const [metrics, setMetrics] = useState<(number | null)[]>([
    null,
    null,
    null,
    null,
  ]);
  const [running, setRunning] = useState(false);
  const reset = useRef(0),
    settings = useRef({ stage, trace, hold, connected });
  settings.current = { stage, trace, hold, connected };
  useEffect(() => {
    dialog.current!.showModal();
  }, []);
  useEffect(() => {
    let attached: DspLabSources | null = null;
    let taps: AnalyserNode[] = [],
      bins: Float32Array<ArrayBuffer>[] = [];
    let peaks: Float32Array<ArrayBuffer>[] = [],
      averaged: number[] = [];
    let lastReport = -Infinity,
      lastReset = -1,
      lastStage: Stage | null = null;
    let active = false;
    const detach = () => {
      if (attached)
        stages.forEach((name, i) => {
          try {
            attached![name].disconnect(taps[i]);
          } catch {
            /* Context already closed. */
          }
        });
      taps.forEach((tap) => tap.disconnect());
      taps = [];
      attached = null;
      averaged = [];
    };
    const draw = () => {
      const state = settings.current;
      const ready =
        state.connected &&
        sources.current?.before.context.state === "running" &&
        !document.hidden;
      if (!ready) {
        detach();
        if (active) {
          setRunning(false);
          setMetrics([null, null, null, null]);
          active = false;
        }
        canvas.current
          ?.getContext("2d")
          ?.clearRect(0, 0, canvas.current.width, canvas.current.height);
        return;
      }
      if (attached !== sources.current) {
        detach();
        attached = sources.current!;
        taps = stages.map((name) => {
          const tap = attached![name].context.createAnalyser();
          tap.fftSize = 4096;
          tap.smoothingTimeConstant = 0;
          attached![name].connect(tap);
          return tap;
        });
        bins = taps.map((tap) => new Float32Array(tap.frequencyBinCount));
        peaks = bins.map((bin) => new Float32Array(bin.length).fill(-120));
        lastStage = null;
      }
      if (!active) {
        setRunning(true);
        active = true;
      }
      if (lastReset !== reset.current || lastStage !== state.stage) {
        peaks.forEach((peak) => peak.fill(-120));
        lastReset = reset.current;
        lastStage = state.stage;
      }
      const rate = taps[0].context.sampleRate;
      const end = Math.min(
        bins[0].length - 1,
        Math.floor((4000 * taps[0].fftSize) / rate),
      );
      const energy = taps.map((tap, i) => {
        tap.getFloatFrequencyData(bins[i]);
        let power = 0;
        for (let bin = 1; bin <= end; bin++) {
          const value = bins[i][bin];
          power += 10 ** (value / 10);
          if (state.hold) peaks[i][bin] = Math.max(peaks[i][bin], value);
        }
        averaged[i] =
          averaged[i] === undefined ? power : averaged[i] * 0.75 + power * 0.25;
        return averaged[i];
      });
      if (performance.now() - lastReport > 500) {
        lastReport = performance.now();
        setMetrics(
          (["all", "nr", "notch", "eq"] as Stage[]).map((key) => {
            const [a, b] = pairs[key];
            return energy[a] > 10 ** (-85 / 10) && energy[b] > 1e-15
              ? 10 * Math.log10(energy[a] / energy[b])
              : null;
          }),
        );
      }
      const el = canvas.current!,
        ctx = el.getContext("2d")!;
      const width = el.clientWidth,
        height = el.clientHeight,
        dpr = Math.min(devicePixelRatio || 1, 2);
      if (
        el.width !== Math.round(width * dpr) ||
        el.height !== Math.round(height * dpr)
      ) {
        el.width = Math.round(width * dpr);
        el.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#061321";
      ctx.fillRect(0, 0, width, height);
      const left = 38,
        right = width - 12,
        top = 20,
        bottom = height - 28;
      ctx.font = "10px monospace";
      ctx.lineWidth = 1;
      for (let db = -100; db <= 0; db += 20) {
        const y = bottom + ((db + 100) / 100) * (top - bottom);
        ctx.strokeStyle = "#20374a";
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.fillStyle = "#88a7bc";
        ctx.fillText(String(db), 3, y + 3);
      }
      for (let khz = 0; khz <= 4; khz++) {
        const x = left + ((right - left) * khz) / 4;
        ctx.strokeStyle = "#20374a";
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.fillStyle = "#88a7bc";
        ctx.fillText(`${khz}`, x - 3, height - 10);
      }
      ctx.fillText("kHz", right - 18, height - 10);
      ctx.fillText("dBFS", 3, 12);
      const pair = pairs[state.stage];
      pair.forEach((index, line) => {
        if (
          (state.trace === "before" && line === 1) ||
          (state.trace === "after" && line === 0)
        )
          return;
        const plot = (values: Float32Array<ArrayBuffer>, peak: boolean) => {
          ctx.strokeStyle = line === 0 ? "#ffc276" : "#66ead8";
          ctx.globalAlpha = peak ? 0.45 : 1;
          ctx.setLineDash(peak ? [3, 3] : []);
          ctx.beginPath();
          for (let bin = 1; bin <= end; bin++) {
            const x =
              left +
              ((right - left) * ((bin * rate) / taps[index].fftSize)) / 4000;
            const y =
              bottom -
              Math.max(0, Math.min(1, (values[bin] + 100) / 100)) *
                (bottom - top);
            if (bin === 1) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.setLineDash([]);
        };
        plot(bins[index], false);
        if (state.hold) plot(peaks[index], true);
      });
    };
    const timer = setInterval(draw, 125);
    draw();
    return () => {
      clearInterval(timer);
      detach();
    };
  }, [sources]);
  return (
    <dialog
      className="dsp-lab-panel"
      aria-label="DSP LAB"
      ref={dialog}
      onCancel={onClose}
      onClose={onClose}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header>
        <div>
          <strong>DSP LAB</strong>
          <small>PCM · NR → NOTCH → EQ</small>
        </div>
        <button type="button" aria-label="Закрыть DSP LAB" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="dsp-lab-status">
        <span>{running ? "● Живой звук" : "○ Ожидание аудио"}</span>
        {(["nr", "notch", "eq"] as const).map((key) => (
          <span key={key}>
            {key.toUpperCase()} {enabled[key] ? "ON" : "OFF"}
          </span>
        ))}
      </div>
      <div className="dsp-lab-controls">
        <label>
          Участок
          <select
            aria-label="Участок DSP"
            value={stage}
            onChange={(e) => setStage(e.target.value as Stage)}
          >
            {Object.entries(names).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Спектры
          <select
            aria-label="Спектры DSP"
            value={trace}
            onChange={(e) => setTrace(e.target.value)}
          >
            <option value="both">ДО + ПОСЛЕ</option>
            <option value="before">ДО</option>
            <option value="after">ПОСЛЕ</option>
          </select>
        </label>
        <button
          type="button"
          aria-pressed={hold}
          onClick={() => {
            reset.current++;
            setHold((v) => !v);
          }}
        >
          Peak Hold {hold ? "ON" : "OFF"}
        </button>
        <button type="button" onClick={() => reset.current++}>
          Сброс пиков
        </button>
      </div>
      <div className="dsp-lab-legend">
        <span>● ДО</span>
        <span>● ПОСЛЕ</span>
        <small>{names[stage]} · 0–4 kHz</small>
      </div>
      <canvas ref={canvas} aria-label="Реальные спектры PCM до и после DSP" />
      <div className="dsp-lab-metrics">
        {["Вся цепочка", "NR", "NOTCH", "EQ"].map((label, i) => (
          <div key={label}>
            <small>{label} · Δ уровня</small>
            <output>
              {metrics[i] === null
                ? "—"
                : `${metrics[i]! >= 0 ? "+" : ""}${metrics[i]!.toFixed(1)} dB`}
            </output>
          </div>
        ))}
      </div>
      <p>
        Δ = уровень ДО − ПОСЛЕ в полосе 0–4 кГц. Положительное значение —
        ослабление, отрицательное — усиление. Это изменение всего сигнала,
        включая речь, а не измерение SNR или отдельно выделенного шума. EQ
        учитывает запас по уровню; громкость приёмника в измерение не входит.
        При речи и задержке NR показания меняются; сравнивайте устойчивые
        участки.
      </p>
    </dialog>
  );
}
