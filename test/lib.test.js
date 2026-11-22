import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingSlots, resolveTrade, quintiles, HOUR, DAY, SLOT } from '../agent/lib.js';

const T0 = Date.UTC(2026, 10, 1);

test('pendingSlots: missed 4H slots, capped', () => {
  assert.deepEqual(pendingSlots(T0, T0 + 9 * HOUR), [T0 + SLOT, T0 + 2 * SLOT]);
  assert.deepEqual(pendingSlots(T0 + 2 * SLOT, T0 + 9 * HOUR), []);
  assert.equal(pendingSlots(null, T0, 2 * DAY).length, 12); // first run: whole backfill window
  assert.equal(pendingSlots(null, T0, 2 * DAY)[11], T0);
  assert.equal(pendingSlots(T0 - 100 * DAY, T0, 30 * DAY).length, 30 * 6);
});

const bars = (rows, t0 = T0) => {
  const b = { t: [], o: [], h: [], l: [], c: [], v: [], q: [] };
  rows.forEach(([h, l, c], i) => { b.t.push(t0 + i * HOUR); b.o.push(c); b.h.push(h); b.l.push(l); b.c.push(c); b.v.push(1); b.q.push(1); });
  return b;
};
const flat = (n) => Array.from({ length: n }, () => [100.5, 99.5, 100]);

test('resolveTrade: TP, SL, same candle, time, still open', () => {
  const tr = { entryT: T0 + HOUR, entry: 100, stop: 95, target: 110, expires: T0 + HOUR + 10 * HOUR };
  const now = T0 + 30 * HOUR;
  const tp = resolveTrade(tr, bars([...flat(3), [111, 99, 108], ...flat(30)]), now);
  assert.equal(tp.outcome, 'TP'); assert.ok(Math.abs(tp.R - 2) < 0.1);
  const sl = resolveTrade(tr, bars([...flat(3), [100, 94, 95], ...flat(30)]), now);
  assert.equal(sl.outcome, 'SL'); assert.ok(Math.abs(sl.R + 1) < 0.1);
  assert.equal(resolveTrade(tr, bars([...flat(3), [111, 94, 100], ...flat(30)]), now).outcome, 'SL');
  // candle 0 is the entry candle (closes at entryT): a low there must not count
  assert.equal(resolveTrade(tr, bars([[100, 90, 100], ...flat(40)]), now).outcome, 'TIME');
  const open = resolveTrade(tr, bars(flat(40)), T0 + 5 * HOUR);
  assert.equal(open.closed, false); assert.equal(open.mark, 100);
});

test('quintiles: 5 equal groups ascending', () => {
  const q = quintiles(Array.from({ length: 10 }, (_, i) => ({ x: 10 - i })), 'x');
  assert.deepEqual(q.map((g) => g.map((r) => r.x)), [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]]);
});

test('resolveTrade: trailing stop follows the highest high', () => {
  const tr = { entryT: T0 + HOUR, entry: 100, stop: 90, target: null, trail: 5, expires: T0 + 100 * HOUR };
  // rises to 120, then drops to 114 -> trail stop at 115 hit
  const b = bars([[100.5, 99.5, 100], [110, 100, 109], [120, 109, 119], [119, 114, 115], ...flat(10)]);
  const r = resolveTrade(tr, b, T0 + 30 * HOUR);
  assert.equal(r.outcome, 'TRAIL');
  assert.equal(r.exitPx, 115);
  assert.ok(r.R > 1.4);
});
