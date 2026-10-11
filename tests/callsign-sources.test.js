import test from "node:test";
import assert from "node:assert/strict";
import {
  lookupInSources,
  compareCallsignRecords,
} from "../server/callsign-sources.js";
import { CallsignLookup } from "../server/callsign.js";
const p = (id, lookup, scope = "global") => ({ id, scope, lookup });
test("a precise primary result stops later providers; dates identify collection, not profile freshness", async () => {
  let later = 0;
  const value = await lookupInSources(
    "H1TEST",
    [
      p("A", async () => ({
        status: "found",
        source: "A",
        name: "Owner",
        country: "Ukraine",
      })),
      p("B", async () => {
        later++;
        return { status: "found", source: "B", name: "Someone else" };
      }),
    ],
    { now: () => 0 },
  );
  assert.equal(later, 0);
  assert.equal(value.name, "Owner");
  assert.equal(value.retrievedAt, "1970-01-01T00:00:00.000Z");
});
test("a global negative is final; regional absence does not establish global absence", async () => {
  let later = 0;
  const global = await lookupInSources("H1TEST", [
    p("A", async () => ({ status: "not_found", source: "A" })),
    p("B", async () => {
      later++;
    }),
  ]);
  assert.equal(global.status, "not_found");
  assert.equal(later, 0);
  await assert.rejects(
    lookupInSources("UR4MAD", [
      p(
        "Callook",
        async () => ({ status: "not_found", source: "Callook" }),
        "US",
      ),
      p("HamQTH", async () => {
        throw Error("offline");
      }),
    ]),
    { status: 503 },
  );
});
test("technical failures fall back without merging partial identity data or trusting false provenance", async () => {
  const result = await lookupInSources(
    "H1TEST",
    [
      p("disabled", async () => {
        throw Error("must not run");
      }),
      p("A", async () => ({ status: "found", source: "wrong", name: "Wrong" })),
      p("B", async () => {
        throw Error("offline");
      }),
      p("C", async () => ({ status: "found", source: "C", name: "Actual" })),
    ].map((x) => (x.id === "disabled" ? { ...x, enabled: false } : x)),
  );
  assert.equal(result.source, "C");
  assert.equal(result.name, "Actual");
  assert.equal(result.country, undefined);
});
test("explicit disagreements are marked, with separate records and no automatically selected owner", () => {
  const conflict = compareCallsignRecords([
    {
      status: "found",
      source: "A",
      callsign: "H1TEST",
      name: "First",
      country: "Ukraine",
    },
    {
      status: "found",
      source: "B",
      callsign: "H1TEST",
      name: "Second",
      country: "Russia",
    },
  ]);
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.name, undefined);
  assert.equal(conflict.country, undefined);
  assert.deepEqual(conflict.differences, ["name", "country"]);
  assert.equal(conflict.records.length, 2);
  assert.equal(
    compareCallsignRecords([
      { status: "found", source: "A", name: "OWNER" },
      { status: "found", source: "B", name: "owner" },
    ]).status,
    "consistent",
  );
});
test("Callook preserves one complete source record and excludes its approximate mailing coordinates", async () => {
  let requests = 0,
    now = 0;
  const service = new CallsignLookup({
    env: {},
    now: () => now,
    fetcher: async (url) => {
      assert.equal(url, "https://callook.info/H1TEST/json");
      requests++;
      return new Response(
        JSON.stringify({
          status: "VALID",
          current: { callsign: "H1TEST" },
          name: "Test Owner",
          address: { line2: "A CITY, CT" },
          location: { latitude: "1", longitude: "1", gridsquare: "AA00aa" },
        }),
      );
    },
  });
  const first = await service.lookup(" h1test ", "one");
  assert.equal(first.source, "Callook");
  assert.equal(first.countryCode, "US");
  assert.equal(first.coordinates, undefined);
  assert.equal(first.distanceKm, undefined);
  assert.match(first.notice, /почтовому адресу/);
  now = 1000;
  const second = await service.lookup("H1TEST", "one");
  assert.equal(first.retrievedAt, second.retrievedAt);
  assert.equal(requests, 1);
});
test("historical Callook aliases do not silently select another callsign owner", async () => {
  const service = new CallsignLookup({
    env: {},
    fetcher: async () =>
      new Response(
        JSON.stringify({
          status: "VALID",
          current: { callsign: "H2TEST" },
          name: "Current Owner",
        }),
      ),
  });
  const result = await service.lookup("H1TEST", "one");
  assert.equal(result.status, "conflict");
  assert.equal(result.callsign, undefined);
  assert.equal(result.name, undefined);
  assert.equal(result.records[0].callsign, "H2TEST");
});
test("Callook UPDATING is unavailable and allows HamQTH; no regional false negative", async () => {
  const service = new CallsignLookup({
    env: { HAMQTH_USERNAME: "test", HAMQTH_PASSWORD: "test" },
    fetcher: async (url) =>
      new Response(
        JSON.stringify(
          url.includes("callook.info")
            ? { status: "UPDATING" }
            : url.endsWith("/login")
              ? { token: "test", expiresIn: 3600 }
              : {
                  callsign: "H1TEST",
                  name: "Actual Global Owner",
                  country: "Japan",
                },
        ),
      ),
  });
  const result = await service.lookup("H1TEST", "one");
  assert.equal(result.source, "HamQTH");
  assert.equal(result.country, "Japan");
});
