import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepListPortfolio, markPositions } from '../agent/listpf.js';

test('stepListPortfolio: buy entries, sell exits, keep the rest', () => {
  let r = stepListPortfolio(null, ['A', 'B'], { A: 10, B: 20, BTCUSDT: 100 }, 1);
  assert.deepEqual(r.opened, ['A', 'B']);
  assert.equal(r.closed.length, 0);
  // B leaves, C enters, A stays
  r = stepListPortfolio(r.pf, ['A', 'C'], { A: 11, B: 30, C: 5, BTCUSDT: 110 }, 2);
  assert.deepEqual(r.opened, ['C']);
  assert.equal(r.closed.length, 1);
  assert.equal(r.closed[0].symbol, 'B');
  assert.ok(Math.abs(r.closed[0].ret - ((30 * 0.999) / (20 * 1.001) - 1)) < 1e-12);
  assert.ok(Math.abs(r.closed[0].btcRet - 0.1) < 1e-12);
  assert.deepEqual(Object.keys(r.pf.positions).sort(), ['A', 'C']);
  assert.equal(r.pf.startT, 1);
  // no price -> not opened
  assert.deepEqual(stepListPortfolio(r.pf, ['A', 'C', 'D'], { A: 1, C: 1, BTCUSDT: 1 }, 3).opened, []);
  const m = markPositions(r.pf, { A: 12, C: 5, BTCUSDT: 120 }, 2 + 86_400_000);
  assert.equal(m.length, 2);
  assert.ok(m.find((x) => x.symbol === 'A').ret > 0.19);
});
