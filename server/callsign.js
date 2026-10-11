import { XMLParser, XMLValidator } from "fast-xml-parser";
import { lookupInSources } from "./callsign-sources.js";

const unavailable = () =>
  Object.assign(new Error("Сервис поиска временно недоступен."), {
    status: 503,
  });
const text = (v) =>
  typeof v === "string" && !["NOT_FOUND", "undefined", "null"].includes(v)
    ? v.trim().slice(0, 240)
    : undefined;
export function normalizeCallsign(value) {
  const call = String(value).trim().toUpperCase();
  if (
    call.length > 24 ||
    !/^[A-Z0-9]{2,12}(?:\/[A-Z0-9]{1,12}){0,2}$/.test(call) ||
    !/[A-Z]/.test(call) ||
    !/\d/.test(call)
  )
    throw Object.assign(
      new Error("Введите корректный радиолюбительский позывной."),
      { status: 400 },
    );
  return call;
}
const countries = new Map();
const names = new Intl.DisplayNames(["en"], { type: "region" });
for (let a = 65; a <= 90; a++)
  for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b),
      name = names.of(code);
    if (name && name !== code) countries.set(name.toLowerCase(), code);
  }
countries.set("united states of america", "US");
countries.set("usa", "US");
countries.set("czech republic", "CZ");
function coordinates(record) {
  // QRZ may supply only a country/state centroid; do not treat it as a station QTH.
  if (["dxcc", "state", "none"].includes(record.geoloc)) return undefined;
  if (!text(record.lat) || !text(record.lon)) return undefined;
  const lat = Number(record.lat),
    lon = Number(record.lon);
  return Number.isFinite(lat) &&
    Math.abs(lat) <= 90 &&
    Number.isFinite(lon) &&
    Math.abs(lon) <= 180
    ? { lat, lon }
    : undefined;
}
export function distanceBearing(origin, target) {
  const rad = Math.PI / 180,
    a = origin.lat * rad,
    b = target.lat * rad,
    dlat = b - a,
    dlon = (target.lon - origin.lon) * rad;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a) * Math.cos(b) * Math.sin(dlon / 2) ** 2;
  const distanceKm =
    6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
  const azimuth =
    (Math.atan2(
      Math.sin(dlon) * Math.cos(b),
      Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(dlon),
    ) /
      rad +
      360) %
    360;
  return {
    distanceKm: Math.round(distanceKm),
    ...(distanceKm > 0.001 ? { azimuth: Math.round(azimuth) % 360 } : {}),
  };
}
export class CallsignLookup {
  constructor({
    env = process.env,
    fetcher = fetch,
    now = Date.now,
    timeoutMs = 8000,
    onDiagnostic = () => {},
  } = {}) {
    this.onDiagnostic = onDiagnostic;
    this.token = undefined;
    this.tokenUntil = 0;
    this.hamLogin = undefined;
    this.hamRetryAt = 0;
    this.env = env;
    this.fetcher = fetcher;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.cache = new Map();
    this.pending = new Map();
    this.clients = new Map();
    this.key = undefined;
    this.login = undefined;
    this.retryAt = 0;
  }
  get provider() {
    return `${Boolean(this.env.QRZ_USERNAME && this.env.QRZ_PASSWORD)}:${Boolean(this.env.HAMQTH_USERNAME && this.env.HAMQTH_PASSWORD)}:${this.env.CALLOOK_ENABLED !== "0"}:${this.env.HAMDB_ENABLED !== "0"}`;
  }
  limit(client) {
    const now = this.now();
    for (const [id, entry] of this.clients)
      if (now >= entry.until) this.clients.delete(id);
    let entry = this.clients.get(client);
    if (!entry) {
      if (this.clients.size >= 4096)
        throw Object.assign(
          new Error("Поиск занят. Попробуйте через минуту."),
          { status: 429, retryAfter: 60 },
        );
      entry = { count: 0, until: now + 60000 };
      this.clients.set(client, entry);
    }
    if (++entry.count > 10)
      throw Object.assign(
        new Error("Слишком много запросов. Попробуйте через минуту."),
        { status: 429, retryAfter: Math.ceil((entry.until - now) / 1000) },
      );
  }
  async request(url, body, signal, headers = {}) {
    const response = await this.fetcher(url, {
      signal,
      redirect: "error",
      headers,
      ...(body
        ? {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              ...headers,
            },
            body:
              headers["Content-Type"] === "application/json"
                ? JSON.stringify(body)
                : new URLSearchParams(body).toString(),
          }
        : {}),
    });
    if (!response.ok)
      throw Object.assign(unavailable(), { upstreamStatus: response.status });
    // Bound parsing work and memory, including streamed/chunked responses.
    const reader = response.body.getReader(),
      chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 128 * 1024) {
          await reader.cancel();
          throw unavailable();
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  async xml(parameters, signal) {
    const raw = await this.request(
      "https://xmldata.qrz.com/xml/current/",
      parameters,
      signal,
    );
    if (/<!DOCTYPE|<!ENTITY/i.test(raw) || XMLValidator.validate(raw) !== true)
      throw unavailable();
    const data = new XMLParser({
      parseTagValue: false,
      ignoreAttributes: true,
      removeNSPrefix: true,
    }).parse(raw)?.QRZDatabase;
    if (!data || typeof data !== "object") throw unavailable();
    return data;
  }
  notice(value) {
    let message = text(value);
    if (!message) return undefined;
    for (const secret of [
      this.env.QRZ_USERNAME,
      this.env.QRZ_PASSWORD,
      this.key,
    ])
      if (secret) message = message.replaceAll(secret, "[скрыто]");
    return message;
  }
  async session(signal) {
    if (this.key) return this.key;
    if (this.now() < this.retryAt) throw unavailable();
    if (!this.login) {
      this.login = (async () => {
        const data = await this.xml(
          {
            username: this.env.QRZ_USERNAME,
            password: this.env.QRZ_PASSWORD,
            agent: "UR4MTN-WebSDR-1",
          },
          signal,
        );
        const key = text(data.Session?.Key);
        if (!key || data.Session?.Error) {
          this.retryAt =
            this.now() +
            (/connection refused/i.test(data.Session?.Error || "")
              ? 86400000
              : 30000);
          throw Object.assign(unavailable(), {
            upstreamStatus: 200,
            lookupType: /subscription|subscriber|XML access/i.test(
              String(data.Session?.Error || ""),
            )
              ? "subscription_restricted"
              : "authorization_error",
          });
        }
        return (this.key = key);
      })().finally(() => {
        this.login = undefined;
      });
    }
    return this.login;
  }
  async qrz(call, signal) {
    if (!this.env.QRZ_USERNAME || !this.env.QRZ_PASSWORD) {
      this.onDiagnostic({
        callsign: call,
        source: "QRZ",
        httpStatus: null,
        type: "credentials_missing",
        refreshed: false,
        fields: [],
      });
      throw unavailable();
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      let key;
      try {
        key = await this.session(signal);
      } catch (error) {
        this.onDiagnostic({
          callsign: call,
          source: "QRZ",
          httpStatus: error.upstreamStatus || null,
          type: error.lookupType || "unavailable",
          refreshed: Boolean(attempt),
          fields: [],
        });
        throw error;
      }
      let data;
      try {
        data = await this.xml({ s: key, callsign: call }, signal);
      } catch (error) {
        this.onDiagnostic({
          callsign: call,
          source: "QRZ",
          httpStatus: error.upstreamStatus || null,
          type: "unavailable",
          refreshed: Boolean(attempt),
          fields: [],
        });
        throw error;
      }
      const session = data.Session || {},
        nextKey = text(session.Key);
      const error = String(session.Error || ""),
        message = String(session.Message || "");
      const restricted =
        /subscription|subscriber|subscribe|XML access|not authorized|password|login|denied/i.test(
          error + " " + message,
        );
      const expired =
        /session|timeout/i.test(error) || (!nextKey && !restricted);
      const missing = !restricted && !expired && /not found/i.test(error);
      const type = restricted
        ? "access_restricted"
        : expired
          ? "session_expired"
          : missing
            ? "not_found"
            : error || !text(data.Callsign?.call)
              ? "unavailable"
              : "found";
      this.onDiagnostic({
        callsign: call,
        source: "QRZ",
        httpStatus: 200,
        type,
        refreshed: Boolean(attempt),
        fields: Object.keys(data.Callsign || {}),
      });
      if (expired) {
        if (this.key === key) this.key = undefined;
        if (!attempt) continue;
        throw unavailable();
      }
      if (nextKey) this.key = nextKey;
      if (missing) return { status: "not_found", source: "QRZ" };
      if (type !== "found") throw unavailable();
      return this.record(data.Callsign, "QRZ");
    }
    throw unavailable();
  }
  record(r, source) {
    const country = text(r.country),
      name =
        text(r.name_fmt) ||
        [text(r.fname), text(r.mi), text(r.name)].filter(Boolean).join(" ") ||
        undefined;
    return {
      status: "found",
      source,
      callsign: text(r.call),
      name,
      country,
      city: text(r.addr2),
      region: text(r.state),
      qth: text(r.addr1),
      grid: text(r.grid),
      countryCode: countries.get(country?.toLowerCase()),
      coordinates: coordinates(r),
    };
  }
  async hamSession(signal) {
    if (this.token && this.tokenUntil > this.now()) return this.token;
    if (this.now() < this.hamRetryAt) throw unavailable();
    if (!this.hamLogin) {
      this.hamLogin = (async () => {
        try {
          const data = JSON.parse(
            await this.request(
              "https://www.hamqth.com/api/v2/login",
              {
                callsign: this.env.HAMQTH_USERNAME.trim().toUpperCase(),
                password: this.env.HAMQTH_PASSWORD,
              },
              signal,
              { "Content-Type": "application/json" },
            ),
          );
          if (
            !text(data.token) ||
            !Number.isFinite(data.expiresIn) ||
            data.expiresIn <= 0
          )
            throw Object.assign(unavailable(), {
              upstreamStatus: 200,
              diagnosticType: "invalid_session_response",
            });
          this.token = data.token;
          this.tokenUntil =
            this.now() + Math.max(0, data.expiresIn - 30) * 1000;
          return this.token;
        } catch (error) {
          this.hamDiagnostic("login", error);
          this.hamRetryAt = this.now() + 30000;
          throw error;
        }
      })().finally(() => {
        this.hamLogin = undefined;
      });
    }
    return this.hamLogin;
  }
  hamDiagnostic(phase, error) {
    const status = error.upstreamStatus || null;
    const code = String(error.cause?.code || "");
    this.onDiagnostic({
      source: "HamQTH",
      phase,
      ...(phase === "login"
        ? {
            credentialFormat: {
              usernameNeedsTrim:
                this.env.HAMQTH_USERNAME !== this.env.HAMQTH_USERNAME?.trim(),
              usernameMatchesExpected:
                this.env.HAMQTH_USERNAME?.trim().toUpperCase() === "UR4MTN",
              passwordHasLineBreak: /[\r\n]/.test(
                this.env.HAMQTH_PASSWORD || "",
              ),
              passwordHasOuterQuotes: /^(["']).*\1$/s.test(
                this.env.HAMQTH_PASSWORD || "",
              ),
            },
          }
        : {}),
      httpStatus: status,
      type:
        error.diagnosticType ||
        (status === 401
          ? "authorization_error"
          : status === 429
            ? "rate_limited"
            : status
              ? "http_error"
              : error.cause?.message === "unexpected redirect"
                ? "redirect_response"
                : "transport_error"),
      ...(/^[A-Z_]{2,40}$/.test(code) ? { code } : {}),
    });
  }
  async hamqth(call, signal) {
    if (!this.env.HAMQTH_USERNAME || !this.env.HAMQTH_PASSWORD)
      throw unavailable();
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.hamSession(signal);
      let r;
      try {
        r = JSON.parse(
          await this.request(
            `https://www.hamqth.com/api/v2/callbook/${encodeURIComponent(call)}?app=UR4MTN-WebSDR`,
            undefined,
            signal,
            { Authorization: `Bearer ${token}` },
          ),
        );
      } catch (error) {
        this.hamDiagnostic("lookup", error);
        if (error.upstreamStatus === 401) {
          if (this.token === token) this.token = undefined;
          if (!attempt) continue;
        }
        if (error.upstreamStatus === 404)
          return { status: "not_found", source: "HamQTH" };
        throw error;
      }
      if (!text(r.callsign)) throw unavailable();
      return this.record(
        {
          call: r.callsign,
          name_fmt: r.name || r.address?.name || r.nick,
          country: r.country,
          addr2: r.address?.city,
          addr1: r.qth,
          state: r.region?.usState || r.region?.oblast || r.region?.district,
          grid: r.location?.grid,
          lat:
            typeof r.location?.lat === "number"
              ? String(r.location.lat)
              : undefined,
          lon:
            typeof r.location?.lon === "number"
              ? String(r.location.lon)
              : undefined,
        },
        "HamQTH",
      );
    }
    throw unavailable();
  }
  async callook(call, signal) {
    const data = JSON.parse(
      await this.request(
        `https://callook.info/${encodeURIComponent(call)}/json`,
        undefined,
        signal,
      ),
    );
    if (data.status === "INVALID")
      return { status: "not_found", source: "Callook" };
    if (data.status !== "VALID" || !text(data.current?.callsign))
      throw unavailable();
    if (text(data.current.callsign).toUpperCase() !== call)
      return {
        status: "conflict",
        source: "Callook",
        message:
          "Источник вернул другой текущий позывной. Владелец автоматически не выбран.",
        records: [
          {
            source: "Callook",
            callsign: text(data.current.callsign),
            name: text(data.name),
            country: "United States",
          },
        ],
      };
    return {
      ...this.record(
        {
          call: data.current.callsign,
          name_fmt: data.name,
          country: "United States",
          addr2: data.address?.line2,
          addr1: data.address?.line1,
          grid: data.location?.gridsquare,
        },
        "Callook",
      ),
      // Callook geocodes mailing addresses. They are not verified station positions.
      notice: text(data.location?.gridsquare)
        ? "Locator рассчитан источником по почтовому адресу; место работы в эфире может отличаться."
        : undefined,
      sourceUpdatedAt: text(data.otherInfo?.lastActionDate),
    };
  }
  async hamdb(call, signal) {
    const data = JSON.parse(
      await this.request(
        `https://api.hamdb.org/v1/${encodeURIComponent(call)}/json/ur4mtn-websdr`,
        undefined,
        signal,
      ),
    )?.hamdb;
    if (data?.messages?.status === "NOT_FOUND")
      return { status: "not_found", source: "HamDB" };
    if (data?.messages?.status !== "OK" || !text(data.callsign?.call))
      throw unavailable();
    if (text(data.callsign.call).toUpperCase() !== call)
      return {
        status: "conflict",
        source: "HamDB",
        message:
          "Источник вернул другой позывной. Владелец автоматически не выбран.",
      };
    // This database does not establish that its coordinates are the station QTH.
    const { lat, lon, ...record } = data.callsign;
    return this.record(record, "HamDB");
  }
  async sources(call) {
    return lookupInSources(
      call,
      [
        {
          id: "QRZ",
          scope: "global",
          lookup: (call, signal) => this.qrz(call, signal),
        },
        {
          id: "Callook",
          timeoutMs: Math.min(3000, this.timeoutMs),
          scope: "US",
          enabled: this.env.CALLOOK_ENABLED !== "0",
          lookup: (call, signal) => this.callook(call, signal),
        },
        {
          id: "HamDB",
          scope: "AU/CA/CZ/DE/US",
          timeoutMs: Math.min(3000, this.timeoutMs),
          enabled: this.env.HAMDB_ENABLED !== "0",
          lookup: (call, signal) => this.hamdb(call, signal),
        },
        {
          id: "HamQTH",
          scope: "global",
          lookup: (call, signal) => this.hamqth(call, signal),
        },
      ],
      { timeoutMs: this.timeoutMs, now: this.now },
    );
  }
  async cached(call) {
    const id = `${this.provider}:${call}`,
      cached = this.cache.get(id);
    if (cached && cached.until > this.now()) return cached.value;
    if (this.pending.has(id)) return this.pending.get(id);
    if (this.pending.size >= 16) throw unavailable();
    const operation = this.sources(call)
      .then((value) => {
        if (this.cache.size >= 200)
          this.cache.delete(this.cache.keys().next().value);
        this.cache.set(id, {
          value,
          until: this.now() + (value.status === "not_found" ? 60000 : 300000),
        });
        return value;
      })
      .catch((error) => {
        throw error.status ? error : unavailable();
      })
      .finally(() => {
        this.pending.delete(id);
      });
    this.pending.set(id, operation);
    return operation;
  }
  async lookup(value, client) {
    this.limit(client);
    const call = normalizeCallsign(value),
      result = await this.cached(call);
    if (result.status !== "found" || !result.coordinates) return result;
    // Obtain the origin from a real record, never from a callsign prefix.
    let timer;
    const origin =
      call === "UR4MTN"
        ? result
        : await Promise.race([
            this.cached("UR4MTN").catch(() => undefined),
            new Promise((resolve) => {
              timer = setTimeout(() => resolve(undefined), 750);
            }),
          ]);
    clearTimeout(timer);
    return origin?.coordinates
      ? {
          ...result,
          ...distanceBearing(origin.coordinates, result.coordinates),
        }
      : result;
  }
}
export function registerCallsignRoute(
  app,
  lookup = new CallsignLookup({
    onDiagnostic: ({ source, phase, httpStatus, type, code }) => {
      if (source === "HamQTH")
        console.warn(
          "Callsign diagnostic",
          JSON.stringify({ source, phase, httpStatus, type, code }),
        );
    },
  }),
) {
  app.get("/api/callsign/:callsign", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const client = process.env.VERCEL
      ? String(
          req.headers["x-vercel-forwarded-for"] ||
            req.socket.remoteAddress ||
            "unknown",
        )
          .split(",")[0]
          .trim()
      : req.socket.remoteAddress || "unknown";
    try {
      const result = await lookup.lookup(req.params.callsign, client);
      res
        .status(
          result.status === "conflict"
            ? 409
            : result.status === "not_found"
              ? 404
              : 200,
        )
        .json(result);
    } catch (error) {
      if (error.retryAfter) res.setHeader("Retry-After", error.retryAfter);
      res.status(error.status || 503).json({
        status: "unavailable",
        message: error.status ? error.message : unavailable().message,
        ...(error.notice ? { notice: error.notice } : {}),
      });
    }
  });
}
