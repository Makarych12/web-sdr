import { useRef, useState } from "react";
import { radioDiagnostics as log } from "./radioDiagnostics";

export function RadioDiagnosticsPanel() {
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const refresh = () => { log.record("journal_snapshot"); setText(log.text()); };
  async function copy() {
    log.record("journal_copy");
    const value = log.text();
    setText(value);
    try { await navigator.clipboard.writeText(value); setMessage("Скопировано"); }
    catch {
      if (field.current) { field.current.value = value; field.current.focus(); field.current.select(); }
      setMessage("Выделен журнал: используйте команду «Копировать»");
    }
  }
  return <details style={{ margin: "8px 0", fontSize: 12 }} onToggle={event => {
    if (event.currentTarget.open) refresh();
  }}>
    <summary>Диагностика приёма</summary>
    <p>Последние 120 событий. PCM сохраняется не чаще раза в 5 секунд; события сна и закрытия — сразу.</p>
    {!log.persistent && <p role="status">Хранилище недоступно: журнал сохранён только до перезагрузки страницы.</p>}
    <button type="button" onClick={refresh}>Обновить</button>{" "}
    <button type="button" onClick={() => void copy()}>Копировать журнал</button>
    <span role="status"> {message}</span>
    <textarea ref={field} aria-label="Диагностический журнал приёма" readOnly value={text}
      rows={8} style={{ display: "block", width: "100%", boxSizing: "border-box", fontSize: 11 }} />
  </details>;
}
