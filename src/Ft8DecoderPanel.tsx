import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { Ft8Receiver, type Ft8Message } from "./ft8";
import {
  FT8_BANDS,
  TYPE_LABELS,
  appendHistory,
  bandFor,
  bandLabel,
  csvRows,
  maidenhead,
  type History,
  type MonitorRow,
} from "./ft8Monitor";
import "./ft8.css";
class MapBoundary extends Component<
  { children: React.ReactNode; onClose: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="ft8-notice">
        Не удалось открыть карту. Закройте её и повторите загрузку.
        <button onClick={this.props.onClose}>Закрыть карту</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
const DxMap = lazy(() => import("./Ft8DxMap"));
const utc = (time: number) => new Date(time).toISOString().slice(11, 19);
function download(rows: MonitorRow[]) {
  const blob = new Blob([csvRows(rows)], { type: "text/csv;charset=utf-8" }),
    url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = `ur4mtn-ft8-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Ft8DecoderPanel({
  historyRef,
  input,
  onOpenDx,
  mode,
  connected,
  range,
  onTune,
  frequency,
  receiverName,
}: {
  historyRef?: MutableRefObject<History>;
  input: MutableRefObject<Ft8Receiver | null>;
  onOpenDx: () => void;
  mode: string;
  connected: boolean;
  range: { min: number; max: number } | null;
  onTune: (khz: number) => void;
  frequency: number;
  receiverName: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    scroller = useRef<HTMLDivElement>(null),
    card = useRef<HTMLElement>(null);
  const [running, setRunning] = useState(false),
    [state, setState] = useState("Остановлен"),
    [histories, setHistories] = useState<History>({}),
    [historyBand, setHistoryBand] = useState(bandFor(frequency)),
    [cq, setCq] = useState(false),
    [search, setSearch] = useState(""),
    [country, setCountry] = useState(""),
    [delay, setDelay] = useState(0),
    [limit, setLimit] = useState(200),
    [sort, setSort] = useState<"utc" | "snr">("utc"),
    [ascending, setAscending] = useState(false),
    [paused, setPaused] = useState(false),
    [page, setPage] = useState(0),
    [mapOpen, setMapOpen] = useState(false),
    [selected, setSelected] = useState<MonitorRow | null>(null),
    [confirmAll, setConfirmAll] = useState(false),
    [notice, setNotice] = useState(""),
    [bandsExpanded, setBandsExpanded] = useState(false),
    [toolsExpanded, setToolsExpanded] = useState(false);
  useEffect(() => { if (historyRef) historyRef.current = histories; }, [histories, historyRef]);
  const frequencyRef = useRef(frequency),
    limitRef = useRef(limit),
    sequence = useRef(0);
  frequencyRef.current = frequency;
  limitRef.current = limit;
  const liveBand = bandFor(frequency);
  useEffect(() => {
    setHistoryBand(bandFor(frequency));
    setCountry("");
    setPage(0);
    setSelected(null);
    if (input.current) setState("Перенастройка · ожидание полного UTC-слота");
  }, [frequency, input]);
  const stop = useCallback(() => {
    input.current?.stop();
    input.current = null;
    setRunning(false);
    setState("Остановлен");
  }, [input]);
  function start() {
    stop();
    setRunning(true);
    setState("Загрузка WASM…");
    input.current = new Ft8Receiver(
      (batch: Ft8Message[]) => {
        setHistories((old) =>
          appendHistory(
            old,
            batch,
            frequencyRef.current,
            limitRef.current,
            () => ++sequence.current,
          ),
        );
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
      stop();
      setState("Для START включите приём USB");
    }
  }, [mode, connected, stop]);
  const history = histories[historyBand],
    rows = history?.rows ?? [];
  const allRows = useMemo(
    () => Object.values(histories).flatMap((h) => h.rows),
    [histories],
  );
  const countries = useMemo(
    () =>
      [
        ...new Map(rows.map((r) => [r.country.id, r.country.name])).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1], "ru")),
    [rows],
  );
  const filtered = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            (!cq || ["cq", "cqdx", "region"].includes(r.kind)) &&
            (!country || r.country.id === country) &&
            (!search ||
              [r.call, r.to].some((c) =>
                c.toUpperCase().includes(search.trim().toUpperCase()),
              )),
        )
        .sort((a, b) => {
          const delta =
            sort === "snr" ? a.snr - b.snr : a.utc - b.utc || a.id - b.id;
          return ascending ? delta : -delta;
        }),
    [rows, cq, country, search, sort, ascending],
  );
  const visible = filtered.slice(page * 100, (page + 1) * 100);
  useEffect(() => {
    setPage((current) =>
      Math.min(current, Math.max(0, Math.ceil(filtered.length / 100) - 1)),
    );
  }, [filtered.length]);
  useEffect(() => {
    setPage(0);
  }, [historyBand, cq, country, search, sort, ascending]);
  useEffect(() => {
    if (!paused) {
      setPage(0);
      scroller.current?.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [histories, paused]);
  const openStation = useCallback((row: MonitorRow) => {
    setSelected(row);
    requestAnimationFrame(() =>
      card.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  }, []);
  const stationHistory = useMemo(
    () =>
      selected
        ? allRows
            .filter(
              (r) =>
                r.call === selected.call ||
                r.to.replace(/^<|>$/g, "") === selected.call,
            )
            .sort((a, b) => b.id - a.id)
            .slice(0, 40)
        : [],
    [allRows, selected],
  );
  const latest = selected
    ? (stationHistory.find((r) => r.call === selected.call) ?? selected)
    : null;
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Скопировано");
    } catch {
      setNotice("Буфер обмена недоступен");
    }
  }
  const rowText = (r: MonitorRow) =>
    `${utc(r.utc)} UTC | ${bandLabel(r.band)} | ≈${r.snr.toFixed(0)} dB | ${r.dt.toFixed(2)} | ${r.hz.toFixed(0)} Hz | ${r.message}`;
  const renderCall = (r: MonitorRow) =>
    r.call ? (
      <button className="ft8-call" onClick={() => openStation(r)}>
        {r.call}
        {r.fresh && (
          <span
            className="ft8-new"
            title="Впервые в сохранённой истории диапазона"
          >
            NEW
          </span>
        )}
      </button>
    ) : (
      <span className="ft8-muted">—</span>
    );
  return (
    <>
      <button
        type="button"
        className="ft8-launch"
        aria-label="Открыть FT8 PRO"
        onClick={() => dialog.current?.showModal()}
      >
        FT8 PRO
      </button>
      <dialog
        ref={dialog}
        className="ft8-panel"
        aria-labelledby="ft8-title"
        onClose={() => {
          stop();
          setMapOpen(false);
          setSelected(null);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <header className="ft8-header">
          <div>
            <small>UR4MTN / DIGITAL SIGNAL INTELLIGENCE</small>
            <h2 id="ft8-title">
              FT8 <em>PRO</em>
              <span>DX MONITOR</span>
            </h2>
            <p>Приём и анализ эфира · {receiverName}</p>
          </div>
          <div className="ft8-header-actions">
            <button type="button" onClick={onOpenDx} title="Открыть DX Cluster, сохранив FT8 RX">DX CLUSTER</button>
            <span className={"ft8-rx-light " + (running ? "active" : "")}>
              {running ? "RX ACTIVE" : "RX IDLE"}
            </span>
            <button
              aria-label="Закрыть FT8"
              onClick={() => dialog.current?.close()}
            >
              ×
            </button>
          </div>
        </header>
        <div className="ft8-console">
          <button
            className={"ft8-power " + (running ? "on" : "")}
            disabled={!running && (!connected || mode !== "USB")}
            onClick={() => (running ? stop() : start())}
          >
            {running ? "■ STOP" : "▶ START"}
          </button>
          <div>
            <small>ПРИНИМАЕМАЯ ЧАСТОТА</small>
            <strong>
              {(frequency / 1000).toFixed(6)}{" "}
              <span>
                MHz · {mode} · {bandLabel(liveBand)}
              </span>
            </strong>
          </div>
          <output role="status">{state}</output>
        </div>
        <nav
          className={"ft8-presets " + (bandsExpanded ? "" : "compact")}
          aria-label="FT8 частоты"
        >
          {FT8_BANDS.map(([band, khz]) => (
            <button
              key={band}
              className={liveBand === band ? "selected" : ""}
              disabled={!range || khz < range.min || khz > range.max}
              onClick={() => onTune(khz)}
            >
              <strong>{band}</strong>
              <small>{(khz / 1000).toFixed(3)}</small>
            </button>
          ))}
          <button
            className="ft8-presets-toggle"
            aria-expanded={bandsExpanded}
            onClick={() => setBandsExpanded((v) => !v)}
          >
            {bandsExpanded ? "Свернуть частоты ↑" : "Все FT8 частоты ↓"}
          </button>
        </nav>
        <section
          className="ft8-metrics"
          aria-label="Статистика выбранной истории"
        >
          <div>
            <small>ИСТОРИЯ</small>
            <strong>{bandLabel(historyBand)}</strong>
          </div>
          <div>
            <small>ПРИНЯТО</small>
            <strong>{history?.count ?? 0}</strong>
          </div>
          <div>
            <small>СТАНЦИЙ В ЖУРНАЛЕ</small>
            <strong>
              {new Set(rows.filter((r) => r.call).map((r) => r.call)).size}
            </strong>
          </div>
          <div>
            <small>DXCC ПРЕДПОЛОЖИТЕЛЬНО</small>
            <strong>
              {
                new Set(
                  rows
                    .filter((r) => r.country.id !== "unknown")
                    .map((r) => r.country.id),
                ).size
              }
            </strong>
          </div>
          <button
            className={mapOpen ? "selected" : ""}
            onClick={() => setMapOpen((v) => !v)}
          >
            ◎ FT8 DX MAP
          </button>
        </section>
        <div className="ft8-tools ft8-filters">
          <label>
            История{" "}
            <select
              aria-label="История FT8 диапазона"
              value={historyBand}
              onChange={(e) => {
                setHistoryBand(e.target.value);
                setCountry("");
                setSelected(null);
              }}
            >
              {[...FT8_BANDS.map((b) => b[0]), "other"].map((b) => (
                <option key={b} value={b}>
                  {bandLabel(b)} · {histories[b]?.count ?? 0}
                </option>
              ))}
            </select>
          </label>
          <label className="ft8-search">
            Позывной
            <input
              aria-label="Поиск FT8 по позывному"
              placeholder="Передающая станция / адресат"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            DXCC{" "}
            <select
              aria-label="Страна FT8"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              <option value="">Все страны</option>
              {countries.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="ft8-check">
            <input
              type="checkbox"
              checked={cq}
              onChange={(e) => setCq(e.target.checked)}
            />{" "}
            Только CQ
          </label>
        </div>
        <button
          className="ft8-tools-toggle"
          aria-expanded={toolsExpanded}
          onClick={() => setToolsExpanded((v) => !v)}
        >
          Инструменты журнала {toolsExpanded ? "↑" : "↓"} · сортировка / CSV /
          CLEAR
        </button>
        <div
          className={
            "ft8-tools ft8-actions " + (toolsExpanded ? "" : "compact")
          }
        >
          <label>
            Сортировка{" "}
            <select
              aria-label="Сортировка FT8"
              value={sort}
              onChange={(e) => setSort(e.target.value as "utc" | "snr")}
            >
              <option value="utc">UTC</option>
              <option value="snr">SNR ≈</option>
            </select>
          </label>
          <button
            aria-label="Изменить порядок FT8"
            onClick={() => setAscending((v) => !v)}
          >
            {ascending ? "↑ По возрастанию" : "↓ По убыванию"}
          </button>
          <button aria-pressed={paused} onClick={() => setPaused((v) => !v)}>
            {paused ? "▶ Автопрокрутка" : "Ⅱ Пауза прокрутки"}
          </button>
          <button
            disabled={!rows.length}
            onClick={() => copy(rows.map(rowText).join("\n"))}
          >
            COPY ЖУРНАЛ
          </button>
          <button
            disabled={!filtered.length}
            onClick={() => download(filtered)}
          >
            CSV
          </button>
          <button
            disabled={!rows.length}
            onClick={() => {
              setHistories((old) => ({
                ...old,
                [historyBand]: { rows: [], count: 0 },
              }));
              setSelected(null);
            }}
          >
            CLEAR {bandLabel(historyBand)}
          </button>
          <button className="ft8-danger" onClick={() => setConfirmAll(true)}>
            Очистить всё…
          </button>
        </div>
        {confirmAll && (
          <div className="ft8-confirm" role="alert">
            <span>Удалить принятые сообщения всех диапазонов?</span>
            <button
              onClick={() => {
                setHistories({});
                setSelected(null);
                setConfirmAll(false);
              }}
            >
              Да, очистить все истории
            </button>
            <button onClick={() => setConfirmAll(false)}>Отмена</button>
          </div>
        )}
        {notice && (
          <div className="ft8-notice" role="status">
            {notice}
            <button
              aria-label="Скрыть уведомление"
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </div>
        )}
        <div className="ft8-log-meta">
          <span>
            {filtered.length} по фильтрам · {rows.length} сохранено ·{" "}
            {paused
              ? "Прокрутка приостановлена"
              : sort === "utc" && !ascending
                ? "Новые сообщения сверху"
                : "Автопрокрутка к началу"}
          </span>
          <span>Цвет — тип сообщения · NEW — новое в сохранённой истории</span>
        </div>
        <div ref={scroller} className="ft8-table" aria-label="Журнал FT8">
          <table>
            <thead>
              <tr>
                {[
                  "UTC",
                  "SNR ≈",
                  "DT",
                  "AUDIO Hz",
                  "ПОЗЫВНОЙ",
                  "СТРАНА / DXCC",
                  "ЛОКАТОР",
                  "ТИП",
                  "СООБЩЕНИЕ",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.id}
                  className={`ft8-kind-${r.kind} ${r.fresh ? "ft8-fresh" : ""}`}
                >
                  <td>{utc(r.utc)}</td>
                  <td>{r.snr.toFixed(0)}</td>
                  <td>{r.dt.toFixed(2)}</td>
                  <td>{r.hz.toFixed(0)}</td>
                  <td>{renderCall(r)}</td>
                  <td title="Предполагаемая DXCC по позывному; не подтверждённое местонахождение">
                    {r.country.name}
                  </td>
                  <td>{r.locator || "—"}</td>
                  <td>
                    <span className="ft8-type">
                      {TYPE_LABELS[r.kind]}
                      {r.region && r.region !== "DX" ? ` · ${r.region}` : ""}
                    </span>
                  </td>
                  <td>
                    <code>{r.message}</code>
                    <small>{r.explanation}</small>
                    <button
                      className="ft8-row-copy"
                      aria-label={`Копировать ${r.message}`}
                      onClick={() => copy(rowText(r))}
                    >
                      COPY
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ft8-mobile-rows">
            {visible.map((r) => (
              <article
                key={r.id}
                className={`ft8-mobile-row ft8-kind-${r.kind}`}
              >
                <div>
                  {renderCall(r)}
                  <span className="ft8-type">
                    {TYPE_LABELS[r.kind]} {r.region !== "DX" ? r.region : ""}
                  </span>
                </div>
                <div className="ft8-mobile-meta">
                  <span>{utc(r.utc)} UTC</span>
                  <span>≈{r.snr.toFixed(0)} dB</span>
                  <span>DT {r.dt.toFixed(2)}</span>
                  <span>{r.hz.toFixed(0)} Hz</span>
                </div>
                <p>
                  {r.country.name} · {r.locator || "Локатор не передан"}
                </p>
                <code>{r.message}</code>
                <p>{r.explanation}</p>
                <button
                  aria-label={`Копировать карточку ${r.message}`}
                  onClick={() => copy(rowText(r))}
                >
                  COPY
                </button>
              </article>
            ))}
          </div>
          {!filtered.length && (
            <div className="ft8-empty">
              <span>⌁</span>
              <strong>
                {rows.length
                  ? "По заданным фильтрам сообщений нет"
                  : "Ожидание принятых сообщений"}
              </strong>
              <p>
                START включает существующий FT8 RX. Первый неполный UTC-слот
                пропускается; полный цикл — 15 секунд.
              </p>
            </div>
          )}
        </div>
        {filtered.length > 100 && (
          <div className="ft8-pages">
            <button disabled={page === 0} onClick={() => setPage((v) => v - 1)}>
              ← Назад
            </button>
            <span>
              {page + 1} / {Math.ceil(filtered.length / 100)}
            </span>
            <button
              disabled={(page + 1) * 100 >= filtered.length}
              onClick={() => setPage((v) => v + 1)}
            >
              Далее →
            </button>
          </div>
        )}
        {mapOpen && (
          <MapBoundary onClose={() => setMapOpen(false)}>
            <Suspense
              fallback={<div className="ft8-empty">Загрузка FT8 DX MAP…</div>}
            >
              <DxMap
                rows={allRows}
                initialBand={historyBand}
                receiverName={receiverName}
                onStation={openStation}
                onClose={() => setMapOpen(false)}
              />
            </Suspense>
          </MapBoundary>
        )}
        {selected && latest && (
          <section
            ref={card}
            className="ft8-station"
            aria-label="Карточка FT8 станции"
          >
            <div className="ft8-map-head">
              <div>
                <small>RECEIVED STATION / RX ONLY</small>
                <h3>{selected.call}</h3>
              </div>
              <button onClick={() => setSelected(null)}>
                Закрыть карточку
              </button>
            </div>
            <div className="ft8-station-grid">
              <div>
                <small>ПРЕДПОЛАГАЕМАЯ DXCC</small>
                <strong>{latest.country.name}</strong>
                <span>
                  {latest.country.continent} · префикс {latest.country.prefix}
                </span>
              </div>
              <div>
                <small>ДЕКОДИРОВАННЫЙ ЛОКАТОР</small>
                <strong>
                  {stationHistory.find(
                    (r) => r.call === selected.call && r.locator,
                  )?.locator || "Не передан"}
                </strong>
                <span>
                  {(() => {
                    const grid = maidenhead(
                      stationHistory.find(
                        (r) => r.call === selected.call && r.locator,
                      )?.locator ?? "",
                    );
                    return grid
                      ? `Область: ${grid.south.toFixed(2)}…${grid.north.toFixed(2)}° N, ${grid.west.toFixed(2)}…${grid.east.toFixed(2)}° E`
                      : "Координаты по одному позывному не определяются";
                  })()}
                </span>
              </div>
              <div>
                <small>ПОСЛЕДНИЙ ПРИЁМ</small>
                <strong>
                  ≈{latest.snr.toFixed(0)} dB · {utc(latest.utc)} UTC
                </strong>
                <span>
                  {bandLabel(latest.band)} ·{" "}
                  {(latest.frequency / 1000).toFixed(6)} MHz · AF{" "}
                  {latest.hz.toFixed(0)} Hz
                </span>
              </div>
            </div>
            <p>{latest.explanation}</p>
            <div className="ft8-station-history">
              {stationHistory.map((r) => (
                <div key={r.id}>
                  <span>
                    {utc(r.utc)} · {bandLabel(r.band)} · ≈{r.snr.toFixed(0)}
                  </span>
                  <code>{r.message}</code>
                </div>
              ))}
            </div>
            <p>
              Это журнал одностороннего радиоприёма, а не подтверждённая связь с
              вами. DXCC предполагается по префиксу, локатор обозначает область
              и может относиться к более раннему сообщению.
            </p>
          </section>
        )}
        <details className="ft8-settings">
          <summary>Настройки RX, обозначения и источники</summary>
          <div className="ft8-tools">
            <label>
              Компенсация задержки, с{" "}
              <input
                aria-label="Задержка FT8"
                type="number"
                min="0"
                max="10"
                step="0.1"
                disabled={running}
                value={delay}
                onChange={(e) =>
                  setDelay(
                    Math.max(0, Math.min(10, Number(e.target.value) || 0)),
                  )
                }
              />
            </label>
            <label>
              Записей на диапазон{" "}
              <select
                aria-label="Лимит FT8"
                value={limit}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setLimit(n);
                  setHistories((old) =>
                    Object.fromEntries(
                      Object.entries(old).map(([b, h]) => [
                        b,
                        { ...h, rows: h.rows.slice(0, n) },
                      ]),
                    ),
                  );
                }}
              >
                {[100, 200, 500].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
          <p>
            CQ — общий вызов; CQ DX — дальние станции; CQ с меткой —
            направленный вызов. Рапорт — оценка сигнала адресата, R —
            подтверждение. RRR / RR73 / 73 — подтверждение и/или завершение
            обмена. В стандартном сообщении первый позывной — адресат, второй —
            передающая станция.
          </p>
          <p>
            Только CRC-проверенные результаты ft8_lib. SNR ≈ оценка в полосе
            2500 Hz, не калибрована по WSJT-X. DT отсчитывается от начала слота
            + 0,5 с с компенсацией FFT. UTC/DT зависят от часов и задержки PCM.
            Первый неполный слот пропускается; закрытие панели выключает RX.
            Чувствительность ниже WSJT-X; специальные форматы могут не
            поддерживаться.
          </p>
          <p>
            Истории хранятся до перезагрузки страницы: до {limit} записей на
            диапазон и 3000 суммарно. Нестандартная частота сохраняется в
            записи; частоты вне диапазонов имеют отдельную историю. Счётчики
            включают вытесненные записи. CSV экспортирует все отфильтрованные
            сохранённые записи.
          </p>
          <p>
            Локальный справочник:{" "}
            <a
              href="https://github.com/k0swe/dxcc-json"
              target="_blank"
              rel="noreferrer"
            >
              k0swe/dxcc-json
            </a>{" "}
            · 340 DXCC · Apache-2.0. Данные префиксов не являются подтверждением
            текущего местонахождения. /MM, /AM и неоднозначные совпадения: «Не
            определена». База может не учитывать новые спецпозывные.{" "}
            <a href="/licenses/dxcc-json.txt" target="_blank" rel="noreferrer">
              Лицензия и происхождение данных
            </a>
            .
          </p>
        </details>
      </dialog>
    </>
  );
}
