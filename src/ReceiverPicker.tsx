import { useState, useRef, useMemo, memo } from "react";
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
  directUrl?: string;
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
  const [open, setOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(60);
  function showCatalog() {
    setOpen(true);
    setVisibleCount(60);
    dialog.current?.showModal();
  }
  function closeCatalog() {
    dialog.current?.close();
    setOpen(false);
  }
  const current = receivers.find((r) => r.id === selected);
  const rows = useMemo(
    () =>
      receivers
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
        ),
    [receivers, favorites, search, onlyFavorites],
  );
  return (
    <div className="receiver-choice" data-count={receivers.length}>
      <label htmlFor="receiver">ПРИЁМНИК</label>
      <div className="receiver-select">
        <input id="receiver" type="hidden" value={selected} readOnly />
        <button
          className="receiver-trigger"
          aria-label="Приёмник"
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled}
          onClick={showCatalog}
        >
          <span>{current?.name || "Загрузка приёмников…"}</span>
          <span aria-hidden="true">⌄</span>
        </button>
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
        onClick={showCatalog}
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
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            const r = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < r.left ||
              e.clientX > r.right ||
              e.clientY < r.top ||
              e.clientY > r.bottom
            )
              closeCatalog();
          }
        }}
      >
        <div className="dialog-head">
          <h2>Публичные KiwiSDR</h2>
          <button aria-label="Закрыть список серверов" onClick={closeCatalog}>
            ✕
          </button>
        </div>
        <div className="catalog-tools">
          <input
            aria-label="Поиск приёмников"
            placeholder="Страна, город, позывной…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisibleCount(60);
            }}
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
          {open &&
            rows.slice(0, visibleCount).map((r) => (
              <div
                role="listitem"
                className={
                  "catalog-row " + (r.id === selected ? "current" : "")
                }
                key={r.id}
              >
                <button
                  className="catalog-item"
                  onClick={() => {
                    choose(r.id);
                    closeCatalog();
                  }}
                >
                  <strong>{r.name}</strong>
                  <small>
                    {r.directUrl ? "Прямой защищённый WSS · " : ""}
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
          {open && visibleCount < rows.length && (
            <button
              className="catalog-more"
              onClick={() => setVisibleCount((n) => n + 60)}
            >
              Показать ещё · {rows.length - visibleCount}
            </button>
          )}
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
