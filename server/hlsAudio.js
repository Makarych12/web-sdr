import { createHash, randomUUID } from "node:crypto";
import { getCache, waitUntil } from "@vercel/functions";
import { KiwiSession } from "./kiwi.js";
import { audioTune } from "./nativeAudio.js";
import { HlsEncoder, trimHlsSegment } from "./hlsEncoder.js";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TTL = 120;
const SESSION = /^[a-f0-9-]{36}$/i;

export function hlsPlaylist(index, id, ended = false) {
  const segments = index?.segments || [];
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:3",
    "#EXT-X-START:TIME-OFFSET=-12,PRECISE=NO",
    `#EXT-X-MEDIA-SEQUENCE:${segments[0]?.sequence ?? 0}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${index?.discontinuities ?? 0}`,
  ];
  for (const s of segments) {
    if (s.discontinuity) lines.push("#EXT-X-DISCONTINUITY");
    lines.push(
      `#EXTINF:${s.duration.toFixed(6)},`,
      `/api/hls/segment.ts?session=${id}&generation=${s.generation}&sequence=${s.sequence}`,
    );
  }
  if (ended) lines.push("#EXT-X-ENDLIST");
  return lines.join("\n") + "\n";
}

export function installHlsAudio(
  app,
  catalog,
  catalogReady,
  {
    Session = KiwiSession,
    Encoder = HlsEncoder,
    cache = getCache({
      namespace: "ur4mtn-hls-v1",
      keyHashFunction: (key) => createHash("sha256").update(key).digest("hex"),
    }),
    keepAlive = waitUntil,
    workerMs = Number(process.env.HLS_WORKER_MS) || 180000,
    listenerMs = 30000,
    segmentSeconds = 2,
    startupMs = 18000,
  } = {},
) {
  const starting = new Map();
  const key = (id, name) => `${id}:${name}`;
  const put = (id, name, value) =>
    cache.set(key(id, name), value, {
      ttl:
        name === "control" || name === "stopped"
          ? 7200
          : name === "worker"
            ? Math.ceil(workerMs / 1000) + 30
            : TTL,
    });
  const read = (id, name) => cache.get(key(id, name));
  const log = (event, detail = {}) =>
    console.info(JSON.stringify({ event, ...detail }));

  async function produce(id, tune, generation, previous = null) {
    let index = (await read(id, "index")) || {
      segments: [],
      discontinuities: 0,
    };
    let sequence = (index.segments.at(-1)?.sequence ?? -1) + 1;
    let timestamp = index.segments.at(-1)?.end ?? 0;
    let first = true,
      stopped = false,
      session,
      polling;
    let active = !previous;
    const pending = [];
    const deadline = Date.now() + workerMs;
    let writes = Promise.resolve(),
      finish = () => {};
    const stop = () => {
      stopped = true;
      session?.close();
      clearInterval(polling);
      finish();
    };
    async function publish(bytes, duration, capturedAt) {
      if (!active) {
        if (stopped) return;
        pending.push({ bytes, duration, capturedAt });
        if (pending.length < 3) return;
        const [owner, candidate] = await Promise.all([
          read(id, "worker"),
          read(id, "candidate"),
        ]);
        if (
          owner?.generation !== previous ||
          candidate?.generation !== generation
        ) {
          stop();
          return;
        }
        // Prewarm the next Kiwi/AAC session while the current producer still
        // supplies audio. The media player sees one stable playlist URL.
        index = (await read(id, "index")) || index;
        sequence = (index.segments.at(-1)?.sequence ?? -1) + 1;
        timestamp = index.segments.at(-1)?.end ?? 0;
        await put(id, "worker", { generation, until: deadline + 5000 });
        await put(id, "candidate", { generation, until: 0 });
        active = true;
        const tail = index.segments.at(-1);
        const cutoff = tail?.capturedAt + (tail?.duration || 0) * 1000;
        for (const item of pending.splice(0)) {
          if (Number.isFinite(cutoff) && Number.isFinite(item.capturedAt)) {
            const overlap = Math.max(0, (cutoff - item.capturedAt) / 1000);
            if (overlap >= item.duration - 0.05) continue;
            if (overlap > 0.05) {
              item.bytes = await trimHlsSegment(item.bytes, overlap);
              item.duration -= overlap;
              item.capturedAt += overlap * 1000;
            }
          }
          await publish(item.bytes, item.duration, item.capturedAt);
        }
        return;
      }
      if ((await read(id, "worker"))?.generation !== generation) {
        stop();
        return;
      }
      const segment = {
        sequence: sequence++,
        generation,
        duration,
        capturedAt,
        end: timestamp + duration,
        discontinuity: first && !!index.segments.length,
      };
      first = false;
      timestamp += duration;
      await put(
        id,
        `segment:${generation}:${segment.sequence}`,
        bytes.toString("base64"),
      );
      if ((await read(id, "worker"))?.generation !== generation) {
        stop();
        return;
      }
      const list = [...index.segments, segment];
      const removed = list.length > 18 ? list.shift() : null;
      index = {
        segments: list,
        discontinuities:
          index.discontinuities + (removed?.discontinuity ? 1 : 0),
      };
      await put(id, "index", index);
    }
    const encoder = new Encoder(
      (bytes, duration, capturedAt) => {
        writes = writes.then(() => publish(bytes, duration, capturedAt));
        void writes.catch((error) => {
          log("hls_cache_error", { message: error.message });
          stop();
        });
      },
      (error) => {
        log("hls_encode_error", { message: error.message });
        stop();
      },
      segmentSeconds,
    );
    const receiver = catalog.find(tune.receiver);
    if (!receiver) throw Error("Неизвестный приёмник");
    log("hls_worker_start", { receiver: tune.receiver, generation });
    let current = tune,
      pollingBusy = false;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, workerMs);
      finish = () => {
        clearTimeout(timer);
        resolve();
      };
      session = new Session(
        receiver.url,
        (value) => {
          if (stopped) return;
          if (value.type === "error") {
            if (active)
              void put(id, "error", {
                message: value.message,
                retryable: value.retryable !== false,
              }).catch(() => {});
            log("hls_upstream_error", {
              receiver: tune.receiver,
              code: value.code,
            });
            stop();
            finish();
            return;
          }
          try {
            encoder.accept(value);
          } catch (error) {
            log("hls_encode_error", { message: error.message });
            stop();
            finish();
          }
        },
        { audioOnly: true },
      );
      session.start(tune);
      polling = setInterval(async () => {
        if (pollingBusy) return;
        pollingBusy = true;
        try {
          const [control, listener, owner, explicitlyStopped] =
            await Promise.all([
              read(id, "control"),
              read(id, "listener"),
              read(id, "worker"),
              read(id, "stopped"),
            ]);
          if (
            control?.stopped ||
            explicitlyStopped ||
            !listener ||
            Date.now() - listener > listenerMs ||
            (active
              ? owner?.generation !== generation
              : owner?.generation !== previous)
          ) {
            stop();
            finish();
            return;
          }
          if (
            control?.tune &&
            JSON.stringify(control.tune) !== JSON.stringify(current)
          ) {
            current = control.tune;
            session.apply(current);
          }
        } catch (error) {
          log("hls_poll_error", { message: error.message });
          stop();
          finish();
        } finally {
          pollingBusy = false;
        }
      }, 1000);
    });
    stop();
    await encoder.finish();
    await writes;
    const owner = await read(id, "worker");
    if (owner?.generation === generation)
      await put(id, "worker", { generation, until: 0 });
    log("hls_worker_end", {
      receiver: tune.receiver,
      generation,
      nextSequence: sequence,
    });
  }

  async function ensureProducer(id, tune) {
    if (starting.has(id)) return starting.get(id);
    const task = (async () => {
      const owner = await read(id, "worker");
      const remaining = (owner?.until || 0) - Date.now();
      const warming = Math.min(30000, workerMs * 0.45);
      if (remaining > warming) return;
      const candidate = await read(id, "candidate");
      if (candidate?.until > Date.now()) return;
      const previous = remaining > 0 ? owner.generation : null;
      const generation = randomUUID();
      const lease = previous ? "candidate" : "worker";
      await put(id, lease, { generation, until: Date.now() + workerMs + 5000 });
      await pause(150);
      if ((await read(id, lease))?.generation !== generation) return;
      if (!previous) await cache.delete(key(id, "error"));
      const job = produce(id, tune, generation, previous)
        .catch(async (error) => {
          log("hls_worker_error", { message: error.message });
          if ((await read(id, "worker"))?.generation === generation) {
            await put(id, "error", {
              message: "Не удалось подготовить фоновый эфир",
              retryable: true,
            });
            await put(id, "worker", { generation, until: 0 });
          }
        })
        .finally(async () => {
          if ((await read(id, "candidate"))?.generation === generation)
            await put(id, "candidate", {
              generation,
              until: Date.now() + 10000,
            });
        });
      keepAlive(job);
    })();
    starting.set(id, task);
    try {
      await task;
    } finally {
      starting.delete(id);
    }
  }

  app.get("/api/hls", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const id = String(req.query.session || "");
    if (!SESSION.test(id))
      return res.status(400).json({ error: "Неверный аудиосеанс" });
    let tune;
    try {
      tune = audioTune(req.query);
    } catch {
      return res.status(400).json({ error: "Некорректная настройка эфира" });
    }
    await catalogReady;
    if (!catalog.find(tune.receiver))
      return res.status(404).json({ error: "Неизвестный приёмник" });
    const control = await read(id, "control");
    const explicitlyStopped = await read(id, "stopped");
    if (control && control.tune.receiver !== tune.receiver)
      return res.status(409).json({ error: "Приёмник изменён" });
    if (!control)
      await put(id, "control", { tune, sequence: 0, stopped: false });
    if (!control?.stopped && !explicitlyStopped) {
      const error = await read(id, "error");
      if (error?.retryable === false)
        return res.status(403).json({ error: error.message });
      await put(id, "listener", Date.now());
      await ensureProducer(id, control?.tune || tune);
    }
    let index = await read(id, "index");
    const deadline = Date.now() + startupMs;
    while (
      !control?.stopped &&
      !explicitlyStopped &&
      (!index || index.segments.length < 6) &&
      Date.now() < deadline &&
      !res.destroyed
    ) {
      await pause(200);
      const error = await read(id, "error");
      if (error)
        return res
          .status(error.retryable ? 503 : 403)
          .json({ error: error.message });
      index = await read(id, "index");
    }
    if (res.destroyed) return;
    if (!index?.segments.length)
      return res.status(503).json({ error: "Эфир ещё не готов" });
    res
      .type("application/vnd.apple.mpegurl")
      .send(hlsPlaylist(index, id, control?.stopped || explicitlyStopped));
  });
  app.get("/api/hls/segment.ts", async (req, res) => {
    const { session: id, generation, sequence } = req.query;
    if (
      !SESSION.test(String(id)) ||
      !SESSION.test(String(generation)) ||
      !/^\d{1,12}$/.test(String(sequence))
    )
      return res.status(400).end();
    const bytes = await read(id, `segment:${generation}:${sequence}`);
    if (!bytes) return res.status(410).end();
    await put(id, "listener", Date.now());
    res.setHeader("Cache-Control", "private, max-age=60, immutable");
    res.type("video/mp2t").send(Buffer.from(bytes, "base64"));
  });
  app.get("/api/hls/tune", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const id = String(req.query.session || "");
    if (!SESSION.test(id)) return res.status(400).end();
    const control = await read(id, "control");
    if (!control || control.stopped || (await read(id, "stopped")))
      return res.status(404).json({ error: "Аудиосеанс завершён" });
    let tune;
    try {
      tune = audioTune(req.query);
    } catch {
      return res.status(400).json({ error: "Некорректная настройка эфира" });
    }
    if (tune.receiver !== control.tune.receiver) return res.status(409).end();
    const sequence = Number(req.query.sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1)
      return res.status(400).end();
    if (sequence > control.sequence)
      await put(id, "control", { tune, sequence, stopped: false });
    res.json({
      ...(sequence > control.sequence ? tune : control.tune),
      sequence: Math.max(sequence, control.sequence),
    });
  });
  app.get("/api/hls/stop", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const id = String(req.query.session || "");
    if (!SESSION.test(id)) return res.status(400).end();
    const control = await read(id, "control");
    await put(id, "stopped", true);
    if (control) await put(id, "control", { ...control, stopped: true });
    res.sendStatus(204);
  });
}
