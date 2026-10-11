import { memo, useEffect, useRef, useState } from "react";
import { gateway } from "./gateway";
type Result = {
  status: "found" | "not_found" | "unavailable";
  source?: "HamDB" | "QRZ";
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
};
export const CallsignSearch = memo(function CallsignSearch() {
  const [query, setQuery] = useState(""),
    [result, setResult] = useState<Result>(),
    [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function search() {
    const callsign = query.trim().toUpperCase();
    setQuery(callsign);
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
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(
        `${gateway.http}/api/callsign/${encodeURIComponent(callsign)}`,
        { signal: controller.signal },
      );
      const data: Result = await response.json();
      if (!["found", "not_found", "unavailable"].includes(data.status))
        throw Error("Invalid response");
      if (request.current === controller) setResult(data);
    } catch {
      if (request.current === controller)
        setResult({
          status: "unavailable",
          message: "Поиск временно недоступен. Попробуйте позже.",
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
    <section
      className="callsign-search panel"
      aria-labelledby="callsign-heading"
    >
      <h2 id="callsign-heading">Поиск позывного</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
        aria-busy={loading}
      >
        <input
          aria-label="Позывной для поиска"
          placeholder="Введите позывной, например UR4MTN"
          value={query}
          maxLength={24}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          onBlur={() => setQuery((v) => v.trim())}
        />
        <button type="submit" disabled={loading}>
          Найти
        </button>
      </form>
      <div className="callsign-progress" role="status" aria-live="polite">
        {loading && (
          <>
            <i aria-hidden="true" /> Ищем позывной…
          </>
        )}
      </div>
      {result && (
        <div
          className={`callsign-result ${result.status === "unavailable" ? "callsign-error" : ""}`}
          key={`${result.status}-${result.callsign || query}`}
          role={result.status === "unavailable" ? "alert" : "status"}
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
                        [result.city, result.region].filter(Boolean).join(", "),
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
                    : result.message ||
                      "Поиск временно недоступен. Попробуйте позже."}
                </p>
              )}
              {result.notice && <small>{result.notice}</small>}
              {result.source && (
                <small className="callsign-source">
                  Источник:{" "}
                  {result.source === "QRZ" ? "QRZ.com XML API" : "HamDB.org"}
                </small>
              )}
            </article>
          </div>
        </div>
      )}
      <small className="callsign-coverage">
        {result?.source === "QRZ"
          ? "Данные QRZ XML API."
          : "Открытый справочник: США, Канада, Австралия, Германия и Чехия."}{" "}
        Страна указана по записи справочника, а не по текущему месту выхода в
        эфир.
      </small>
    </section>
  );
});
