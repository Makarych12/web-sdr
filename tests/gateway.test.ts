import test from "node:test";
import assert from "node:assert/strict";
import { gatewayEndpoints } from "../src/gatewayConfig.ts";
import { originAllowed } from "../server/origins.js";
test("external gateway uses HTTPS API and WSS with no frontend host fallback", () => {
  const e = gatewayEndpoints(
    "https://gateway.example/",
    "https://web-sdr.vercel.app",
  );
  assert.equal(e.http, "https://gateway.example");
  assert.equal(e.socket, "wss://gateway.example/ws");
  assert.throws(() =>
    gatewayEndpoints("http://localhost:8787", "https://web-sdr.vercel.app"),
  );
  assert.throws(() =>
    gatewayEndpoints(
      "https://user:secret@gateway.example",
      "https://web-sdr.vercel.app",
    ),
  );
  assert.deepEqual(gatewayEndpoints("", "http://localhost:8787"), {
    http: "http://localhost:8787",
    socket: "ws://localhost:8787/ws",
  });
});
test("CORS and WebSocket share an exact origin allowlist", () => {
  assert.equal(
    originAllowed(
      "https://web-sdr.vercel.app",
      "gateway.onrender.com",
      "https://web-sdr.vercel.app",
    ),
    true,
  );
  assert.equal(
    originAllowed(
      "https://web-sdr.vercel.app.evil.example",
      "gateway.onrender.com",
      "https://web-sdr.vercel.app",
    ),
    false,
  );
  assert.equal(
    originAllowed(
      "https://evil.example",
      "gateway.onrender.com",
      "https://web-sdr.vercel.app",
    ),
    false,
  );
  assert.equal(
    originAllowed("null", "gateway.onrender.com", "https://web-sdr.vercel.app"),
    false,
  );
  assert.equal(
    originAllowed("http://localhost:8787", "localhost:8787", ""),
    true,
  );
});
