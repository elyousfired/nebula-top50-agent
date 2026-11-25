import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepLight, lightAt, COST } from '../agent/btclight.js';

const DAY = 86_400_000;
// 120 days falling (low on day 99), then rising hard: the light must go 🔴 -> 🟢.
function bars(n) {
  const b = { t: [], o: [], h: [], l: [], c: [] };
  for (let i = 0; i < n; i++) {
    const c = i < 100 ? 200 - i : 100 + (i - 99) * 6;
    b.t.push(i * DAY); b.o.push(c); b.h.push(c + 1); b.l.push(c - 1); b.c.push(c);
  }
  return b;
}

test('lightAt is red in the fall, green after the breakout', () => {
  const b = bars(140);
  assert.equal(lightAt(b, 90).n, 0);
  assert.equal(lightAt(b, 139).n, 2);
});

test('stepLight fills at the next open, logs once per day, no double processing', () => {
  const b = bars(140);
  const cut = (k) => b[k].slice(0, 92); // day 91 = today's candle, open but not closed
  const first = stepLight(null, { t: cut('t'), o: cut('o'), h: cut('h'), l: cut('l'), c: cut('c') }, 91 * DAY + 1);
  assert.equal(first.rows.length, 1);
  assert.equal(first.rows[0].light, '🔴');
  const now = 140 * DAY + 1;
  const r = stepLight(first.state, b, now);
  const buy = r.rows.find((x) => x.action === 'achat');
  assert.ok(buy, 'a buy happened');
  const i = b.t.indexOf(Date.parse(`${buy.day}T00:00:00Z`));
  assert.equal(buy.fillPx, b.o[i + 1]);
  assert.ok(Math.abs(r.state.entryPx - b.o[i + 1] * (1 + COST)) < 1e-9);
  assert.ok(r.rows.some((x) => x.changed));
  const again = stepLight(r.state, b, now);
  assert.equal(again.rows.length, 0);
});
