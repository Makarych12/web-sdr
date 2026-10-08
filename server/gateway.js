import express from "express";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import { KiwiSession, validateTune } from "./kiwi.js";
import { ReceiverCatalog } from "./catalog.js";
import { originAllowed } from "./origins.js";
import { installNativeAudio } from "./nativeAudio.js";
import { installHlsAudio } from "./hlsAudio.js";
const receivers = JSON.parse(
  readFileSync(new URL("./receivers.json", import.meta.url)),
);
const catalog = new ReceiverCatalog(receivers);
const catalogReady = catalog.initialize();
const refreshTimer = setInterval(() => void catalog.refresh(), 15 * 60 * 1000);
refreshTimer.unref();
const app = express();
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!originAllowed(origin, req.headers.host))
    return res.status(403).json({ error: "Origin rejected" });
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
const server = createServer(app);
app.get("/api/receivers", async (_, res) => {
  await catalogReady;
  res.json(catalog.list());
});
app.get("/api/catalog", (_, res) =>
  res.json({
    updatedAt: catalog.updatedAt,
    stale: catalog.stale,
    source: "KiwiSDR public directory",
    count: catalog.receivers.length,
  }),
);
app.get("/api/health", (_, res) =>
  res.json({
    ok: true,
    service: "ur4mtn-kiwi-gateway",
    transport: "websocket",
    hosting: process.env.VERCEL ? "vercel" : "node",
    revision: process.env.VERCEL_GIT_COMMIT_SHA || "local",
  }),
);
installNativeAudio(app, catalog, catalogReady);
installHlsAudio(app, catalog, catalogReady);
app.use(express.static("dist"));
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
server.on("upgrade", (req, socket, head) => {
  const path = new URL(req.url, "http://gateway").pathname;
  if (
    !["/ws", "/api/gateway"].includes(path) ||
    !originAllowed(req.headers.origin, req.headers.host)
  ) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return;
  }
  wss.handleUpgrade(req, socket, head, (client) =>
    wss.emit("connection", client, req),
  );
});
const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (Date.now() - client.lastSeen > 75000) {
      console.warn(
        JSON.stringify({
          event: "heartbeat_timeout",
          connection: client.id,
          silenceMs: Date.now() - client.lastSeen,
          buffered: client.bufferedAmount,
        }),
      );
      client.close(1011, "heartbeat_timeout");
      continue;
    }
    if (client.readyState === WebSocket.OPEN) {
      client.ping();
      client.send(JSON.stringify({ type: "heartbeat", at: Date.now() }));
    }
  }
}, 25000);
heartbeat.unref();
wss.on("close", () => clearInterval(heartbeat));
wss.on("connection", async (client) => {
  client.id = randomUUID();
  client.openedAt = client.lastSeen = Date.now();
  client.on("pong", () => {
    client.lastSeen = Date.now();
  });
  console.info(
    JSON.stringify({ event: "gateway_open", connection: client.id }),
  );
  let session;
  const emit = (v) => {
    if (v.type === "error")
      console.warn(
        JSON.stringify({
          event: "upstream_error",
          connection: client.id,
          receiver: client.receiver,
          seconds: (Date.now() - client.openedAt) / 1000,
          ...v,
        }),
      );
    if (client.readyState === WebSocket.OPEN) {
      if (client.bufferedAmount > 1024 * 1024) {
        session?.close();
        client.close(1013, "Slow connection");
        return;
      }
      client.send(v instanceof Uint8Array ? v : JSON.stringify(v));
    }
  };
  client.on("message", async (raw) => {
    try {
      const v = JSON.parse(raw);
      client.lastSeen = Date.now();
      if (v.type === "heartbeat_ack") return;
      if (v.type === "connect") {
        await catalogReady;
        if (client.readyState !== WebSocket.OPEN) return;
        const r = catalog.find(v.receiver);
        if (!r) throw Error("Неизвестный приёмник");
        validateTune(v);
        session?.close();
        client.receiver = r.id;
        console.info(
          JSON.stringify({
            event: "kiwi_connect",
            connection: client.id,
            receiver: r.id,
          }),
        );
        session = new KiwiSession(r.url, emit);
        session.start(v);
      } else if (v.type === "tune") {
        if (!session || session.closed) throw Error("Нет подключения");
        session.apply(v);
      } else if (v.type === "disconnect") {
        session?.close();
        emit({ type: "disconnected" });
      } else throw Error("Неизвестная команда");
    } catch (e) {
      emit({
        type: "error",
        message: e.message,
        code: "invalid_command",
        retryable: false,
      });
    }
  });
  client.on("close", (code, reason) => {
    console.info(
      JSON.stringify({
        event: "gateway_close",
        connection: client.id,
        receiver: client.receiver,
        code,
        reason: reason.toString(),
        seconds: (Date.now() - client.openedAt) / 1000,
        lastSeenAge: Date.now() - client.lastSeen,
      }),
    );
    session?.close();
  });
  client.on("error", () => session?.close());
});
export { app, server, wss };
