import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import {
  CallsignLookup,
  normalizeCallsign,
  distanceBearing,
  registerCallsignRoute,
} from "../server/callsign.js";
const json = (call = "H1TEST", fields = {}) =>
  new Response(
    JSON.stringify({
      hamdb: {
        messages: { status: "OK" },
        callsign: {
          call,
          fname: "Test",
          name: "Operator",
          country: "Germany",
          ...fields,
        },
      },
    }),
  );
const xml = (content) => new Response(`<QRZDatabase>${content}</QRZDatabase>`);
const session = (key = "secret-session") =>
  `<Session><Key>${key}</Key></Session>`;
const env = { QRZ_USERNAME: "test-account", QRZ_PASSWORD: "test-password" };
test("callsigns normalize trim/case and reject URLs, markup and invalid names", () => {
  assert.equal(normalizeCallsign("  ur4mtn/p "), "UR4MTN/P");
  for (const value of [
    "",
    "abc",
    "123",
    "H 1TEST",
    "http://example.com",
    "<script>",
    "H1".repeat(20),
  ])
    assert.throws(() => normalizeCallsign(value), { status: 400 });
});
test("free HamDB lookup exposes only actual allowed fields, ignores sentinels and shares cache", async () => {
  let requests = 0,
    now = 1000;
  const service = new CallsignLookup({
    env: {},
    now: () => now,
    fetcher: async () => {
      requests++;
      return json("H1TEST", {
        grid: "NOT_FOUND",
        email: "private",
        image: "unrequested",
      });
    },
  });
  const [a, b] = await Promise.all([
    service.lookup("h1test", "one"),
    service.lookup("H1TEST", "two"),
  ]);
  assert.deepEqual(a, b);
  assert.equal(requests, 1);
  assert.equal(a.name, "Test Operator");
  assert.equal(a.countryCode, "DE");
  assert.equal(a.grid, undefined);
  assert.equal(a.email, undefined);
  assert.equal(a.distanceKm, undefined);
  await service.lookup("H1TEST", "three");
  assert.equal(requests, 1);
  now += 300001;
  await service.lookup("H1TEST", "three");
  assert.equal(requests, 2);
});
test("not found is distinct from network outage and cached briefly", async () => {
  let requests = 0;
  const service = new CallsignLookup({
    env: {},
    fetcher: async () => {
      requests++;
      return new Response(
        '{"hamdb":{"messages":{"status":"NOT_FOUND"},"callsign":{"call":"NOT_FOUND"}}}',
      );
    },
  });
  assert.equal((await service.lookup("ZZ0TEST", "one")).status, "not_found");
  await service.lookup("ZZ0TEST", "one");
  assert.equal(requests, 1);
  const failed = new CallsignLookup({
    env: {},
    fetcher: async () => {
      throw Error("network details must not escape");
    },
  });
  await assert.rejects(
    failed.lookup("H1TEST", "one"),
    (error) =>
      error.status === 503 && !error.message.includes("network details"),
  );
});
test("QRZ login is HTTPS POST, shared concurrently, refreshed once on expired session, secret-free DTO", async () => {
  let logins = 0,
    lookups = 0;
  const service = new CallsignLookup({
    env,
    fetcher: async (url, options) => {
      assert.equal(url, "https://xmldata.qrz.com/xml/current/");
      assert.equal(options.method, "POST");
      const params = new URLSearchParams(options.body);
      if (params.has("username")) {
        logins++;
        assert.equal(params.get("password"), env.QRZ_PASSWORD);
        return xml(session());
      }
      lookups++;
      if (lookups === 1)
        return xml("<Session><Error>Session Timeout</Error></Session>");
      return xml(
        `<Callsign><call>${params.get("callsign")}</call><fname>Test &amp; Co</fname><country>Germany</country><email>private</email></Callsign>${session()}`,
      );
    },
  });
  const [a, b] = await Promise.all([
    service.lookup("H1TEST", "one"),
    service.lookup("H2TEST", "two"),
  ]);
  assert.equal(logins, 2);
  assert.equal(lookups, 3);
  assert.equal(a.name, "Test & Co");
  for (const result of [a, b])
    for (const secret of [
      env.QRZ_USERNAME,
      env.QRZ_PASSWORD,
      "secret-session",
      "private",
    ])
      assert.equal(JSON.stringify(result).includes(secret), false);
});
test("QRZ failure messages redact credentials and auth failure has cooldown", async () => {
  let requests = 0;
  const service = new CallsignLookup({
    env,
    fetcher: async () => {
      requests++;
      return xml(
        `<Session><Error>password incorrect ${env.QRZ_PASSWORD}</Error></Session>`,
      );
    },
  });
  await assert.rejects(
    service.lookup("H1TEST", "one"),
    (e) => e.status === 503 && !e.notice.includes(env.QRZ_PASSWORD),
  );
  await assert.rejects(service.lookup("H2TEST", "one"), { status: 503 });
  assert.equal(requests, 1);
});
test("QRZ not found does not trigger repeated authorization; unsafe XML is rejected", async () => {
  let requests = 0;
  const service = new CallsignLookup({
    env,
    fetcher: async () => {
      requests++;
      return requests === 1
        ? xml(session())
        : xml(
            `<Session><Key>secret-session</Key><Error>Not found</Error></Session>`,
          );
    },
  });
  assert.equal((await service.lookup("H1TEST", "one")).status, "not_found");
  assert.equal(requests, 2);
  const unsafe = new CallsignLookup({
    env,
    fetcher: async () =>
      new Response(
        '<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><QRZDatabase/>',
      ),
  });
  await assert.rejects(unsafe.lookup("H1TEST", "one"), { status: 503 });
});
test("timeout aborts upstream, oversized and invalid payloads fail safely", async () => {
  const timeout = new CallsignLookup({
    env: {},
    timeoutMs: 10,
    fetcher: async (_, options) =>
      new Promise((_, reject) =>
        options.signal.addEventListener("abort", () =>
          reject(Error("timeout")),
        ),
      ),
  });
  await assert.rejects(timeout.lookup("H1TEST", "one"), { status: 503 });
  for (const body of ["<html>outage</html>", "x".repeat(128 * 1024 + 1)]) {
    const service = new CallsignLookup({
      env: {},
      fetcher: async () => new Response(body),
    });
    await assert.rejects(service.lookup("H1TEST", "one"), { status: 503 });
  }
});
test("distance requires both real coordinate pairs; zero longitude is valid; country centroid is excluded", async () => {
  assert.deepEqual(distanceBearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), {
    distanceKm: 111,
    azimuth: 90,
  });
  const service = new CallsignLookup({
    env: {},
    fetcher: async (url) =>
      json(url.includes("UR4MTN") ? "UR4MTN" : "H1TEST", {
        lat: "0",
        lon: url.includes("UR4MTN") ? "0" : "1",
      }),
  });
  assert.equal((await service.lookup("H1TEST", "one")).azimuth, 90);
  const centroid = new CallsignLookup({
    env: {},
    fetcher: async () => json("H1TEST", { lat: "1", lon: "1", geoloc: "dxcc" }),
  });
  assert.equal((await centroid.lookup("H1TEST", "one")).coordinates, undefined);
});
test("HTTP gateway responds to success/not-found/errors and limits one client without trusting spoofed forwarding", async () => {
  const app = express();
  registerCallsignRoute(
    app,
    new CallsignLookup({
      env: {},
      fetcher: async (url) =>
        url.includes("ZZ0TEST")
          ? new Response('{"hamdb":{"messages":{"status":"NOT_FOUND"}}}')
          : json(),
    }),
  );
  const server = createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/api/callsign/`;
  try {
    assert.equal((await fetch(base + "H1TEST")).status, 200);
    assert.equal((await fetch(base + "ZZ0TEST")).status, 404);
    assert.equal((await fetch(base + "bad")).status, 400);
    for (let i = 0; i < 7; i++)
      assert.equal((await fetch(base + "H1TEST")).status, 200);
    const response = await fetch(base + "H1TEST", {
      headers: { "x-forwarded-for": "different-client" },
    });
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get("retry-after")) > 0);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
