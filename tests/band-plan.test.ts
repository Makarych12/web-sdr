import test from 'node:test';
import assert from 'node:assert/strict';
import { BAND_PLAN, visibleBandPlan } from '../src/bandPlan';

test('Region 1 boundaries preserve DATA transitions, 30m usage and beacon gaps', () => {
  const at = (f: number) => BAND_PLAN.find(s => s.start <= f && f < s.end)?.usage;
  assert.equal(at(7039.999), 'CW');
  assert.equal(at(7040), 'DATA');
  assert.equal(at(7055), 'SSB/DATA');
  assert.equal(at(7100), 'SSB');
  assert.equal(at(10140), 'DATA');
  assert.equal(at(14100), undefined);
  assert.equal(at(18110), undefined);
  assert.equal(at(21150), undefined);
  assert.equal(at(24930), undefined);
  assert.equal(at(28200), undefined);
  assert.equal(at(10000), undefined);
});
test('clipped overlay uses kHz scale geometry at zoom and band edges', () => {
  const clips = visibleBandPlan({ start: 7035, span: 20 });
  assert.deepEqual(clips.map(s => [s.usage, s.left, s.width]), [
    ['CW', 0, 25], ['DATA', 25, 50], ['SSB/DATA', 75, 25],
  ]);
  assert.deepEqual(visibleBandPlan({ start: 9000, span: 100 }), []);
  assert.deepEqual(visibleBandPlan({ start: 7000, span: 0 }), []);
  assert.deepEqual(visibleBandPlan({ start: NaN, span: 100 }), []);
  assert.equal(visibleBandPlan({ start: 7100, span: 1 })[0].width, 100);
});
