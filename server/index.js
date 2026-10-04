import express from "express";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import { KiwiSession, validateTune } from "./kiwi.js";
import { ReceiverCatalog } from "./catalog.js";
const receivers = JSON.parse(
  readFileSync(new URL("./receivers.json", import.meta.url)),
);
const catalog = new ReceiverCatalog(receivers);
void catalog.initialize();
const refreshTimer = setInterval(() => void catalog.refresh(), 15 * 60 * 1000);
refreshTimer.unref();
const app = express();
const server = createServer(app);
app.get("/api/receivers", (_, res) => res.json(catalog.list()));
app.get("/api/catalog", (_, res) =>
  res.json({
    updatedAt: catalog.updatedAt,
    stale: catalog.stale,
    source: "KiwiSDR public directory",
    count: catalog.receivers.length,
  }),
);
app.get("/api/health", (_, res) => res.json({ ok: true }));
app.use(express.static("dist"));
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4096 });
wss.on("connection", (client, req) => {
  const origin = req.headers.origin;
  try {
    if (origin && new URL(origin).host !== req.headers.host)
      throw Error("Origin rejected");
  } catch {
    client.close(1008, "Origin rejected");
    return;
  }
  let session;
  const emit = (v) => {
    if (client.readyState === WebSocket.OPEN) {
      if (client.bufferedAmount > 1024 * 1024) {
        session?.close();
        client.close(1013, "Slow connection");
        return;
      }
      client.send(Buffer.isBuffer(v) ? v : JSON.stringify(v));
    }
  };
  client.on("message", (raw) => {
    try {
      const v = JSON.parse(raw);
      if (v.type === "connect") {
        const r = catalog.find(v.receiver);
        if (!r) throw Error("Неизвестный приёмник");
        validateTune(v);
        session?.close();
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
  client.on("close", () => session?.close());
  client.on("error", () => session?.close());
});
server.listen(Number(process.env.PORT || 8787), "0.0.0.0", () =>
  console.log("WebSDR gateway http://localhost:8787"),
);
process.on("SIGTERM", () => {
  wss.clients.forEach((c) => c.close());
  server.close();
});
