// Pure helpers of the agent (tested in test/lib.test.js).

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const SLOT = 4 * HOUR;
export const FEE = 0.001; // 0.1% per side

/**
 * 4H slots (UTC grid) strictly after `last` and <= `now`, at most `maxBack` ms
 * back. First run (`last` null): the whole `maxBack` window, so the agent
 * starts with history instead of an empty leaderboard.
 */
export function pendingSlots(last, now, maxBack = 30 * DAY) {
  const latest = Math.floor(now / SLOT) * SLOT;
  let t = Math.max(last == null ? -Infinity : last, latest - maxBack) + SLOT;
  t = Math.ceil(t / SLOT) * SLOT;
  const out = [];
  for (; t <= latest; t += SLOT) out.push(t);
  return out;
}

/** Last index with arr[i] <= x, or -1. */
export function idxAt(arr, x) {
  let lo = 0; let hi = arr.length - 1; let r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}

/**
 * Follow a paper trade on 1H candles closed by `now`.
 * trade: { entryT (close time of the entry candle), entry, stop, target|null, expires }.
 * Same candle touching stop and target -> stop. Returns
 *   { closed: true, outcome: 'SL'|'TP'|'TIME', exitPx, exitT, R, ret }  or
 *   { closed: false, mark, R } (mark-to-market at the last closed candle).
 */
export function resolveTrade(tr, b1, now) {
  const risk = tr.entry - tr.stop;
  const res = (px, outcome, exitT) => {
    const ret = (px * (1 - FEE)) / (tr.entry * (1 + FEE)) - 1;
    return { closed: true, outcome, exitPx: px, exitT, ret, R: ret / (risk / tr.entry) };
  };
  let lastClose = null;
  let lastT = null;
  for (let i = Math.max(0, idxAt(b1.t, tr.entryT - 1) + 1); i < b1.t.length; i++) {
    const t = b1.t[i];
    if (t < tr.entryT) continue;
    if (t + HOUR > now) break; // not closed yet
    if (t >= tr.expires) return res(lastClose ?? tr.entry, 'TIME', lastT ?? tr.entryT);
    if (b1.l[i] <= tr.stop) return res(tr.stop, 'SL', t + HOUR);
    if (tr.target != null && b1.h[i] >= tr.target) return res(tr.target, 'TP', t + HOUR);
    lastClose = b1.c[i];
    lastT = t + HOUR;
  }
  if (lastT != null && lastT >= tr.expires) return res(lastClose, 'TIME', lastT);
  const mark = lastClose ?? tr.entry;
  return { closed: false, mark, R: (mark - tr.entry) / risk };
}

/** Split into 5 equal groups by `f` (ascending). */
export function quintiles(rows, f) {
  const a = rows.filter((r) => r[f] != null && Number.isFinite(r[f])).sort((x, y) => x[f] - y[f]);
  return [0, 1, 2, 3, 4].map((q) => a.slice(Math.floor((a.length * q) / 5), Math.floor((a.length * (q + 1)) / 5)));
}

export const median = (a) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
export const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
export const monthKey = (t) => new Date(t).toISOString().slice(0, 7);
