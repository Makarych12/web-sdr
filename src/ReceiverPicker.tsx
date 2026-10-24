import { useState, useRef, useMemo, useEffect, useCallback, memo } from "react";
import { gateway } from "./gateway";
import {
  getReceiverGeo,
  CONTINENTS,
  type ContinentName,
  type ReceiverGeoInfo,
} from "./receiverGeo";
import "./receiver-picker.css";

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

type CheckRecord = {
  reachable?: boolean;
  responseMs?: number;
  users?: number;
  maxUsers?: number;
  timestamp: number;
  failed?: boolean;
  statusText?: string;
};

type QuickTab = "all" | "available" | "free" | "favorites";
type SortOption = "free" | "country" | "name" | "latency";

const CHECK_TTL_MS = 60_000;
const MAX_CONCURRENT_CHECKS = 2;
const REQUEST_TIMEOUT_MS = 6_500;
const PAGE_SIZE = 60;

export const ReceiverPicker = memo(function ReceiverPicker({
  receivers,
  selected,
  favorites,
  choose,
  favorite,
  disabled,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  // Filter & Search states
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<QuickTab>("all");
  const [selectedContinent, setSelectedContinent] = useState<ContinentName>("Все");
  const [selectedCountry, setSelectedCountry] = useState<string>("Все");
  const [sortOption, setSortOption] = useState<SortOption>("free");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Check state and in-flight tracking
  const [checks, setChecks] = useState<Record<string, CheckRecord>>({});
  const checksRef = useRef<Record<string, CheckRecord>>(checks);
  checksRef.current = checks;

  // Active checking map: only true while an HTTP request is actively running
  const [checkingMap, setCheckingMap] = useState<Record<string, boolean>>({});
  const inFlightRef = useRef<Set<string>>(new Set());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  // Cached geo metadata for all receivers
  const geoMap = useMemo(() => {
    const map = new Map<string, ReceiverGeoInfo>();
    for (const r of receivers) {
      map.set(r.id, getReceiverGeo(r));
    }
    return map;
  }, [receivers]);

  // Unique countries list with counts for filtering
  const countryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of receivers) {
      const geo = geoMap.get(r.id);
      if (geo) {
        if (selectedContinent !== "Все" && geo.continent !== selectedContinent) {
          continue;
        }
        counts.set(geo.country, (counts.get(geo.country) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country, "ru"));
  }, [receivers, geoMap, selectedContinent]);

  // Selected receiver single-check on mount or selection change (with finite timeout)
  useEffect(() => {
    if (!receivers.some((r) => r.id === selected)) return;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    fetch(
      `${gateway.http}/api/receivers/${encodeURIComponent(selected)}/check`,
      { signal: controller.signal },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((value) => {
        if (value && !controller.signal.aborted) {
          setChecks((old) => {
            const next = {
              ...old,
              [selected]: {
                reachable: Boolean(value.reachable),
                responseMs: typeof value.responseMs === "number" ? value.responseMs : undefined,
                users: typeof value.users === "number" ? value.users : undefined,
                maxUsers: typeof value.maxUsers === "number" ? value.maxUsers : undefined,
                timestamp: Date.now(),
                failed: false,
              },
            };
            checksRef.current = next;
            return next;
          });
        }
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeoutId));

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [selected, receivers]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();

    return receivers.filter((r) => {
      const geo = geoMap.get(r.id);

      // Quick tabs filter
      if (tab === "favorites" && !favorites.includes(r.id)) return false;
      if (tab === "free") {
        const check = checks[r.id];
        const users = check?.users ?? r.users ?? 0;
        const max = check?.maxUsers ?? r.maxUsers;
        if (max !== undefined && users >= max) return false;
      }
      if (tab === "available") {
        const check = checks[r.id];
        if (check && check.reachable === false) return false;
      }

      // Continent filter
      if (
        selectedContinent !== "Все" &&
        geo?.continent !== selectedContinent
      ) {
        return false;
      }

      // Country filter
      if (selectedCountry !== "Все" && geo?.country !== selectedCountry) {
        return false;
      }

      // Search match
      if (q) {
        const fullString = `${r.name} ${r.location || ""} ${geo?.country || ""} ${geo?.city || ""} ${geo?.callsign || ""} ${geo?.shortAddress || ""}`.toLocaleLowerCase();
        if (!fullString.includes(q)) return false;
      }

      return true;
    });
  }, [
    receivers,
    geoMap,
    search,
    tab,
    selectedContinent,
    selectedCountry,
    favorites,
    checks,
  ]);

  // Sorted rows
  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      // Current selected always on top if in list
      if (a.id === selected) return -1;
      if (b.id === selected) return 1;

      // Favorites prioritized in standard views
      if (tab !== "favorites") {
        const aFav = favorites.includes(a.id);
        const bFav = favorites.includes(b.id);
        if (aFav !== bFav) return aFav ? -1 : 1;
      }

      if (sortOption === "country") {
        const aGeo = geoMap.get(a.id);
        const bGeo = geoMap.get(b.id);
        const cmp = (aGeo?.country || "").localeCompare(
          bGeo?.country || "",
          "ru",
        );
        if (cmp !== 0) return cmp;
        return a.name.localeCompare(b.name, "ru");
      }

      if (sortOption === "name") {
        return a.name.localeCompare(b.name, "ru");
      }

      if (sortOption === "latency") {
        const aMs = checks[a.id]?.responseMs;
        const bMs = checks[b.id]?.responseMs;
        if (aMs !== undefined && bMs !== undefined) return aMs - bMs;
        if (aMs !== undefined) return -1;
        if (bMs !== undefined) return 1;
      }

      // Default "free" sort:
      // Reachable with free slots > direct WSS > catalog slots > responseMs
      const aCheck = checks[a.id];
      const bCheck = checks[b.id];

      // Check reachable
      if (aCheck?.reachable !== bCheck?.reachable) {
        if (aCheck?.reachable === true) return -1;
        if (bCheck?.reachable === true) return 1;
      }

      // Free slots
      const aMax = aCheck?.maxUsers ?? a.maxUsers ?? 0;
      const aUsers = aCheck?.users ?? a.users ?? 0;
      const aFree = Math.max(0, aMax - aUsers);

      const bMax = bCheck?.maxUsers ?? b.maxUsers ?? 0;
      const bUsers = bCheck?.users ?? b.users ?? 0;
      const bFree = Math.max(0, bMax - bUsers);

      if (aFree !== bFree) return bFree - aFree;

      // Direct WSS preference
      if (!!b.directUrl !== !!a.directUrl) {
        return Number(!!b.directUrl) - Number(!!a.directUrl);
      }

      // Latency if measured
      if (aCheck?.responseMs && bCheck?.responseMs) {
        return aCheck.responseMs - bCheck.responseMs;
      }

      return 0;
    });
  }, [filteredRows, selected, favorites, tab, sortOption, checks, geoMap]);

  // Queue runner function decoupled from render state loops
  const runNextCheck = useCallback(() => {
    if (!openRef.current) return;
    if (inFlightRef.current.size >= MAX_CONCURRENT_CHECKS) return;

    // Determine visible candidates (up to first 24 cards of current visible slice)
    const visibleBatch = sortedRows.slice(0, Math.min(visibleCount, 24));
    const now = Date.now();

    const candidate = visibleBatch.find((r) => {
      const existing = checksRef.current[r.id];
      const isFresh = existing && now - existing.timestamp < CHECK_TTL_MS;
      const isInFlight = inFlightRef.current.has(r.id);
      return !isFresh && !isInFlight;
    });

    if (!candidate) return;

    const id = candidate.id;
    inFlightRef.current.add(id);
    setCheckingMap((prev) => ({ ...prev, [id]: true }));

    const controller = new AbortController();
    abortControllersRef.current.set(id, controller);

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    fetch(
      `${gateway.http}/api/receivers/${encodeURIComponent(id)}/check`,
      { signal: controller.signal },
    )
      .then(async (res) => {
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          const record: CheckRecord = {
            reachable: Boolean(data.reachable),
            responseMs:
              typeof data.responseMs === "number" ? data.responseMs : undefined,
            users: typeof data.users === "number" ? data.users : undefined,
            maxUsers:
              typeof data.maxUsers === "number" ? data.maxUsers : undefined,
            timestamp: Date.now(),
            failed: false,
          };
          setChecks((prev) => {
            const next = { ...prev, [id]: record };
            checksRef.current = next;
            return next;
          });
        } else {
          // HTTP 429 (rate-limit) or server error - Kiwi is NOT marked offline!
          const is429 = res.status === 429;
          const record: CheckRecord = {
            timestamp: Date.now() - CHECK_TTL_MS + (is429 ? 15_000 : 25_000),
            failed: true,
            statusText: is429 ? "Шлюз занят (429)" : `Ошибка HTTP ${res.status}`,
          };
          setChecks((prev) => {
            const next = { ...prev, [id]: record };
            checksRef.current = next;
            return next;
          });
        }
      })
      .catch((err: any) => {
        clearTimeout(timeoutId);
        if (!openRef.current || err?.name === "AbortError") {
          // Normal close or timeout cancellation
          const isTimeout = err?.name === "AbortError" && openRef.current;
          if (isTimeout) {
            const record: CheckRecord = {
              timestamp: Date.now() - CHECK_TTL_MS + 20_000,
              failed: true,
              statusText: "Тайм-аут запроса",
            };
            setChecks((prev) => {
              const next = { ...prev, [id]: record };
              checksRef.current = next;
              return next;
            });
          }
          return;
        }
        // General network error: Kiwi is NOT marked offline
        const record: CheckRecord = {
          timestamp: Date.now() - CHECK_TTL_MS + 20_000,
          failed: true,
          statusText: "Сбой сети",
        };
        setChecks((prev) => {
          const next = { ...prev, [id]: record };
          checksRef.current = next;
          return next;
        });
      })
      .finally(() => {
        clearTimeout(timeoutId);
        abortControllersRef.current.delete(id);
        inFlightRef.current.delete(id);
        setCheckingMap((prev) => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        // Immediately try next candidate if dialog is still open
        if (openRef.current) {
          setTimeout(runNextCheck, 50);
        }
      });
  }, [sortedRows, visibleCount]);

  // Trigger queue check when visible batch or dialog opens
  useEffect(() => {
    if (!open) return;

    // Launch up to MAX_CONCURRENT_CHECKS workers
    runNextCheck();
    const timer = setTimeout(runNextCheck, 100);

    return () => {
      clearTimeout(timer);
    };
  }, [open, runNextCheck]);

  // Clean shutdown when dialog closes or unmounts
  useEffect(() => {
    if (!open) {
      abortControllersRef.current.forEach((c) => c.abort());
      abortControllersRef.current.clear();
      inFlightRef.current.clear();
      setCheckingMap({});
    }
  }, [open]);

  const showCatalog = useCallback(() => {
    setOpen(true);
    setVisibleCount(PAGE_SIZE);
    dialog.current?.showModal();
  }, []);

  const closeCatalog = useCallback(() => {
    dialog.current?.close();
    setOpen(false);
  }, []);

  const handleResetFilters = useCallback(() => {
    setSearch("");
    setTab("all");
    setSelectedContinent("Все");
    setSelectedCountry("Все");
    setSortOption("free");
    setVisibleCount(PAGE_SIZE);
  }, []);

  const current = receivers.find((r) => r.id === selected);
  const activeCheckingCount = Object.keys(checkingMap).length;

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

      {/* SDR SERVER EXPLORER DIALOG */}
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
            ) {
              closeCatalog();
            }
          }
        }}
      >
        {/* Header */}
        <div className="explorer-head dialog-head">
          <div className="explorer-title-group">
            <div className="explorer-radar-icon" aria-hidden="true">
              📡
            </div>
            <h2 className="explorer-title">
              SDR SERVER EXPLORER
              <span className="explorer-badge-count">
                {receivers.length} серверов
              </span>
            </h2>
          </div>
          <button
            className="explorer-close-btn"
            aria-label="Закрыть список серверов"
            onClick={closeCatalog}
          >
            ✕
          </button>
        </div>

        {/* Toolbar & Filters */}
        <div className="explorer-toolbar catalog-tools">
          {/* Top row: search + quick tabs */}
          <div className="explorer-row-top">
            <div className="explorer-search-wrapper">
              <span className="explorer-search-icon" aria-hidden="true">
                🔍
              </span>
              <input
                className="explorer-search-input"
                aria-label="Поиск приёмников"
                placeholder="Страна, город, позывной, имя, адрес…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setVisibleCount(PAGE_SIZE);
                }}
              />
              {search && (
                <button
                  className="explorer-search-clear"
                  aria-label="Очистить поиск"
                  onClick={() => setSearch("")}
                >
                  ✕
                </button>
              )}
            </div>

            <div className="explorer-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={tab === "all"}
                className={`explorer-tab-btn ${tab === "all" ? "active" : ""}`}
                onClick={() => {
                  setTab("all");
                  setVisibleCount(PAGE_SIZE);
                }}
              >
                Все
              </button>
              <button
                role="tab"
                aria-selected={tab === "available"}
                className={`explorer-tab-btn ${tab === "available" ? "active" : ""}`}
                onClick={() => {
                  setTab("available");
                  setVisibleCount(PAGE_SIZE);
                }}
              >
                Доступные
              </button>
              <button
                role="tab"
                aria-selected={tab === "free"}
                className={`explorer-tab-btn ${tab === "free" ? "active" : ""}`}
                onClick={() => {
                  setTab("free");
                  setVisibleCount(PAGE_SIZE);
                }}
              >
                Свободные
              </button>
              <button
                role="tab"
                aria-selected={tab === "favorites"}
                aria-pressed={tab === "favorites"}
                className={`explorer-tab-btn ${tab === "favorites" ? "active selected" : ""}`}
                onClick={() => {
                  setTab(tab === "favorites" ? "all" : "favorites");
                  setVisibleCount(PAGE_SIZE);
                }}
              >
                ★ Избранные ({favorites.length})
              </button>
            </div>
          </div>

          {/* Bottom row: continents + country dropdown + sort */}
          <div className="explorer-row-bottom">
            <div
              className="explorer-continents-chips"
              role="radiogroup"
              aria-label="Континенты"
            >
              {CONTINENTS.map((c) => (
                <button
                  key={c}
                  className={`explorer-continent-pill ${selectedContinent === c ? "active" : ""}`}
                  onClick={() => {
                    setSelectedContinent(c);
                    setSelectedCountry("Все");
                    setVisibleCount(PAGE_SIZE);
                  }}
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="explorer-selects">
              <select
                className="explorer-select"
                aria-label="Фильтр по стране"
                value={selectedCountry}
                onChange={(e) => {
                  setSelectedCountry(e.target.value);
                  setVisibleCount(PAGE_SIZE);
                }}
              >
                <option value="Все">Все страны ({receivers.length})</option>
                {countryCounts.map(({ country, count }) => (
                  <option key={country} value={country}>
                    {country} ({count})
                  </option>
                ))}
              </select>

              <select
                className="explorer-select"
                aria-label="Сортировка"
                value={sortOption}
                onChange={(e) => {
                  setSortOption(e.target.value as SortOption);
                  setVisibleCount(PAGE_SIZE);
                }}
              >
                <option value="free">Свободные сначала</option>
                <option value="country">По стране (А–Я)</option>
                <option value="name">По названию (А–Я)</option>
                <option value="latency">По задержке (быстрые)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Status subbar */}
        <div className="explorer-status-bar">
          <div className="explorer-counter-info">
            <span>
              Показано {Math.min(visibleCount, sortedRows.length)} из{" "}
              {sortedRows.length} серверов
            </span>
            {(search ||
              tab !== "all" ||
              selectedContinent !== "Все" ||
              selectedCountry !== "Все") && (
              <button
                className="explorer-reset-btn"
                onClick={handleResetFilters}
              >
                Сбросить фильтры
              </button>
            )}
          </div>
          {activeCheckingCount > 0 ? (
            <div className="explorer-checking-indicator">
              <span className="explorer-pulse-dot" aria-hidden="true" />
              <span>Проверка доступности…</span>
            </div>
          ) : (
            <div className="explorer-counter-info" style={{ color: "#64748b" }}>
              <span>✓ Статусы обновлены</span>
            </div>
          )}
        </div>

        {/* Server Cards Grid */}
        <div className="catalog-results" role="list">
          {open &&
            sortedRows.slice(0, visibleCount).map((r) => {
              const geo = geoMap.get(r.id) || getReceiverGeo(r);
              const check = checks[r.id];
              const isChecking = Boolean(checkingMap[r.id]);
              const isCurrent = r.id === selected;
              const isFavorite = favorites.includes(r.id);

              // Live status determination based strictly on real check results & catalog slots
              let statusClass: "green" | "red" | "yellow" | "gray" = "gray";
              let statusLabel = "По каталогу";
              let statusTooltip = "Статус по последнему снимку каталога";

              if (isChecking) {
                statusClass = "yellow";
                statusLabel = "Проверка…";
                statusTooltip = "Проверяется доступность узла через шлюз";
              } else if (check) {
                if (check.failed) {
                  // Network error, 429 rate limit or gateway timeout - DO NOT mark offline!
                  statusClass = "gray";
                  statusLabel = "Не проверен";
                  statusTooltip = check.statusText
                    ? `Проверка шлюза не удалась (${check.statusText})`
                    : "Не удалось проверить доступность";
                } else if (check.reachable === false) {
                  // Confirmed offline by Kiwi /status check
                  statusClass = "red";
                  statusLabel = "Не работает";
                  statusTooltip =
                    "Сервер подтверждённо недоступен (HTTP/WSS оффлайн)";
                } else if (check.reachable === true) {
                  const effectiveUsers = check.users ?? r.users ?? 0;
                  const effectiveMax = check.maxUsers ?? r.maxUsers;
                  if (
                    effectiveMax !== undefined &&
                    effectiveUsers >= effectiveMax
                  ) {
                    // Confirmed busy: all slots full
                    statusClass = "red";
                    statusLabel = `Занят (${effectiveUsers}/${effectiveMax})`;
                    statusTooltip = `Сервер доступен, но все слоты заняты (${effectiveUsers}/${effectiveMax})`;
                  } else {
                    // Confirmed available with free slot
                    const free =
                      effectiveMax !== undefined
                        ? Math.max(0, effectiveMax - effectiveUsers)
                        : undefined;
                    statusClass = "green";
                    statusLabel =
                      free !== undefined ? `Свободен (${free})` : "Доступен";
                    statusTooltip = `Сервер проверен и доступен${
                      check.responseMs ? ` (${check.responseMs} мс)` : ""
                    }${free !== undefined ? ` · свободно мест: ${free}` : ""}`;
                  }
                }
              } else if (r.maxUsers !== undefined) {
                const free = Math.max(0, r.maxUsers - (r.users ?? 0));
                statusClass = "gray";
                statusLabel =
                  free === 0
                    ? `Занят (${r.users}/${r.maxUsers})`
                    : `По каталогу (${free})`;
                statusTooltip = `По каталогу: ${r.users}/${r.maxUsers} слушателей (узел не проверен)`;
              }

              const slotsText =
                check?.maxUsers !== undefined
                  ? `${check.users ?? 0}/${check.maxUsers} мест`
                  : r.maxUsers !== undefined
                    ? `${r.users ?? 0}/${r.maxUsers} мест`
                    : null;

              return (
                <div
                  role="listitem"
                  className={`catalog-row ${isCurrent ? "current" : ""}`}
                  key={r.id}
                >
                  <button
                    className="catalog-item"
                    title={`${r.name}\n${r.location || ""}\n${statusTooltip}`}
                    onClick={() => {
                      choose(r.id);
                      closeCatalog();
                    }}
                  >
                    {/* Geography top line */}
                    <div className="server-card-geo">
                      <span className="server-flag" aria-hidden="true">
                        {geo.flag}
                      </span>
                      <span className="server-country">{geo.country}</span>
                      <span className="server-city-pill" title={geo.city}>
                        · {geo.city}
                      </span>
                    </div>

                    {/* Server Title & Callsign */}
                    <div className="server-card-title">
                      {geo.callsign && (
                        <span className="server-callsign-badge">
                          {geo.callsign}
                        </span>
                      )}
                      <strong className="server-title-text">
                        {geo.shortName}
                      </strong>
                    </div>

                    {/* Specs chips row */}
                    <div className="server-specs-row">
                      <span className="server-spec-chip">
                        {geo.frequencyRangeText}
                      </span>
                      <span
                        className={`server-spec-chip ${r.directUrl ? "direct" : ""}`}
                      >
                        {r.directUrl ? "Прямой WSS" : "Шлюз"}
                      </span>
                      {r.snr !== undefined && r.snr > 0 && (
                        <span className="server-spec-chip snr">
                          SNR {r.snr} dB
                        </span>
                      )}
                      <span
                        className="server-address-text"
                        title={geo.shortAddress}
                      >
                        {geo.shortAddress}
                      </span>
                    </div>

                    {/* Status & Slots Footer */}
                    <div className="server-status-footer">
                      <div className="server-status-left" title={statusTooltip}>
                        <span
                          className={`status-led ${statusClass}`}
                          aria-hidden="true"
                        />
                        <span className={`server-status-text ${statusClass}`}>
                          {statusLabel}
                        </span>
                        {check?.responseMs !== undefined && (
                          <span className="server-latency">
                            {check.responseMs} мс
                          </span>
                        )}
                      </div>
                      {slotsText && (
                        <span className="server-slots-badge">{slotsText}</span>
                      )}
                    </div>
                  </button>

                  <button
                    className="star"
                    aria-label={`В избранное: ${r.name}`}
                    aria-pressed={isFavorite}
                    onClick={() => favorite(r.id)}
                  >
                    {isFavorite ? "★" : "☆"}
                  </button>
                </div>
              );
            })}

          {open && visibleCount < sortedRows.length && (
            <div className="catalog-more-wrapper">
              <button
                className="catalog-more"
                onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
              >
                Показать ещё · {sortedRows.length - visibleCount} серверов
              </button>
            </div>
          )}

          {open && sortedRows.length === 0 && (
            <div className="explorer-empty">
              <div className="explorer-empty-icon" aria-hidden="true">
                📡
              </div>
              <p>Ничего не найдено по заданным фильтрам.</p>
              <button
                className="catalog-more"
                onClick={handleResetFilters}
              >
                Сбросить фильтры
              </button>
            </div>
          )}
        </div>
      </dialog>
    </div>
  );
});
