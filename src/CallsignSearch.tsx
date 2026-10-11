import { memo, useEffect, useRef, useState } from "react";
import { gateway } from "./gateway";
type Result = {
  status: "found" | "not_found" | "unavailable" | "conflict";
  source?: "HamQTH" | "QRZ" | "Callook" | "HamDB";
  callsign?: string;
  name?: string;
  country?: string;
  countryCode?: string;
  city?: string;
  region?: string;
  qth?: string;
  grid?: string;
  distanceKm?: number;
  azimuth?: number;
  message?: string;
  notice?: string;
  retrievedAt?: string;
  records?: {
    source: string;
    callsign?: string;
    name?: string;
    country?: string;
  }[];
};
export const CallsignSearch = memo(function CallsignSearch() {
  const [query, setQuery] = useState(""),
    [result, setResult] = useState<Result>(),
    [loading, setLoading] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const panel = popover.current;
    if (!panel || !open) return;
    const position = () => {
      const box = anchor.current?.getBoundingClientRect();
      const tuner = anchor.current?.closest(".tuner")?.getBoundingClientRect();
      if (!box || !tuner) return;
      panel.style.left = `${Math.max(8, Math.min(box.left, innerWidth - Math.min(320, innerWidth - 16) - 8))}px`;
      panel.style.maxHeight = `${Math.max(0, innerHeight - tuner.bottom - 14)}px`;
      panel.style.top = `${Math.max(8, tuner.bottom + 6)}px`;
    };
    panel.showPopover();
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      panel.hidePopover();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, loading, result]);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function search() {
    const callsign = query.trim().toUpperCase();
    setQuery(callsign);
    const tuner = anchor.current?.closest(".tuner");
    if (tuner && tuner.getBoundingClientRect().bottom > innerHeight - 180)
      tuner.scrollIntoView({ block: "start" });
    setOpen(true);
    setResult(undefined);
    if (!callsign) {
      setResult({
        status: "unavailable",
        message: "Введите позывной для поиска.",
      });
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(
        `${gateway.http}/api/callsign/${encodeURIComponent(callsign)}`,
        { signal: controller.signal },
      );
      const data: Result = await response.json();
      if (
        !["found", "not_found", "unavailable", "conflict"].includes(data.status)
      )
        throw Error("Invalid response");
      if (request.current === controller) setResult(data);
    } catch {
      if (request.current === controller)
        setResult({
          status: "unavailable",
          message: "Сервис поиска временно недоступен.",
        });
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        setLoading(false);
        request.current = null;
      }
    }
  }
  const flag = /^[A-Z]{2}$/.test(result?.countryCode || "")
    ? String.fromCodePoint(
        ...[...result!.countryCode!].map((c) => c.charCodeAt(0) + 127397),
      )
    : undefined;
  return (
    <div className="callsign-search" ref={anchor}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
        aria-busy={loading}
      >
        <input
          aria-label="Позывной для поиска"
          placeholder="Введите позывной"
          value={query}
          maxLength={24}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          onBlur={() => setQuery((v) => v.trim())}
        />
        <button
          type="submit"
          disabled={loading}
          aria-label="Поиск позывного"
          aria-expanded={open}
          aria-controls="callsign-popover"
        >
          Найти
        </button>
      </form>
      <div
        id="callsign-popover"
        ref={popover}
        popover="auto"
        className="callsign-popover"
        onToggle={(event) => setOpen(event.newState === "open")}
        aria-label="Результат поиска позывного"
      >
        <div className="callsign-progress" role="status" aria-live="polite">
          {loading && (
            <>
              <i aria-hidden="true" /> Ищем позывной…
            </>
          )}
        </div>
        {result && (
          <div
            className={`callsign-result ${["unavailable", "conflict"].includes(result.status) ? "callsign-error" : ""}`}
            key={`${result.status}-${result.callsign || query}`}
            role={
              ["unavailable", "conflict"].includes(result.status)
                ? "alert"
                : "status"
            }
          >
            <div>
              <article>
                {result.status === "found" ? (
                  <>
                    <div className="callsign-title">
                      {flag && (
                        <span
                          className="callsign-flag"
                          role="img"
                          aria-label={`Флаг: ${result.country}`}
                        >
                          {flag}
                        </span>
                      )}
                      <strong>{result.callsign}</strong>
                    </div>
                    {result.name && (
                      <p className="callsign-name">{result.name}</p>
                    )}
                    <dl>
                      {[
                        ["Страна", result.country],
                        [
                          "Город / регион",
                          [result.city, result.region]
                            .filter(Boolean)
                            .join(", "),
                        ],
                        ["QTH", result.qth],
                        ["Locator", result.grid],
                        [
                          "От UR4MTN",
                          result.distanceKm !== undefined
                            ? `${result.distanceKm.toLocaleString("ru-RU")} км${result.azimuth !== undefined ? ` · ${result.azimuth}°` : ""}`
                            : undefined,
                        ],
                      ]
                        .filter(([, value]) => value)
                        .map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                    </dl>
                  </>
                ) : (
                  <p>
                    {result.status === "not_found"
                      ? "Позывной не найден в справочнике"
                      : result.message || "Сервис поиска временно недоступен."}
                  </p>
                )}
                {result.records?.map((record, index) => (
                  <small key={index}>
                    {record.source}:{" "}
                    {[record.callsign, record.name, record.country]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                ))}
                {result.notice && <small>{result.notice}</small>}
                {result.source && (
                  <small className="callsign-source">
                    Источник:{" "}
                    {result.source === "QRZ" ? (
                      "QRZ.com XML API"
                    ) : result.source === "Callook" ? (
                      <a
                        href="https://callook.info/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Callook.info
                      </a>
                    ) : result.source === "HamDB" ? (
                      <a
                        href="https://hamdb.org/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        HamDB.org
                      </a>
                    ) : (
                      <>
                        <a
                          href="https://www.hamqth.com/"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          HamQTH.com
                        </a>
                        .{" "}
                        <a
                          href="https://www.hamqth.com/register.php"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Зарегистрируйтесь
                        </a>{" "}
                        и поддерживайте профиль актуальным.
                      </>
                    )}
                    {result.retrievedAt &&
                      Number.isFinite(Date.parse(result.retrievedAt)) && (
                        <>
                          {" "}
                          · Получено{" "}
                          {new Date(result.retrievedAt).toLocaleString("ru-RU")}
                        </>
                      )}
                  </small>
                )}
              </article>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
