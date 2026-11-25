// Paper trading of the quiet-box breakout on the alts, gated by the BTC light:
// 🟡 or 🟢 -> take every new signal with $10, 🔴 -> nothing. Exit on 1H bars: stop -5 %,
// trailing 5 % once +5 %, max 14 days. Cost 0.15 %/side (fee + slippage).
const HOUR = 3_600_000; const DAY = 24 * HOUR;
export const BET = 10; export const COST = 0.0015;

/** Walk closed 1H bars after pos.lastT; returns the exit {t, px, why} or null (still open). */
export function walkExit(pos, b, now) {
  for (let i = 0; i < b.t.length; i++) {
    const t = b.t[i];
    if (t <= pos.lastT || t + HOUR > now) continue;
    pos.lastT = t;
    if (b.l[i] <= pos.stop) return { t: t + HOUR, px: pos.stop, why: pos.stop > pos.entry * 0.95 ? 'trailing' : 'stop' };
    pos.peak = Math.max(pos.peak, b.h[i]);
    if (pos.peak >= pos.entry * 1.05) pos.stop = Math.max(pos.stop, pos.peak * 0.95);
    if (t + HOUR >= pos.t + 14 * DAY) return { t: t + HOUR, px: b.c[i], why: '14 jours' };
  }
  return null;
}

/**
 * One run. data: {SYMBOL: {b4, b1h}}; light: 0/1/2 (BTC light of the last closed day);
 * findSignals: from the benchmark. Returns { state, opened, closed }.
 */
export function stepBox(st, data, light, now, findSignals, btcDaily) {
  const state = st ? { ...st, open: [...st.open] } : { lastT: now, open: [] };
  const opened = []; const closed = [];
  // 1. exits of open positions
  for (let j = state.open.length - 1; j >= 0; j--) {
    const p = { ...state.open[j] }; const d = data[p.s];
    if (!d) { state.open[j] = p; continue; }
    const x = walkExit(p, d.b1h, now);
    if (x) {
      const usd = BET * ((x.px * (1 - COST)) / (p.entry * (1 + COST)) - 1);
      closed.push({ s: p.s, t: p.t, entry: p.entry, light: p.light, exitT: x.t, exitPx: x.px, why: x.why, usd });
      state.open.splice(j, 1);
    } else state.open[j] = p;
  }
  // 2. new signals since the last run (7 days of context so a box is not re-armed)
  if (st) {
    for (const [s, d] of Object.entries(data)) {
      for (const sg of findSignals({ symbol: s, b4: d.b4, b1h: d.b1h, btcDaily, from: now - 7 * DAY })) {
        if (sg.t <= state.lastT || sg.t > now) continue;
        if (light < 1 || state.open.some((p) => p.s === s)) continue;
        const p = { s, t: sg.t, entry: sg.entry, stop: sg.entry * 0.95, peak: sg.entry, lastT: sg.t - HOUR, light, ceil: sg.high };
        state.open.push(p); opened.push(p);
      }
    }
  }
  state.lastT = now;
  return { state, opened, closed };
}
