import { useState, useRef, memo } from "react";
export type Receiver = {
  id: string;
  name: string;
  location?: string;
  users?: number;
  maxUsers?: number;
  snr?: number;
  minFrequency?: number;
  maxFrequency?: number;
  updatedAt?: string;
  apiAvailable?: boolean;
};
type Props = {
  receivers: Receiver[];
  selected: string;
  favorites: string[];
  choose: (id: string) => void;
  favorite: (id: string) => void;
  disabled: boolean;
};
export const ReceiverPicker = memo(function ReceiverPicker({
  receivers,
  selected,
  favorites,
  choose,
  favorite,
  disabled,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null),
    [search, setSearch] = useState(""),
    [onlyFavorites, setOnlyFavorites] = useState(false);
  const current = receivers.find((r) => r.id === selected);
  const rows = receivers
    .filter(
      (r) =>
        (!onlyFavorites || favorites.includes(r.id)) &&
        `${r.name} ${r.location || ""}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)),
    );
  return (
    <div className="receiver-choice">
      <label htmlFor="receiver">ПРИЁМНИК</label>
      <div className="receiver-select">
        <select
          id="receiver"
          aria-label="Приёмник"
          value={selected}
          disabled={disabled}
          onChange={(e) => choose(e.target.value)}
        >
          {receivers.map((r) => (
            <option key={r.id} value={r.id}>
              {favorites.includes(r.id) ? "★ " : ""}
              {r.name}
            </option>
          ))}
        </select>
        <button
          className="star"
          aria-label="Избранный сервер"
          aria-pressed={favorites.includes(selected)}
          disabled={!current}
          onClick={() => favorite(selected)}
        >
          {favorites.includes(selected) ? "★" : "☆"}
        </button>
      </div>
      <button
        className="catalog-open"
        disabled={disabled}
        onClick={() => dialog.current?.showModal()}
      >
        Все приёмники · {receivers.length} <span>Поиск ↗</span>
      </button>
      {current?.maxUsers !== undefined && (
        <small>
          По каталогу: {current.users}/{current.maxUsers} слушателей
          {current.snr ? ` · SNR ${current.snr} dB` : ""}
        </small>
      )}
      <dialog
        ref={dialog}
        className="catalog-dialog"
        aria-label="Публичные KiwiSDR"
      >
        <div className="dialog-head">
          <h2>Публичные KiwiSDR</h2>
          <button
            aria-label="Закрыть список серверов"
            onClick={() => dialog.current?.close()}
          >
            ✕
          </button>
        </div>
        <div className="catalog-tools">
          <input
            aria-label="Поиск приёмников"
            placeholder="Страна, город, позывной…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            aria-pressed={onlyFavorites}
            className={onlyFavorites ? "selected" : ""}
            onClick={() => setOnlyFavorites(!onlyFavorites)}
          >
            ★ Избранные
          </button>
        </div>
        <p className="catalog-note">
          Доступность и число слушателей — по последнему обновлению каталога.
          При подключении сервер может оказаться занят.
        </p>
        <div className="catalog-results" role="list">
          {rows.map((r) => (
            <div
              role="listitem"
              className={"catalog-row " + (r.id === selected ? "current" : "")}
              key={r.id}
            >
              <button
                className="catalog-item"
                onClick={() => {
                  choose(r.id);
                  dialog.current?.close();
                }}
              >
                <strong>{r.name}</strong>
                <small>
                  {r.location || "Публичный приёмник"}
                  {r.maxUsers !== undefined
                    ? ` · ${r.users}/${r.maxUsers} слушателей`
                    : ""}
                  {r.snr ? ` · SNR ${r.snr} dB` : ""}
                </small>
              </button>
              <button
                className="star"
                aria-label={`В избранное: ${r.name}`}
                aria-pressed={favorites.includes(r.id)}
                onClick={() => favorite(r.id)}
              >
                {favorites.includes(r.id) ? "★" : "☆"}
              </button>
            </div>
          ))}
          {!rows.length && (
            <p>
              Ничего не найдено. Измените поиск или добавьте сервер в избранное.
            </p>
          )}
        </div>
      </dialog>
    </div>
  );
});
