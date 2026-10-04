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
    this.onclose?.({});
  }
  message(v: any) {
    this.onmessage?.({ data: JSON.stringify(v) });
  }
}
function setup() {
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
