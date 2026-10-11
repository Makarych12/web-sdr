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
const hamEnv = {
  CALLOOK_ENABLED: "0",
  HAMDB_ENABLED: "0",
  HAMQTH_USERNAME: "test-account",
  HAMQTH_PASSWORD: "test-password",
};
const json = (call = "H1TEST", fields = {}) =>
  new Response(
    JSON.stringify({
      callsign: call,
      name: "Test Operator",
      country: "Germany",
      location: {
        grid: fields.grid,
        lat: fields.lat === undefined ? undefined : Number(fields.lat),
        lon: fields.lon === undefined ? undefined : Number(fields.lon),
      },
      ...fields,
    }),
  );
const hamFetcher = (fn) => async (url, options) =>
  url.endsWith("/login")
    ? new Response(JSON.stringify({ token: "test-token", expiresIn: 3600 }))
    : fn(url, options);
const xml = (content) => new Response(`<QRZDatabase>${content}</QRZDatabase>`);
const session = (key = "secret-session") =>
  `<Session><Key>${key}</Key></Session>`;
const env = {
  CALLOOK_ENABLED: "0",
  HAMDB_ENABLED: "0",
  QRZ_USERNAME: "test-account",
  QRZ_PASSWORD: "test-password",
};
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
test("HamQTH lookup exposes only actual allowed fields, ignores sentinels and shares cache", async () => {
  let requests = 0,
    now = 1000;
  const service = new CallsignLookup({
    env: hamEnv,
    now: () => now,
    fetcher: hamFetcher(async () => {
      requests++;
      return json("H1TEST", {
        grid: "NOT_FOUND",
        email: "private",
        image: "unrequested",
      });
    }),
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
    env: hamEnv,
    fetcher: hamFetcher(async () => {
      requests++;
      return new Response("{}", { status: 404 });
    }),
  });
  assert.equal((await service.lookup("ZZ0TEST", "one")).status, "not_found");
  await service.lookup("ZZ0TEST", "one");
  assert.equal(requests, 1);
  const failed = new CallsignLookup({
    env: hamEnv,
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
    (e) => e.status === 503 && !JSON.stringify(e).includes(env.QRZ_PASSWORD),
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
    env: hamEnv,
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
      env: hamEnv,
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
    env: hamEnv,
    fetcher: hamFetcher(async (url) =>
      json(new URL(url).pathname.includes("UR4MTN") ? "UR4MTN" : "H1TEST", {
        lat: "0",
        lon: new URL(url).pathname.includes("UR4MTN") ? "0" : "1",
      }),
    ),
  });
  assert.equal((await service.lookup("H1TEST", "one")).azimuth, 90);
  const centroid = new CallsignLookup({
    env: hamEnv,
    fetcher: hamFetcher(async () => json("H1TEST", { location: {} })),
  });
  assert.equal((await centroid.lookup("H1TEST", "one")).coordinates, undefined);
  assert.equal(
    service.record(
      { call: "H1TEST", lat: "1", lon: "1", geoloc: "dxcc" },
      "QRZ",
    ).coordinates,
    undefined,
  );
});
test("HTTP gateway responds to success/not-found/errors and limits one client without trusting spoofed forwarding", async () => {
  const app = express();
  registerCallsignRoute(
    app,
    new CallsignLookup({
      env: hamEnv,
      fetcher: hamFetcher(async (url) =>
        url.includes("ZZ0TEST") ? new Response("{}", { status: 404 }) : json(),
      ),
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
test("QRZ restrictions and technical failures fall back to HamQTH; genuine misses do not", async () => {
  for (const kind of ["subscription", "outage", "missing"]) {
    let fallback = 0;
    const service = new CallsignLookup({
      env: { ...env, ...hamEnv },
      fetcher: async (url, options) => {
        if (url.includes("qrz.com")) {
          if (kind === "outage") throw Error("offline");
          if (new URLSearchParams(options.body).has("username"))
            return xml(session());
          return xml(
            `<Session><Key>secret-session</Key><Error>${kind === "missing" ? "Not found" : "Subscription required"}</Error></Session>`,
          );
        }
        if (url.endsWith("/login"))
          return new Response('{"token":"ham-token","expiresIn":3600}');
        fallback++;
        return json("H1TEST");
      },
    });
    const r = await service.lookup("H1TEST", "one");
    assert.equal(r.status, kind === "missing" ? "not_found" : "found");
    assert.equal(fallback, kind === "missing" ? 0 : 1);
  }
});
test("no credentials is unavailable and never emits a false negative", async () => {
  const diagnostics = [];
  const service = new CallsignLookup({
    env: { CALLOOK_ENABLED: "0", HAMDB_ENABLED: "0" },
    onDiagnostic: (d) => diagnostics.push(d),
    fetcher: async () => {
      throw Error("unexpected request");
    },
  });
  await assert.rejects(service.lookup(" ur4mad ", "one"), { status: 503 });
  assert.deepEqual(diagnostics, [
    {
      callsign: "UR4MAD",
      source: "QRZ",
      httpStatus: null,
      type: "credentials_missing",
      refreshed: false,
      fields: [],
    },
  ]);
  assert.equal(service.cache.size, 0);
});
test("HamQTH refreshes expired token once; negative cache expires and accepts a newly available record", async () => {
  let logins = 0,
    lookups = 0,
    now = 0,
    present = false;
  const service = new CallsignLookup({
    env: hamEnv,
    now: () => now,
    fetcher: async (url) => {
      if (url.endsWith("/login")) {
        logins++;
        return new Response('{"token":"ham-token","expiresIn":3600}');
      }
      lookups++;
      if (lookups === 1) return new Response("{}", { status: 401 });
      return present ? json("H1TEST") : new Response("{}", { status: 404 });
    },
  });
  assert.equal((await service.lookup("H1TEST", "one")).status, "not_found");
  assert.equal(logins, 2);
  assert.equal(lookups, 2);
  present = true;
  assert.equal((await service.lookup("H1TEST", "one")).status, "not_found");
  now = 60001;
  assert.equal((await service.lookup("H1TEST", "one")).status, "found");
});
test("international callsigns are passed in full; QRZ namespace is parsed", async () => {
  const calls = [
    "UR4MAD",
    "UR4MTN",
    "W1AW",
    "JA1ABC",
    "VK2ABC",
    "VE3ABC",
    "ZS6ABC",
    "JA1ABC/P",
  ];
  const seen = [];
  const service = new CallsignLookup({
    env,
    fetcher: async (_, options) => {
      const p = new URLSearchParams(options.body);
      if (p.has("username")) return xml(session());
      seen.push(p.get("callsign"));
      return new Response(
        `<q:QRZDatabase xmlns:q="urn:qrz"><q:Callsign><q:call>${p.get("callsign")}</q:call></q:Callsign><q:Session><q:Key>secret-session</q:Key></q:Session></q:QRZDatabase>`,
      );
    },
  });
  for (const call of calls)
    assert.equal(
      (await service.lookup(` ${call.toLowerCase()} `, call)).callsign,
      call,
    );
  assert.deepEqual(seen, calls);
});
test("HamQTH diagnostics classify failures without exposing credentials or payloads", async () => {
  for (const status of [401, 429, 500]) {
    const diagnostics = [];
    const service = new CallsignLookup({
      env: hamEnv,
      onDiagnostic: (d) => diagnostics.push(d),
      fetcher: async () =>
        new Response("private password and token payload", { status }),
    });
    await assert.rejects(service.lookup("H1TEST", "one"), { status: 503 });
    const d = diagnostics.find((d) => d.source === "HamQTH");
    assert.equal(d.phase, "login");
    assert.equal(d.httpStatus, status);
    assert.equal(
      d.type,
      status === 401
        ? "authorization_error"
        : status === 429
          ? "rate_limited"
          : "http_error",
    );
    for (const privateText of [
      "private password",
      hamEnv.HAMQTH_PASSWORD,
      hamEnv.HAMQTH_USERNAME,
    ])
      assert.equal(JSON.stringify(diagnostics).includes(privateText), false);
  }
});
