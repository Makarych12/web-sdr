import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Ft8Receiver, type Ft8Message } from "./ft8";
import "./ft8.css";
const presets: [string, number][] = [
  ["160m", 1840],
  ["80m", 3573],
  ["60m", 5357],
  ["40m", 7074],
  ["30m", 10136],
  ["20m", 14074],
  ["17m", 18100],
  ["15m", 21074],
  ["12m", 24915],
  ["10m", 28074],
  ["6m", 50313],
];
export function Ft8DecoderPanel({
  input,
  mode,
  connected,
  range,
  onTune,
}: {
  input: MutableRefObject<Ft8Receiver | null>;
  mode: string;
  connected: boolean;
  range: { min: number; max: number } | null;
  onTune: (khz: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [running, setRunning] = useState(false),
    [state, setState] = useState("Остановлен"),
    [rows, setRows] = useState<Ft8Message[]>([]),
    [count, setCount] = useState(0),
    [cq, setCq] = useState(false),
    [search, setSearch] = useState(""),
    [delay, setDelay] = useState(0),
    [limit, setLimit] = useState(500);
  const limitRef = useRef(limit);
  limitRef.current = limit;
  function stop() {
    input.current?.stop();
    input.current = null;
    setRunning(false);
    setState("Остановлен");
  }
  function start() {
    stop();
    setRunning(true);
    setState("Загрузка WASM…");
    input.current = new Ft8Receiver(
      (batch) => {
        setCount((n) => n + batch.length);
        setRows((old) => [...batch, ...old].slice(0, limitRef.current));
      },
      (message, stopped) => {
        setState(message);
        if (stopped) {
          setRunning(false);
          input.current = null;
        }
      },
      delay,
    );
  }
  useEffect(
    () => () => {
      input.current?.stop();
      input.current = null;
    },
    [input],
  );
  useEffect(() => {
    if (mode !== "USB" || !connected) {
      input.current?.stop();
      input.current = null;
      setRunning(false);
      setState("Для START включите приём USB");
    }
  }, [mode, connected, input]);
  const visible = rows.filter(
    (r) =>
      (!cq || r.message.startsWith("CQ ")) &&
      r.message.toUpperCase().includes(search.trim().toUpperCase()),
  );
  return (
    <>
      <button
        type="button"
        className="cw-dec-launch"
        onClick={() => dialog.current?.showModal()}
      >
        FT8 DECODER
      </button>
      <dialog
        ref={dialog}
        className="ft8-panel"
        aria-labelledby="ft8-title"
        onClose={stop}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <header>
          <strong id="ft8-title">UR4MTN · FT8 DECODER · RX</strong>
          <button
            aria-label="Закрыть FT8"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </header>
        <div className="ft8-tools">
          <button
            disabled={!running && (!connected || mode !== "USB")}
            onClick={() => (running ? stop() : start())}
          >
            {running ? "STOP" : "START"}
          </button>
          <output role="status">
            {state} · сообщений: {count}
          </output>
        </div>
        <div className="ft8-tools">
          {presets.map(([band, khz]) => (
            <button
              key={band}
              disabled={!range || khz < range.min || khz > range.max}
              onClick={() => onTune(khz)}
            >
              {band} · {(khz / 1000).toFixed(3)}
            </button>
          ))}
        </div>
        <div className="ft8-tools">
          <label>
            <input
              type="checkbox"
              checked={cq}
              onChange={(e) => setCq(e.target.checked)}
            />{" "}
            Только CQ
          </label>
          <input
            aria-label="Поиск FT8 по позывному"
            placeholder="Позывной / сообщение"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label>
            Лимит{" "}
            <select
              value={limit}
              onChange={(e) => {
                const n = Number(e.target.value);
                setLimit(n);
                setRows((r) => r.slice(0, n));
              }}
            >
              {[100, 500, 1000].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  visible
                    .map(
                      (r) =>
                        `${new Date(r.utc).toISOString()} ${r.snr.toFixed(1)} ${r.dt.toFixed(2)} ${r.hz.toFixed(0)} ${r.message}`,
                    )
                    .join("\n"),
                );
                setState("Скопировано");
              } catch {
                setState("Буфер обмена недоступен");
              }
            }}
          >
            COPY
          </button>
          <button
            onClick={() => {
              setRows([]);
              setCount(0);
            }}
          >
            CLEAR
          </button>
        </div>
        <label>
          Компенсация задержки приёма, с{" "}
          <input
            aria-label="Задержка FT8"
            type="number"
            min="0"
            max="10"
            step="0.1"
            disabled={running}
            value={delay}
            onChange={(e) =>
              setDelay(Math.max(0, Math.min(10, Number(e.target.value) || 0)))
            }
          />
        </label>
        <div className="ft8-table">
          <table>
            <thead>
              <tr>
                {["UTC", "SNR", "DT", "AUDIO Hz", "MESSAGE"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => (
                <tr key={`${r.utc}-${r.hz}-${i}`}>
                  <td>{new Date(r.utc).toISOString().slice(11, 19)}</td>
                  <td title="Приблизительный SNR в полосе 2500 Hz">
                    ≈{r.snr.toFixed(0)}
                  </td>
                  <td>{r.dt.toFixed(2)}</td>
                  <td>{r.hz.toFixed(0)}</td>
                  <td>{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Только CRC-проверенные результаты ft8_lib. USB, полоса 100–3000 Hz.
          SNR ≈ оценка по мощности тонов и локальному шуму в полосе 2500 Hz, не
          калиброван по WSJT-X. DT относительно начала слота + 0,5 с, с учётом
          задержки FFT и ручной компенсации. Время оценено по получению PCM и
          локальным часам: сетевой лаг и дрейф часов снижают точность. Первый
          неполный слот пропускается. Закрытие останавливает Worker.
        </p>
        <p>
          Слабые сигналы: Costas + LDPC, до 140 кандидатов; чувствительность
          ниже WSJT-X, без вычитания уже найденных сигналов. Некоторые
          специальные сообщения не поддерживаются; неизвестные хешированные
          позывные остаются нераскрытыми.
        </p>
      </dialog>
    </>
  );
}
