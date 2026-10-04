// Exercise a production-built frontend on one origin and real HTTPS/WSS
// gateway on a different origin. Local TLS stands in for Render's edge TLS.
import { chromium } from "@playwright/test";
import express from "express";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import {
  readFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const tmp = mkdtempSync(join(tmpdir(), "sdr-tls-"));
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    join(tmp, "key.pem"),
    "-out",
    join(tmp, "cert.pem"),
    "-days",
    "1",
    "-subj",
    "/CN=gateway.sdr.test",
    "-addext",
    "subjectAltName=DNS:gateway.sdr.test",
  ],
  { stdio: "ignore" },
);
execFileSync(
  "node",
  ["node_modules/vite/bin/vite.js", "build", "--outDir", join(tmp, "dist")],
  {
    env: { ...process.env, VITE_GATEWAY_URL: "https://gateway.sdr.test:9443" },
    stdio: "pipe",
  },
);
const sockets = new Set();
const tls = https.createServer(
  {
    key: readFileSync(join(tmp, "key.pem")),
    cert: readFileSync(join(tmp, "cert.pem")),
  },
  (req, res) => {
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: 8787,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (reply) => {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  },
);
tls.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(8787, "127.0.0.1", () => {
    const headers = Object.entries(req.headers)
      .map(([key, v]) => `${key}: ${v}`)
      .join("\r\n");
    upstream.write(
      `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`,
    );
    if (head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  sockets.add(socket);
  sockets.add(upstream);
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => {
    upstream.destroy();
    sockets.delete(socket);
    sockets.delete(upstream);
  });
});
const app = express();
app.use(express.static(join(tmp, "dist")));
const front = http.createServer(app);
await new Promise((resolve) => tls.listen(9443, "0.0.0.0", resolve));
await new Promise((resolve) => front.listen(4173, "0.0.0.0", resolve));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: [
    "--no-sandbox",
    "--host-resolver-rules=MAP gateway.sdr.test 127.0.0.1",
  ],
});
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const Audio = window.AudioContext;
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (...a) {
      if (this instanceof AudioWorkletNode) {
        window.__analyser = this.context.createAnalyser();
        connect.call(this, window.__analyser);
      }
      return connect.apply(this, a);
    };
  });
  const requests = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/")) requests.push(req.url());
  });
  const ws = [];
  page.on("websocket", (socket) => ws.push(socket.url()));
  await page.goto("http://localhost:4173");
  await page.locator("#receiver option").nth(20).waitFor({ state: "attached" });
  assert.ok(
    requests.every((url) =>
      url.startsWith("https://gateway.sdr.test:9443/api/"),
    ),
  );
  const health = await page.evaluate(async () =>
    (await fetch("https://gateway.sdr.test:9443/api/health")).json(),
  );
  assert.equal(health.ok, true);
  await page.locator(".hero-cta").click();
  async function healthy() {
    await page.waitForFunction(
      () => {
        const packets = document
          .querySelector("footer")
          ?.textContent.match(/(\d+) PCM · (\d+) WF/);
        if (
          !packets ||
          +packets[1] < 10 ||
          +packets[2] < 10 ||
          !window.__analyser
        )
          return false;
        const samples = new Float32Array(window.__analyser.fftSize);
        window.__analyser.getFloatTimeDomainData(samples);
        return samples.some((v) => Math.abs(v) > 0.00001);
      },
      null,
      { timeout: 30000 },
    );
  }
  await healthy();
  assert.equal(ws[0], "wss://gateway.sdr.test:9443/ws");
  await page.locator("#frequency").fill("7074");
  await page.getByRole("button", { name: "Настроить", exact: true }).click();
  await page.getByRole("button", { name: "USB", exact: true }).click();
  await page.waitForFunction(
    () =>
      Math.abs(
        +document.querySelector(".visual").dataset.start +
          +document.querySelector(".visual").dataset.span / 2 -
          7074,
      ) < 0.01,
  );
  await healthy();
  await page.getByLabel("AGC", { exact: true }).selectOption("fast");
  await healthy();
  assert.deepEqual(errors, []);
  await page.getByRole("button", { name: "Отключиться" }).click();
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    "artifacts/split-gateway-report.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        frontend: "http://localhost:4173",
        gateway: "https://gateway.sdr.test:9443",
        requests,
        websockets: ws,
        checks: [
          "cross-origin HTTPS API with CORS",
          "WSS upgrade with frontend Origin",
          "nonzero AudioWorklet output",
          "actual tuning and waterfall center",
          "AGC preserves real stream",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: production-built separate frontend + HTTPS/WSS gateway, real audio/tuning/waterfall/AGC",
  );
} finally {
  await browser.close();
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => tls.close(resolve));
  await new Promise((resolve) => front.close(resolve));
  rmSync(tmp, { recursive: true, force: true });
}
