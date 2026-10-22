import { useRef, useState } from "react";
import { parseFrequency } from "./tuning";
import { MODES, type Mode } from "./radio";
import { LOG_KEY, parseLog, saveLog, validEntry, exportAdif, exportCsv, type SwlEntry } from "./swlLogbook";
import "./swl-logbook.css";

type Props = { frequencyHz: number; mode: Mode; onTune: (entry: SwlEntry) => void };
export function SwlLogbook({ frequencyHz, mode, onTune }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [loaded] = useState(() => {
    try { return { entries: parseLog(localStorage.getItem(LOG_KEY)), error: "" }; }
    catch { return { entries: [] as SwlEntry[], error: "Не удалось прочитать SWL-журнал. Сохранённые данные не изменены; запись заблокирована." }; }
  });
  const [entries, setEntries] = useState(loaded.entries);
  const [error, setError] = useState(loaded.error);
  const [query, setQuery] = useState("");
  const [call, setCall] = useState("");
  const [rst, setRst] = useState("");
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState<SwlEntry | null>(null);
  const [editFrequency, setEditFrequency] = useState("");
  const [editMode, setEditMode] = useState<Mode>(mode);
  const [editUtc, setEditUtc] = useState("");
  function reset() { setEditing(null); setCall(""); setRst(""); setComment(""); }
  function persist(next: SwlEntry[]) {
    if (loaded.error) return false;
    try { saveLog(localStorage, next); setEntries(next); setError(""); return true; }
    catch { setError("Не удалось сохранить журнал в localStorage. Изменение не сохранено."); return false; }
  }
  function submit() {
    const milliseconds = editing ? Date.parse(editUtc + "Z") : Date.now();
    const entry: SwlEntry = {
      id: editing?.id ?? crypto.randomUUID(), call: call.trim().toUpperCase(),
      frequencyHz: editing ? parseFrequency(editFrequency + " kHz") ?? NaN : frequencyHz,
      mode: editing ? editMode : mode,
      utc: Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : "",
      rst: rst.trim(), comment,
    };
    if (!validEntry(entry)) { setError("Проверьте позывной, частоту, UTC и RST (например 59 или 599)."); return; }
    if (persist(editing ? entries.map(e => e.id === entry.id ? entry : e) : [entry, ...entries])) reset();
  }
  function download(kind: "adif" | "csv") {
    const text = kind === "adif" ? exportAdif(entries) : exportCsv(entries);
    const url = URL.createObjectURL(new Blob([text], { type: kind === "adif" ? "application/xml;charset=utf-8" : "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `UR4MTN_SWL.${kind === "adif" ? "adx" : "csv"}`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const visible = entries.filter(e => e.call.includes(query.trim().toUpperCase()));
  return <>
    <button type="button" className="log-launch" aria-label="Открыть SWL-журнал LOG" onClick={() => dialog.current?.showModal()}>LOG</button>
    <dialog ref={dialog} className="swl-logbook" aria-labelledby="swl-log-title" onKeyDown={e => e.stopPropagation()}>
      <header><strong id="swl-log-title">DX LOGBOOK · SWL</strong><button type="button" aria-label="Закрыть SWL-журнал" onClick={() => dialog.current?.close()}>×</button></header>
      <p>Журнал принятых станций. Прослушивание не является двусторонней связью.</p>
      <form onSubmit={e => { e.preventDefault(); submit(); }}>
        {!editing && <small className="swl-snapshot">ADD сохранит {frequencyHz / 1000} kHz · {mode} · время нажатия UTC</small>}
        <label>Позывной<input aria-label="Позывной SWL" required maxLength={24} value={call} onChange={e => setCall(e.target.value)} autoCapitalize="characters" /></label>
        <label>RST наблюдения<input aria-label="RST наблюдения" maxLength={3} pattern="[1-5][1-9][1-9]?" placeholder="59 / 599" value={rst} onChange={e => setRst(e.target.value)} /></label>
        {editing && <>
          <label>Частота · kHz<input aria-label="Частота записи kHz" type="number" min="0.001" max="30000" step="0.001" required value={editFrequency} onChange={e => setEditFrequency(e.target.value)} /></label>
          <label>Режим<select aria-label="Режим записи" value={editMode} onChange={e => setEditMode(e.target.value as Mode)}>{MODES.map(m => <option key={m}>{m}</option>)}</select></label>
          <label className="swl-wide">Дата и время UTC<input aria-label="Дата и время записи UTC" type="datetime-local" step="1" required value={editUtc} onChange={e => setEditUtc(e.target.value)} /></label>
        </>}
        <label className="swl-wide">Комментарий<textarea aria-label="Комментарий SWL" maxLength={2000} rows={2} value={comment} onChange={e => setComment(e.target.value)} /></label>
        <div className="swl-actions swl-wide"><button type="submit" disabled={!!loaded.error}>{editing ? "Сохранить запись" : "ADD"}</button>{editing && <button type="button" onClick={reset}>Отмена</button>}</div>
      </form>
      <label>Поиск по позывному<input aria-label="Поиск SWL по позывному" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className="swl-list">
        {visible.map(e => <article key={e.id} data-log-id={e.id}>
          <div><strong>{e.call}</strong> <small>{e.utc.slice(0, 10)} {e.utc.slice(11, 19)} UTC</small></div>
          <button type="button" className="swl-frequency" aria-label={`Настроить ${e.frequencyHz / 1000} kHz ${e.mode}`} onClick={() => { onTune(e); dialog.current?.close(); }}>{e.frequencyHz / 1000} kHz · {e.mode}</button>
          <small>SWL{e.rst && ` · RST ${e.rst}`}</small><p className="swl-comment">{e.comment}</p>
          <div className="swl-actions"><button type="button" aria-label={`Редактировать ${e.call}`} onClick={() => {
            setEditing(e); setCall(e.call); setRst(e.rst); setComment(e.comment); setEditFrequency(String(e.frequencyHz / 1000)); setEditMode(e.mode); setEditUtc(e.utc.slice(0, 19));
          }}>Редактировать</button><button type="button" disabled={!!loaded.error} aria-label={`Удалить ${e.call}`} onClick={() => { if (persist(entries.filter(v => v.id !== e.id)) && editing?.id === e.id) reset(); }}>Удалить</button></div>
        </article>)}
        {!visible.length && <p>{entries.length ? "Нет записей по запросу" : "Журнал пуст"}</p>}
      </div>
      <footer className="swl-actions"><button type="button" disabled={!entries.length} onClick={() => download("adif")}>Экспорт ADIF 3 (.adx)</button><button type="button" disabled={!entries.length} onClick={() => download("csv")}>Экспорт CSV</button></footer>
      {error && <p role="alert">{error}</p>}
    </dialog>
  </>;
}
