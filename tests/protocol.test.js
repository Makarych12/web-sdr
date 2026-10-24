import test from "node:test";
import { KiwiProtocol } from "../shared/kiwiProtocol.js";
import assert from "node:assert/strict";
import { KiwiSession, validateTune } from "../server/kiwi.js";
test("reject invalid tuning before commands reach receiver", () => {
  for (const v of [
    { frequency: NaN, mode: "AM", zoom: 6 },
    { frequency: 30001, mode: "AM", zoom: 6 },
    { frequency: 10000, mode: "IQ", zoom: 6 },
    { frequency: 10000, mode: "constructor", zoom: 6 },
    { frequency: 10000, mode: "FM", zoom: 15 },
  ])
    assert.throws(() => validateTune(v));
});
test("decode Kiwi big endian PCM, RSSI and little endian waterfall header", () => {
  const output = [];
  const s = new KiwiSession("http://example.com", (v) => output.push(v));
  const snd = Buffer.alloc(14);
  snd.write("SND");
  snd.writeUInt32LE(42, 4);
  snd.writeUInt16BE(600, 8);
  snd.writeInt16BE(-12345, 10);
  snd.writeInt16BE(23456, 12);
  s.parse(null, "SND", snd);
  assert.equal(output[0].rssi, -67);
  assert.equal(Buffer.from(output[1]).readInt16BE(1), -12345);
  const wf = Buffer.alloc(1040);
  wf.write("W/F");
  wf.writeUInt32LE(1024 * 2 ** 13, 4);
  wf.writeUInt32LE(6, 8);
  wf.writeUInt32LE(7, 12);
  wf.fill(155, 16);
  s.parse(null, "W/F", wf);
  assert.equal(output[2].start, 15000);
  assert.equal(output[2].span, 468.75);
  assert.equal(output[2].sequence, 7);
  assert.equal(output[3].length, 1025);
  s.close();
});
test("client command type cannot overwrite tuning acknowledgment", () => {
  const output = [];
  const s = new KiwiSession("http://example.com", (v) => output.push(v));
  s.apply({ type: "tune", frequency: 7074, mode: "USB", zoom: 6 });
  assert.deepEqual(output[0], {
    type: "tuned",
    frequency: 7074,
    mode: "USB",
    zoom: 6,
  });
  s.close();
});
test("custom passband reaches the actual Kiwi mod command", () => {
  const sent = [];
  const s = new KiwiSession("http://example.org", () => {});
  s.audioReady = s.waterfallReady = true;
  s.sockets = [
    { readyState: 1, send: (v) => sent.push(v), close() {} },
    { readyState: 1, send: (v) => sent.push(v), close() {} },
  ];
  s.apply({
    frequency: 7074,
    mode: "USB",
    zoom: 7,
    lowCut: 300,
    highCut: 2100,
  });
  assert.ok(
    sent.some((command) =>
      /mod=usb low_cut=300 high_cut=2100 freq=7074.000/.test(command),
    ),
  );
  for (const cuts of [
    { lowCut: 0 },
    { lowCut: -7000, highCut: 1000 },
    { lowCut: 500, highCut: 400 },
  ])
    assert.throws(() =>
      validateTune({ frequency: 10000, mode: "AM", zoom: 6, ...cuts }),
    );
  s.close();
});
test("pan and zoom only change the waterfall command, keeping audio tuned", () => {
  const sent = [];
  const s = new KiwiSession("http://example.org", () => {});
  s.audioReady = s.waterfallReady = true;
  s.sockets = [
    { readyState: 1, send: (v) => sent.push(v), close() {} },
    { readyState: 1, send: (v) => sent.push(v), close() {} },
  ];
  s.apply({
    frequency: 7074,
    mode: "USB",
    zoom: 7,
    lowCut: 300,
    highCut: 2100,
  });
  sent.length = 0;
  s.apply({
    frequency: 7074,
    mode: "USB",
    zoom: 8,
    viewCenter: 7300,
    lowCut: 300,
    highCut: 2100,
  });
  assert.deepEqual(sent, ["SET zoom=8 cf=7300.000"]);
  s.close();
});

test("AGC mode reaches Kiwi without retuning or resetting waterfall", () => {
  const sent = [];
  const s = new KiwiSession("http://example.org", () => {});
  s.audioReady = s.waterfallReady = true;
  s.sockets = [
    { readyState: 1, send: (v) => sent.push(v), close() {} },
    { readyState: 1, send: (v) => sent.push(v), close() {} },
  ];
  s.apply({ frequency: 7074, mode: "USB", zoom: 7, agc: "slow" });
  sent.length = 0;
  s.apply({ frequency: 7074, mode: "USB", zoom: 7, agc: "fast" });
  assert.deepEqual(sent, [
    "SET agc=1 hang=0 thresh=-100 slope=6 decay=100 manGain=50",
  ]);
  sent.length = 0;
  s.apply({ frequency: 7074, mode: "USB", zoom: 7, agc: "off" });
  assert.deepEqual(sent, [
    "SET agc=0 hang=0 thresh=-100 slope=6 decay=1000 manGain=50",
  ]);
  assert.throws(() =>
    validateTune({ frequency: 7074, mode: "USB", zoom: 7, agc: "invalid" }),
  );
  s.close();
});

for (const order of [
  ["SND", "W/F"],
  ["W/F", "SND"],
]) {
  test(`tuning waits for both Kiwi channel handshakes (${order.join(" first, ")})`, () => {
    const sent = { SND: [], "W/F": [] };
    const session = new KiwiSession("http://example.org", () => {});
    const sockets = Object.fromEntries(
      Object.keys(sent).map((type) => [
        type,
        {
          readyState: 1,
          send: (value) => sent[type].push(value),
          close() {},
        },
      ]),
    );
    session.sockets = [sockets.SND, sockets["W/F"]];
    session.apply({ frequency: 7074, mode: "USB", zoom: 7 });
    assert.equal(sent.SND.length + sent["W/F"].length, 0);
    for (const type of order) {
      session.parse(
        sockets[type],
        type,
        Buffer.from(
          type === "SND" ? "MSG sample_rate=12000" : "MSG wf_setup=1",
        ),
      );
      if (type === order[0]) assert.equal(sent[order[1]].length, 0);
    }
    assert.equal(sent.SND.filter((v) => v.startsWith("SET mod=")).length, 1);
    assert.equal(
      sent["W/F"].filter((v) => v.startsWith("SET zoom=")).length,
      1,
    );
    session.close();
  });
}

test("Kiwi zoom_cap overrides nominal zoom_max and clamps real commands", () => {
  const events = [],
    sent = [];
  const session = new KiwiSession("http://example.org", (v) => events.push(v));
  const socket = { readyState: 1, send: (v) => sent.push(v), close() {} };
  session.sockets = [socket, socket];
  session.parse(
    socket,
    "W/F",
    Buffer.from("MSG zoom_max=14 zoom_cap=11 wf_setup"),
  );
  assert.equal(events.filter((v) => v.type === "limits").at(-1).maxZoom, 11);
  session.apply({ frequency: 7074, mode: "USB", zoom: 14 });
  assert.ok(sent.some((v) => v.startsWith("SET zoom=11")));
  session.close();
});

test("closed Kiwi session ignores late PCM, waterfall, handshake and tune", () => {
  const output = [],
    sent = [];
  const s = new KiwiSession("http://example.org", (v) => output.push(v));
  s.close();
  const socket = { readyState: 1, send: (v) => sent.push(v) };
  s.parse(socket, "SND", Buffer.from("MSG sample_rate=12000"));
  s.parse(socket, "SND", Buffer.from("SND" + "\0".repeat(12)));
  s.parse(socket, "W/F", Buffer.from("W/F" + "\0".repeat(1037)));
  s.apply({ frequency: 14200, mode: "USB", zoom: 6 });
  assert.deepEqual(output, []);
  assert.deepEqual(sent, []);
});

test("one-Hz tuning and CW BFO preserve absolute RF passband edges", () => {
  const sent = [];
  const s = new KiwiSession("http://example.org", () => {});
  s.audioReady = true;
  s.sockets = [{ readyState: 1, send: (v) => sent.push(v), close() {} }];
  s.apply({
    frequency: 7074.251,
    mode: "USB",
    zoom: 7,
    lowCut: 300,
    highCut: 2700,
  });
  assert.ok(
    sent.includes("SET mod=usb low_cut=300 high_cut=2700 freq=7074.251"),
  );
  s.apply({
    frequency: 7074.251,
    mode: "CW",
    zoom: 7,
    lowCut: -250,
    highCut: 250,
  });
  assert.ok(sent.includes("SET mod=cw low_cut=350 high_cut=850 freq=7073.651"));
  assert.equal(7073651 + 350, 7074251 - 250);
  assert.equal(7073651 + 850, 7074251 + 250);
  s.close();
});

test("direct Kiwi protocol has no five-minute session expiry; background PCM does not require WF", (t) => {
  t.mock.timers.enable({
    apis: ["setTimeout", "setInterval", "Date"],
    now: 1000,
  });
  const output = [],
    sockets = [];
  const s = new KiwiProtocol(
    "https://example.org",
    (v) => output.push(v),
    () => {
      const socket = {
        readyState: 1,
        send() {},
        close() {
          this.readyState = 3;
        },
        on() {},
      };
      sockets.push(socket);
      return socket;
    },
  );
  s.start({
    frequency: 14200.251,
    mode: "USB",
    zoom: 6,
    lowCut: 300,
    highCut: 2700,
  });
  const snd = Buffer.alloc(14);
  snd.write("SND");
  const wf = Buffer.alloc(1040);
  wf.write("W/F");
  s.parse(sockets[0], "SND", snd);
  s.parse(sockets[1], "W/F", wf);
  s.setBackground(true);
  for (let i = 0; i < 601; i++) {
    t.mock.timers.tick(1000);
    s.parse(sockets[0], "SND", snd);
  }
  assert.equal(s.closed, false);
  assert.equal(sockets.length, 2);
  assert.equal(output.filter((v) => v.type === "error").length, 0);
  assert.equal(s.tune.frequency, 14200.251);
  assert.equal(s.tune.mode, "USB");
  assert.equal(s.tune.highCut, 2700);
  s.setBackground(false);
  t.mock.timers.tick(4000);
  assert.equal(s.closed, false, "resume allows queued waterfall events");
  s.parse(sockets[0], "SND", snd);
  s.parse(sockets[1], "W/F", wf);
  t.mock.timers.tick(1000);
  assert.equal(s.closed, false);
  s.close();
});


test("background silence preserves native sockets; foreground silence is a stream timeout", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1000 });
  const events = [], sockets = [];
  const session = new KiwiProtocol("https://example.org", v => events.push(v), () => {
    const socket = { readyState: 1, send() {}, close() { this.readyState = 3; }, on() {} };
    sockets.push(socket); return socket;
  });
  session.start({ frequency: 14200, mode: "USB", zoom: 6 });
  session.setBackground(true);
  t.mock.timers.tick(120000);
  assert.equal(session.closed, false);
  assert.equal(sockets.length, 2);
  session.setBackground(false);
  for (let i = 0; i < 6; i++) t.mock.timers.tick(1000);
  assert.equal(events.find(v => v.type === "error")?.code, "stream_timeout");
  assert.equal(session.closed, true);
});
