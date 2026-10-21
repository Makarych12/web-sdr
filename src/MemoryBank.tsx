import { useRef, useState } from "react";
import { mergeMemories, parseMemoryJson, type SavedFrequency } from "./memoryBank";
import "./memory.css";

type Props = {
  entries: SavedFrequency[];
  current: SavedFrequency;
  onChange: (entries: SavedFrequency[]) => void;
  onSelect: (entry: SavedFrequency) => void;
};

export function MemoryBank({ entries, current, onChange, onSelect }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const latestEntries = useRef(entries);
  latestEntries.current = entries;
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const search = query.trim().toLocaleLowerCase();
  const visible = entries.filter((entry) =>
    (entry.name ?? "").toLocaleLowerCase().includes(search) || String(entry.frequency).includes(search.replace(",", ".")));
  function save() {
    try {
      onChange(mergeMemories(entries, [{ ...current, name: name.trim() }]));
      setMessage("Станция сохранена");
    } catch (error) { setMessage((error as Error).message); }
  }
  function exportJson() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "UR4MTN_MEMORY.json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function importJson(selected: File) {
    try {
      if (selected.size > 2 * 1024 * 1024) throw new Error("JSON-файл слишком большой (максимум 2 MiB)");
      const imported = parseMemoryJson(await selected.text());
      // The scanner can save another station while File.text() is pending.
      onChange(mergeMemories(latestEntries.current, imported));
      setMessage(`Импортировано станций: ${imported.length}`);
    } catch (error) {
      setMessage(error instanceof SyntaxError ? "Некорректный JSON" : (error as Error).message);
    }
  }
  return <>
    <button type="button" className="mem-launch" aria-label="Панель MEM" onClick={() => {
      setName(entries.find((entry) => entry.id === current.id)?.name ?? "");
      setMessage("");
      setEditing(null);
      dialog.current?.showModal();
    }}>MEM</button>
    <dialog ref={dialog} className="memory-panel" aria-labelledby="memory-title" onKeyDown={(e) => e.stopPropagation()}>
      <div className="memory-heading"><strong id="memory-title">MEMORY BANK</strong>
        <button type="button" aria-label="Закрыть панель MEM" onClick={() => dialog.current?.close()}>×</button>
      </div>
      <form className="memory-save" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <small>{current.frequency} kHz · {current.mode} · {current.cuts!.lowCut}…{current.cuts!.highCut} Hz</small>
        <input aria-label="Название станции" placeholder="Название станции" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit">SAVE</button>
      </form>
      <input aria-label="Поиск в памяти" placeholder="Название или частота, kHz" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="memory-list">
        {visible.map((entry) => <div key={entry.id} className="memory-entry">
          <button type="button" className="memory-tune" onClick={() => { onSelect(entry); dialog.current?.close(); }}>
            {entry.name && <strong>{entry.name}</strong>}
            <small>{entry.frequency} kHz · {entry.mode}{entry.cuts && ` · ${entry.cuts.lowCut}…${entry.cuts.highCut} Hz`}</small>
          </button>
          <button type="button" aria-label={`Переименовать ${entry.frequency} ${entry.mode}`} onClick={() => { setEditing(entry.id); setEditName(entry.name ?? ""); }}>✎</button>
          <button type="button" aria-label={`Удалить ${entry.frequency} ${entry.mode} из памяти`} onClick={() => {
            onChange(entries.filter((saved) => saved.id !== entry.id));
            if (editing === entry.id) setEditing(null);
          }}>×</button>
          {editing === entry.id && <form className="memory-edit" onSubmit={(e) => {
            e.preventDefault();
            onChange(entries.map((saved) => saved.id === entry.id ? { ...saved, name: editName.trim() } : saved));
            setEditing(null);
          }}><input aria-label="Новое название станции" maxLength={120} value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
            <button type="submit" aria-label="Сохранить название">✓</button></form>}
        </div>)}
        {!visible.length && <small>Нет сохранённых станций по запросу</small>}
      </div>
      <div className="memory-backup"><button type="button" onClick={exportJson}>Экспорт JSON</button>
        <button type="button" onClick={() => file.current?.click()}>Импорт JSON</button>
        <input ref={file} type="file" accept=".json,application/json" aria-label="Файл памяти JSON" hidden onChange={(e) => {
          const selected = e.target.files?.[0];
          e.target.value = "";
          if (selected) void importJson(selected);
        }} /></div>
      <small>Импорт добавляет станции и обновляет совпадения по частоте и режиму.</small>
      {message && <p role="status">{message}</p>}
    </dialog>
  </>;
}
