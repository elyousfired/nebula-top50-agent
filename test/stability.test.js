import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStability } from '../agent/stability.js';
import { DAY, SLOT } from '../agent/lib.js';

const T0 = Date.UTC(2026, 10, 1);

test('computeStability: presence, top5, streaks, current rank, trend', () => {
  // 12 photos (2 days): A always #1, B in for the first 6 then out, C only in the last 3.
  const snaps = Array.from({ length: 12 }, (_, i) => ({
    t: T0 + i * SLOT,
    top: [{ symbol: 'A', rank: 1 }, ...(i < 6 ? [{ symbol: 'B', rank: 10 }] : []), ...(i >= 9 ? [{ symbol: 'C', rank: 3 }] : [])],
  }));
  const now = T0 + 11 * SLOT;
  const r = computeStability(snaps, now, { days: 30 });
  assert.equal(r.photos, 12);
  const by = Object.fromEntries(r.tokens.map((x) => [x.symbol, x]));
  assert.equal(r.tokens[0].symbol, 'A');
  assert.equal(by.A.presence30, 1); assert.equal(by.A.top5, 1); assert.equal(by.A.rank, 1);
  assert.equal(by.A.longestDays, 2); assert.equal(by.A.currentDays, 2);
  assert.equal(by.B.presence30, 0.5); assert.equal(by.B.top5, 0); assert.equal(by.B.rank, null); assert.equal(by.B.currentDays, 0);
  assert.equal(by.C.currentDays, 0.5); assert.equal(by.C.rank, 3);
  assert.equal(by.A.daily.length, 30);
  assert.equal(by.A.daily.filter((v) => v != null).length, 2);
  // everything is inside the last 7 days -> no "before" ranks -> no trend
  assert.equal(by.A.rankTrend, null);
  // photos older than the window are ignored
  assert.equal(computeStability(snaps, now + 40 * DAY).photos, 0);
});
