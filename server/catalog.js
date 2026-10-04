import JSON5 from "json5";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
export const CATALOG_SOURCE = "http://rx.linkfanel.net/kiwisdr_com.js";
const CACHE = new URL("../.cache/catalog.json", import.meta.url);
// Only public addresses may be reached, including when a catalog host resolves again.
export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    if (a.startsWith("::ffff:")) return isPublicAddress(a.slice(7));
    return a !== "::1" && a !== "::" && !/^(fc|fd|fe[89ab]|ff)/.test(a);
  }
  return false;
}
export function safeReceiverUrl(value) {
  try {
    const u = new URL(value);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/"
    )
      return null;
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      (isIP(host) && !isPublicAddress(host))
    )
      return null;
    return u.origin;
  } catch {
    return null;
  }
}
export async function publicLookup(hostname, options, callback) {
  try {
    const result = await lookup(hostname, { all: true });
    if (!result.length || result.some((r) => !isPublicAddress(r.address)))
      throw Error("Приёмник указал непубличный сетевой адрес");
    if (options?.all) callback(null, result);
    else callback(null, result[0].address, result[0].family);
  } catch (e) {
    callback(e);
  }
}
export function parseCatalog(text) {
  const m = text.match(/\bvar\s+kiwisdr_com\s*=\s*([\s\S]*?);?\s*$/);
  if (!m) throw Error("Неверный формат каталога");
  const rows = JSON5.parse(m[1].replace(/;\s*$/, ""));
  if (!Array.isArray(rows) || rows.length < 1) throw Error("Пустой каталог");
  const result = [];
  for (const r of rows) {
    const url = safeReceiverUrl(r.url);
    if (!url || r.offline === "yes" || r.status !== "active") continue;
    const [min, max] = (r.bands || "0-30000000").split("-").map(Number);
    result.push({
      id:
        "kiwi-" +
        (String(r.id || "") ||
          createHash("sha256").update(url).digest("hex").slice(0, 16)),
      url,
      name: String(r.name || r.loc || url).slice(0, 250),
      location: String(r.loc || "").slice(0, 150),
      users: Number(r.users) || 0,
      maxUsers: Number(r.users_max) || 0,
      snr: Number(String(r.snr || "").split(",")[0]) || null,
      minFrequency: Number.isFinite(min) ? min / 1000 : 0,
      maxFrequency: Number.isFinite(max) ? max / 1000 : 30000,
      updatedAt: r.updated || null,
      apiAvailable: Number(r.ext_api) > 0,
    });
  }
  return result;
}
export class ReceiverCatalog {
  constructor(configured) {
    this.configured = configured
      .map((r) => ({ ...r, url: safeReceiverUrl(r.url) }))
      .filter((r) => r.url);
    this.receivers = [...this.configured];
    this.updatedAt = null;
    this.stale = true;
    this.refreshing = null;
  }
  merge(rows) {
    const byUrl = new Map(rows.map((r) => [r.url, r]));
    const pinned = this.configured.map((r) => ({ ...byUrl.get(r.url), ...r }));
    const pinnedUrls = new Set(pinned.map((r) => r.url));
    this.receivers = [...pinned, ...rows.filter((r) => !pinnedUrls.has(r.url))];
  }
  async initialize() {
    try {
      const cached = JSON.parse(await readFile(CACHE, "utf8"));
      if (Array.isArray(cached.receivers)) {
        this.merge(cached.receivers.filter((r) => safeReceiverUrl(r.url)));
        this.updatedAt = cached.updatedAt;
      }
    } catch {}
    await this.refresh();
  }
  refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const res = await fetch(CATALOG_SOURCE, {
          signal: AbortSignal.timeout(12000),
        });
        if (!res.ok) throw Error("Каталог недоступен");
        const rows = parseCatalog(await res.text());
        this.merge(rows);
        this.updatedAt = new Date().toISOString();
        this.stale = false;
        await mkdir(new URL("../.cache/", import.meta.url), {
          recursive: true,
        });
        await writeFile(
          CACHE,
          JSON.stringify({ updatedAt: this.updatedAt, receivers: rows }),
        );
      } catch (e) {
        this.stale = true;
        console.warn("Kiwi catalog:", e.message);
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }
  list() {
    return this.receivers.map(({ url, ...r }) => r);
  }
  find(id) {
    return this.receivers.find((r) => r.id === id);
  }
}
