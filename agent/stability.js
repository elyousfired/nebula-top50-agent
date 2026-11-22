// "Stable" Top 50: how long each token stayed in the Top 50 (30D score) over
// the last 30 days, from the 4H snapshots. Pure function (tested).

import { DAY, SLOT } from './lib.js';

/**
 * snaps: [{ t, top: [{ symbol, rank }] }] sorted by t.
 * Returns { at, photos, from, tokens: [...] } sorted by 30-day presence, where
 * each token has presence30 / presence7 / top5 (0..1), avgRank (while in),
 * rank (current or null), longestDays / currentDays (continuous presence),
 * rankTrend (avg rank last 7d − avg rank before: negative = climbing) and
 * daily (30 values: average rank that UTC day, null when absent).
 */
export function computeStability(snaps, now, { days = 30 } = {}) {
  const from = now - days * DAY;
  const S = snaps.filter((s) => s.t > from && s.t <= now);
  if (!S.length) return { at: now, photos: 0, from, tokens: [] };
  const last = S[S.length - 1];
  const S7 = S.filter((s) => s.t > now - 7 * DAY);
  const g = new Map();
  const get = (sym) => {
    if (!g.has(sym)) g.set(sym, { symbol: sym, n: 0, n7: 0, n5: 0, rankSum: 0, r7: [], rOld: [], cur: 0, longest: 0, prev: -1, days: new Map() });
    return g.get(sym);
  };
  S.forEach((s, i) => {
    for (const r of s.top) {
      const x = get(r.symbol);
      x.n++;
      x.rankSum += r.rank;
      if (r.rank <= 5) x.n5++;
      if (s.t > now - 7 * DAY) { x.n7++; x.r7.push(r.rank); } else x.rOld.push(r.rank);
      x.cur = x.prev === i - 1 ? x.cur + 1 : 1;
      x.prev = i;
      x.longest = Math.max(x.longest, x.cur);
      const d = Math.floor(s.t / DAY);
      const dd = x.days.get(d) || [0, 0];
      x.days.set(d, [dd[0] + r.rank, dd[1] + 1]);
    }
  });
  const lastRank = new Map(last.top.map((r) => [r.symbol, r.rank]));
  const firstDay = Math.floor(now / DAY) - days + 1;
  const avg = (a) => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : null);
  const tokens = [...g.values()].map((x) => {
    const a7 = avg(x.r7); const aOld = avg(x.rOld);
    return {
      symbol: x.symbol,
      presence30: x.n / S.length,
      presence7: S7.length ? x.n7 / S7.length : 0,
      top5: x.n5 / S.length,
      avgRank: x.rankSum / x.n,
      rank: lastRank.get(x.symbol) ?? null,
      longestDays: (x.longest * SLOT) / DAY,
      currentDays: x.prev === S.length - 1 ? (x.cur * SLOT) / DAY : 0,
      rankTrend: a7 != null && aOld != null ? a7 - aOld : null,
      daily: Array.from({ length: days }, (_, k) => { const v = x.days.get(firstDay + k); return v ? Math.round((v[0] / v[1]) * 10) / 10 : null; }),
    };
  }).sort((a, b) => b.presence30 - a.presence30 || a.avgRank - b.avgRank);
  return { at: now, lastPhoto: last.t, photos: S.length, from, days, tokens };
}
