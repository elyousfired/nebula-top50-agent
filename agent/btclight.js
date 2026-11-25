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
