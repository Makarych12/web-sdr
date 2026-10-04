import test from "node:test";
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

for (const order of [["SND", "W/F"], ["W/F", "SND"]]) {
  test(`tuning waits for both Kiwi channel handshakes (${order.join(" first, ")})`, () => {
    const sent = { SND: [], "W/F": [] };
    const session = new KiwiSession("http://example.org", () => {});
    const sockets = Object.fromEntries(Object.keys(sent).map((type) => [type, {
      readyState: 1, send: (value) => sent[type].push(value), close() {},
    }]));
    session.sockets = [sockets.SND, sockets["W/F"]];
    session.apply({ frequency: 7074, mode: "USB", zoom: 7 });
    assert.equal(sent.SND.length + sent["W/F"].length, 0);
    for (const type of order) {
      session.parse(sockets[type], type, Buffer.from(type === "SND" ? "MSG sample_rate=12000" : "MSG wf_setup=1"));
      if (type === order[0]) assert.equal(sent[order[1]].length, 0);
    }
    assert.equal(sent.SND.filter((v) => v.startsWith("SET mod=")).length, 1);
    assert.equal(sent["W/F"].filter((v) => v.startsWith("SET zoom=")).length, 1);
    session.close();
  });
}

test("Kiwi zoom_cap overrides nominal zoom_max and clamps real commands", () => {
  const events = [], sent = [];
  const session = new KiwiSession("http://example.org", (v) => events.push(v));
  const socket = {readyState:1,send:(v)=>sent.push(v),close(){}};
  session.sockets=[socket,socket];
  session.parse(socket,"W/F",Buffer.from("MSG zoom_max=14 zoom_cap=11 wf_setup"));
  assert.equal(events.filter((v)=>v.type === "limits").at(-1).maxZoom,11);
  session.apply({frequency:7074,mode:"USB",zoom:14});
  assert.ok(sent.some((v)=>v.startsWith("SET zoom=11")));
  session.close();
});
