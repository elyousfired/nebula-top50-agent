import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkExit, stepBox } from '../agent/boxpaper.js';

const H = 3_600_000;
const bars = (prices) => ({ t: prices.map((_, i) => i * H), h: prices.map((p) => p * 1.001), l: prices.map((p) => p * 0.999), c: prices });

test('walkExit: stop -5 %, then trailing 5 % after +5 %', () => {
  const p1 = { t: 0, entry: 100, stop: 95, peak: 100, lastT: 0 };
  assert.equal(walkExit(p1, bars([100, 98, 94, 99]), 10 * H).why, 'stop');
  const p2 = { t: 0, entry: 100, stop: 95, peak: 100, lastT: 0 };
  const x = walkExit(p2, bars([100, 104, 110, 120, 113, 112]), 10 * H);
  assert.equal(x.why, 'trailing');
  assert.ok(Math.abs(x.px - 120 * 1.001 * 0.95) < 1e-9);
});

test('stepBox: first run takes no signal; 🔴 takes none; 🟡 takes new ones once', () => {
  const sig = (t) => () => [{ t, entry: 10, high: 9.9 }];
  const first = stepBox(null, { AUSDT: { b4: {}, b1h: bars([10]) } }, 2, 100 * H, sig(99 * H));
  assert.equal(first.opened.length, 0);
  const red = stepBox(first.state, { AUSDT: { b4: {}, b1h: bars([10]) } }, 0, 102 * H, sig(101 * H));
  assert.equal(red.opened.length, 0);
  const yel = stepBox(red.state, { AUSDT: { b4: {}, b1h: bars([10]) } }, 1, 104 * H, sig(103 * H));
  assert.equal(yel.opened.length, 1);
  const again = stepBox(yel.state, { AUSDT: { b4: {}, b1h: bars([10]) } }, 1, 105 * H, sig(103 * H));
  assert.equal(again.opened.length, 0);
});
