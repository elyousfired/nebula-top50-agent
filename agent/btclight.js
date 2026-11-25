// Paper trading of the BTC/ETH trend light (same rule as /btc and backtest/btclight.js, "A"):
// e = close > EMA50 daily · h = close > last top (highest high of the 20 days before the
// lowest low of the last 60 days). 🟢 both, 🟡 one, 🔴 none. Signal on the closed daily
// candle (00:00 UTC); fill at the NEXT day's open. Buy all at 🟢, sell all at 🔴, 🟡 keeps.
// Cost per side: 0.1 % fee + 0.05 % slippage.
const DAY = 86_400_000;
export const COST = 0.0015;
export const LIGHT = ['🔴', '🟡', '🟢'];

/** Light of closed bar i (b = {t,o,h,l,c} arrays, ascending). */
export function lightAt(b, i) {
  let ema = b.c[0];
  for (let k = 1; k <= i; k++) ema += (2 / 51) * (b.c[k] - ema);
  let lo = -1;
  for (let k = Math.max(0, i - 60); k < i; k++) if (lo < 0 || b.l[k] < b.l[lo]) lo = k;
  let top = 0;
  for (let k = Math.max(0, lo - 20); k < lo; k++) top = Math.max(top, b.h[k]);
  const e = b.c[i] > ema; const h = top > 0 && b.c[i] > top;
  return { n: e + h, e, h, ema, top: top || null, close: b.c[i] };
}

/** ETH/BTC ratio above its EMA50 at closed day t (eth/btc bars share daily timestamps). */
export function ethUpAt(btc, eth, t) {
  const em = new Map(eth.t.map((x, i) => [x, eth.c[i]]));
  let e = null; let r = null;
  for (let i = 0; i < btc.t.length && btc.t[i] <= t; i++) {
    const p = em.get(btc.t[i]); if (!p) continue;
    r = p / btc.c[i]; e = e == null ? r : e + (2 / 51) * (r - e);
  }
  return { up: r != null && r > e, ratio: r, ema: e };
}

/**
 * Rotation: in/out from the BTC light (🟢 in, 🔴 out); while in, hold ETH when ETH/BTC is
 * above its EMA50, else BTC. Signal at the daily close, fill at the next day's open,
 * COST per side (a switch BTC<->ETH = sell + buy).
 */
export function stepRotation(st, btc, eth, now) {
  const rows = [];
  const closed = btc.t.map((t, i) => [t, i]).filter(([t]) => t + DAY <= now);
  if (!closed.length) return { state: st, rows };
  const eo = new Map(eth.t.map((x, i) => [x, eth.o[i]]));
  const ec = new Map(eth.t.map((x, i) => [x, eth.c[i]]));
  const state = st ? { ...st } : { lastDay: closed[closed.length - 1][0] - DAY, light: null, hold: 'cash', units: 0, cash: 1, startPx: null, peak: 1, dd: 0, trades: 0 };
  const open = (a, i) => (a === 'BTC' ? btc.o[i] : eo.get(btc.t[i]));
  for (const [t, i] of closed) {
    if (t <= state.lastDay) continue;
    if (i + 1 >= btc.t.length || !eo.get(btc.t[i + 1])) break;
    const L = lightAt(btc, i); const R = ethUpAt(btc, eth, t);
    if (state.startPx == null) state.startPx = btc.o[i + 1];
    let inPos = state.hold !== 'cash';
    if (!inPos && L.n === 2) inPos = true; else if (inPos && L.n === 0) inPos = false;
    const want = inPos ? (R.up ? 'ETH' : 'BTC') : 'cash';
    let action = 'aucune'; let fillPx = null;
    if (want !== state.hold) {
      if (state.hold !== 'cash') { state.cash = state.units * open(state.hold, i + 1) * (1 - COST); state.units = 0; }
      if (want !== 'cash') { fillPx = open(want, i + 1); state.units = (state.cash * (1 - COST)) / fillPx; state.cash = 0; if (state.hold === 'cash') state.trades++; }
      action = want === 'cash' ? 'vente' : state.hold === 'cash' ? `achat ${want}` : `bascule ${state.hold}→${want}`;
      if (want === 'cash') fillPx = open(state.hold, i + 1);
      state.hold = want;
    }
    const prev = state.light;
    rows.push({ t: now, day: new Date(t).toISOString().slice(0, 10), light: LIGHT[L.n], prev: prev == null ? null : LIGHT[prev], changed: (prev != null && prev !== L.n) || action !== 'aucune', action, fillPx, hold: state.hold, ethBtc: R.ratio, ethBtcEma50: R.ema, reason: `feu BTC ${LIGHT[L.n]} · ETH/BTC ${R.ratio?.toFixed(5)} ${R.up ? '>' : '<'} EMA50 ${R.ema?.toFixed(5)} → ${state.hold}` });
    state.light = L.n; state.lastDay = t;
  }
  const lastPx = state.hold === 'BTC' ? btc.c[btc.c.length - 1] : state.hold === 'ETH' ? ec.get(btc.t[btc.t.length - 1]) ?? eth.c[eth.c.length - 1] : null;
  const eqNow = state.hold === 'cash' ? state.cash : state.units * lastPx * (1 - COST);
  state.peak = Math.max(state.peak, eqNow); state.dd = Math.min(state.dd, eqNow / state.peak - 1);
  state.eqNow = eqNow; state.holdNow = state.startPx ? btc.c[btc.c.length - 1] / state.startPx : 1;
  return { state, rows };
}

/**
 * Advance one asset's paper state over every newly closed day. Returns the log rows
 * (one per processed day) and the state. A day is processed only once the next day's
 * candle has opened (its open is the fill price).
 */
export function stepLight(st, b, now) {
  const rows = [];
  const s = st ? { ...st } : null;
  const closed = b.t.map((t, i) => [t, i]).filter(([t]) => t + DAY <= now);
  if (!closed.length) return { state: st, rows };
  // First run: start from the latest closed day only (no back history).
  let state = s || { lastDay: closed[closed.length - 1][0] - DAY, light: null, pos: false, entryPx: null, eq: 1, startPx: null, peak: 1, dd: 0, trades: 0 };
  for (const [t, i] of closed) {
    if (t <= state.lastDay) continue;
    if (i + 1 >= b.t.length) break; // next candle not open yet
    const L = lightAt(b, i);
    const px = b.o[i + 1];
    if (state.startPx == null) state.startPx = px;
    let action = 'aucune';
    if (!state.pos && L.n === 2) { state.pos = true; state.entryPx = px * (1 + COST); state.trades++; action = 'achat'; }
    else if (state.pos && L.n === 0) { state.eq *= (px * (1 - COST)) / state.entryPx; state.pos = false; state.entryPx = null; action = 'vente'; }
    const prev = state.light;
    const reason = `clôture ${L.close} · EMA50 ${Math.round(L.ema)} ${L.e ? '✅' : '❌'} · sommet ${L.top ? Math.round(L.top) : '—'} ${L.h ? '✅' : '❌'}`;
    rows.push({ t: now, day: new Date(t).toISOString().slice(0, 10), light: LIGHT[L.n], prev: prev == null ? null : LIGHT[prev], changed: prev != null && prev !== L.n, action, fillPx: action === 'aucune' ? null : px, close: L.close, ema50: L.ema, top: L.top, reason });
    state.light = L.n; state.lastDay = t;
  }
  // Mark to market with the latest price.
  const last = b.c[b.c.length - 1];
  const eqNow = state.pos ? state.eq * (last * (1 - COST)) / state.entryPx : state.eq;
  state.peak = Math.max(state.peak, eqNow); state.dd = Math.min(state.dd, eqNow / state.peak - 1);
  state.eqNow = eqNow; state.holdNow = state.startPx ? last / state.startPx : 1; state.last = last;
  return { state, rows };
}
