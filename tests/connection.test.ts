import test from "node:test";
import assert from "node:assert/strict";
import { StreamConnection } from "../src/connection.ts";
class FakeSocket {
  readyState = 0;
  binaryType = "";
  sent: string[] = [];
  onopen: any;
  onmessage: any;
  onclose: any;
  onerror: any;
  send(s: string) {
    this.sent.push(s);
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: "test disconnect", wasClean: false });
  }
  message(v: any) {
    this.onmessage?.({ data: JSON.stringify(v) });
  }
}
function setup(onUnavailable?: (code: string) => boolean) {
  const sockets: FakeSocket[] = [],
    states: any[] = [];
  let config = {
    receiver: "france",
    frequency: 7074,
    mode: "USB",
    zoom: 7,
    lowCut: 300,
    highCut: 2100,
  };
  const c = new StreamConnection({
    url: "ws://localhost/ws",
    onUnavailable,
    random: () => 0.5,
    getConfig: () => config,
    onMessage: () => {},
    onState: (s) => states.push(s),
    onReset: () => {},
    socketFactory: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s as unknown as WebSocket;
    },
  });
  return { c, sockets, states, setConfig: (v: typeof config) => (config = v) };
}
test("automatic retry restores latest settings and ignores stale socket events", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const { c, sockets, states } = setup();
  c.start();
  sockets[0].open();
  sockets[0].close();
  assert.equal(states.at(-1).phase, "retrying");
  t.mock.timers.tick(1000);
  assert.equal(sockets.length, 2);
  sockets[1].open();
  assert.equal(JSON.parse(sockets[1].sent[0]).frequency, 7074);
  assert.equal(JSON.parse(sockets[1].sent[0]).highCut, 2100);
  sockets[0].message({ type: "error", retryable: false });
  assert.equal(c.desired, true);
  c.stop();
  t.mock.timers.tick(60000);
  assert.equal(sockets.length, 2);
});
test("stop cancels pending retries; access restrictions do not reconnect", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const { c, sockets, states } = setup();
  c.start();
  sockets[0].open();
  sockets[0].message({ type: "error", retryable: false, message: "Limit" });
  assert.equal(states.at(-1).phase, "blocked");
  assert.equal(c.desired, false);
  t.mock.timers.tick(60000);
  assert.equal(sockets.length, 1);
});
test("server switch opens one new session with updated receiver", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const { c, sockets, setConfig } = setup();
  c.start();
  sockets[0].open();
  setConfig({
    receiver: "areg",
    frequency: 10000,
    mode: "AM",
    zoom: 6,
    lowCut: -2500,
    highCut: 2500,
  });
  c.switchReceiver();
  sockets[1].open();
  assert.equal(sockets[0].readyState, 3);
  assert.equal(JSON.parse(sockets[1].sent[0]).receiver, "areg");
  c.stop();
});

test("unavailable Kiwi switches receiver while preserving the current tune", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  let change: (v: any) => void;
  const codes: string[] = [];
  const { c, sockets, states, setConfig } = setup((code) => {
    codes.push(code);
    change({
      receiver: "areg",
      frequency: 7074,
      mode: "USB",
      zoom: 7,
      lowCut: 300,
      highCut: 2100,
    });
    return true;
  });
  change = setConfig;
  c.start();
  sockets[0].open();
  sockets[0].message({
    type: "error",
    code: "badp",
    retryable: false,
    message: "Kiwi unavailable",
  });
  assert.deepEqual(codes, []);
  t.mock.timers.tick(1000);
  sockets[1].open();
  assert.equal(JSON.parse(sockets[1].sent[0]).receiver, "france");
  sockets[1].message({
    type: "error",
    code: "badp",
    retryable: false,
    message: "Kiwi unavailable",
  });
  assert.deepEqual(codes, ["badp"]);
  assert.equal(c.desired, true);
  assert.equal(states.at(-1).phase, "retrying");
  t.mock.timers.tick(2000);
  sockets[2].open();
  assert.equal(JSON.parse(sockets[2].sent[0]).receiver, "areg");
  assert.equal(JSON.parse(sockets[2].sent[0]).highCut, 2100);
  c.stop();
});

test("gateway disconnect and stream timeout retry the same Kiwi without failover", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  let changes = 0;
  const { c, sockets } = setup(() => {
    changes++;
    return true;
  });
  c.start();
  sockets[0].open();
  sockets[0].close();
  t.mock.timers.tick(1000);
  sockets[1].open();
  assert.equal(JSON.parse(sockets[1].sent[0]).receiver, "france");
  t.mock.timers.tick(23000);
  assert.equal(changes, 0);
  c.stop();
});
test("application heartbeat is acknowledged without resetting the stream", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const { c, sockets } = setup();
  c.start();
  sockets[0].open();
  sockets[0].message({ type: "heartbeat", at: 123 });
  assert.deepEqual(JSON.parse(sockets[0].sent.at(-1)!), {
    type: "heartbeat_ack",
    at: 123,
  });
  assert.equal(sockets.length, 1);
  c.stop();
});

test("returning from sleep preserves a fresh connection and reconnects a stale one with current settings", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const { c, sockets, setConfig } = setup();
  c.start();
  sockets[0].open();
  sockets[0].onmessage({ data: new Uint8Array([1, 0, 0]).buffer });
  c.recoverAfterSleep();
  assert.equal(sockets.length, 1);
  c.setBackground(true);
  for (let i = 0; i < 30; i++) {
    t.mock.timers.tick(1000);
    sockets[0].onmessage({ data: new Uint8Array([1, 0, 0]).buffer });
  }
  assert.equal(
    sockets.length,
    1,
    "waterfall inactivity must not interrupt background PCM",
  );
  setConfig({
    receiver: "france",
    frequency: 14200,
    mode: "USB",
    zoom: 6,
    lowCut: 300,
    highCut: 2100,
  });
  sockets[0].readyState = 3;
  c.recoverAfterSleep();
  assert.equal(sockets.length, 2);
  sockets[1].open();
  assert.equal(JSON.parse(sockets[1].sent[0]).frequency, 14200);
  c.stop();
  c.recoverAfterSleep();
  assert.equal(
    sockets.length,
    2,
    "user stop must never restart from visibility events",
  );
});

test("rapid VFO uses latest config within 40ms; release flush cancels old pending tune", (t) => {
  t.mock.timers.enable({
    apis: ["setTimeout", "setInterval", "Date"],
    now: 1000,
  });
  const { c, sockets, setConfig } = setup();
  const config = (frequency: number) => ({
    receiver: "france",
    frequency,
    mode: "USB",
    zoom: 7,
    lowCut: 300,
    highCut: 2100,
  });
  c.start();
  sockets[0].open();
  setConfig(config(7075));
  c.tune();
  for (let i = 1; i <= 20; i++) {
    setConfig(config(7075 + i / 1000));
    c.tune();
  }
  assert.equal(sockets[0].sent.length, 2);
  t.mock.timers.tick(39);
  assert.equal(sockets[0].sent.length, 2);
  t.mock.timers.tick(1);
  assert.equal(JSON.parse(sockets[0].sent.at(-1)!).frequency, 7075.02);
  setConfig(config(7074));
  c.tune();
  c.flushTune();
  assert.equal(JSON.parse(sockets[0].sent.at(-1)!).frequency, 7074);
  const count = sockets[0].sent.length;
  t.mock.timers.tick(1000);
  assert.equal(sockets[0].sent.length, count);
  c.stop();
});

test("receiver switch cancels pending tune and manual restart bypasses retry timeout", (t) => {
  t.mock.timers.enable({
    apis: ["setTimeout", "setInterval", "Date"],
    now: 1000,
  });
  const { c, sockets } = setup();
  c.start();
  sockets[0].open();
  c.tune();
  c.tune();
  c.switchReceiver();
  sockets[1].open();
  t.mock.timers.tick(100);
  assert.equal(sockets[1].sent.length, 1);
  sockets[1].close();
  c.stop();
  c.start();
  sockets[2].open();
  t.mock.timers.tick(1000);
  assert.equal(sockets.length, 3);
  sockets[0].open();
  sockets[0].message({ type: "tuned", frequency: 1 });
  assert.equal(sockets[0].sent.length, 2);
  c.stop();
});

test("repeated gateway transport errors never fail over to a different receiver", (t) => {
  t.mock.timers.enable({
    apis: ["setTimeout", "setInterval", "Date"],
    now: 1000,
  });
  let changes = 0;
  const { c, sockets, setConfig } = setup(() => {
    changes++;
    return true;
  });
  setConfig({
    receiver: "france",
    frequency: 14200.251,
    mode: "USB",
    zoom: 7,
    lowCut: 350,
    highCut: 2600,
  });
  c.start();
  for (let i = 0; i < 6; i++) {
    sockets[i].open();
    assert.deepEqual(JSON.parse(sockets[i].sent[0]), {
      type: "connect",
      receiver: "france",
      frequency: 14200.251,
      mode: "USB",
      zoom: 7,
      lowCut: 350,
      highCut: 2600,
    });
    sockets[i].message({
      type: "error",
      code: "connection",
      message: "Gateway interrupted",
      retryable: true,
    });
    t.mock.timers.tick(Math.min(30000, 1000 * 2 ** i));
  }
  assert.equal(changes, 0);
  c.stop();
});

test("resume waits for queued audio on an open socket, then retries only if still stale", (t) => {
  t.mock.timers.enable({
    apis: ["setTimeout", "setInterval", "Date"],
    now: 1000,
  });
  const { c, sockets } = setup();
  c.start();
  sockets[0].open();
  c.setBackground(true);
  // Sleep advances wall time without running the frozen page timers.
  t.mock.timers.setTime(301000);
  c.recoverAfterSleep();
  assert.equal(sockets.length, 1);
  sockets[0].onmessage({ data: new Uint8Array([1, 0, 1]).buffer });
  t.mock.timers.tick(5000);
  assert.equal(sockets.length, 1);
  t.mock.timers.setTime(601000);
  c.recoverAfterSleep();
  t.mock.timers.tick(4000);
  assert.equal(sockets.length, 1);
  t.mock.timers.tick(2000);
  t.mock.timers.tick(1000);
  assert.equal(
    sockets.length,
    2,
    "an open but dead stream must eventually reconnect",
  );
  sockets[1].open();
  assert.equal(JSON.parse(sockets[1].sent[0]).receiver, "france");
  assert.equal(JSON.parse(sockets[1].sent[0]).highCut, 2100);
  c.stop();
});
