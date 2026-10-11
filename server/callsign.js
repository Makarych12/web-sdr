import { XMLParser, XMLValidator } from "fast-xml-parser";

const unavailable = () =>
  Object.assign(new Error("Поиск временно недоступен. Попробуйте позже."), {
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
    timeoutMs = 10000,
  } = {}) {
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
    return this.env.QRZ_USERNAME && this.env.QRZ_PASSWORD ? "QRZ" : "HamDB";
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
  async request(url, body, signal) {
    const response = await this.fetcher(url, {
      signal,
      redirect: "error",
      ...(body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams(body).toString(),
          }
        : {}),
    });
    if (!response.ok) throw unavailable();
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
            notice: this.notice(data.Session?.Error || data.Session?.Message),
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
    for (let attempt = 0; attempt < 2; attempt++) {
      const key = await this.session(signal);
      const data = await this.xml({ s: key, callsign: call }, signal),
        session = data.Session || {};
      const nextKey = text(session.Key);
      if (nextKey) this.key = nextKey;
      else if (this.key === key) this.key = undefined;
      if (/not found/i.test(session.Error || ""))
        return {
          status: "not_found",
          source: "QRZ",
          notice: this.notice(session.Message),
        };
      if (!nextKey || /session|timeout/i.test(session.Error || "")) {
        if (this.key === key) this.key = undefined;
        if (!attempt) continue;
      }
      if (session.Error || !nextKey || !text(data.Callsign?.call))
        throw Object.assign(unavailable(), {
          notice: this.notice(session.Error || session.Message),
        });
      return {
        ...this.record(data.Callsign, "QRZ"),
        notice: this.notice(session.Message),
      };
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
  async hamdb(call, signal) {
    const raw = await this.request(
      `https://api.hamdb.org/v1/${encodeURIComponent(call)}/json/ur4mtn-websdr`,
      undefined,
      signal,
    );
    const data = JSON.parse(raw)?.hamdb;
    if (data?.messages?.status === "NOT_FOUND")
      return { status: "not_found", source: "HamDB" };
    if (data?.messages?.status !== "OK" || !text(data?.callsign?.call))
      throw unavailable();
    return this.record(data.callsign, "HamDB");
  }
  async cached(call) {
    const id = `${this.provider}:${call}`,
      cached = this.cache.get(id);
    if (cached && cached.until > this.now()) return cached.value;
    if (this.pending.has(id)) return this.pending.get(id);
    if (this.pending.size >= 16) throw unavailable();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const operation = (
      this.provider === "QRZ"
        ? this.qrz(call, controller.signal)
        : this.hamdb(call, controller.signal)
    )
      .then((value) => {
        if (this.cache.size >= 200)
          this.cache.delete(this.cache.keys().next().value);
        this.cache.set(id, {
          value,
          until: this.now() + (value.status === "found" ? 300000 : 60000),
        });
        return value;
      })
      .catch((error) => {
        throw error.status ? error : unavailable();
      })
      .finally(() => {
        clearTimeout(timer);
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
export function registerCallsignRoute(app, lookup = new CallsignLookup()) {
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
      res.status(result.status === "not_found" ? 404 : 200).json(result);
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
