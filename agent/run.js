#!/usr/bin/env node
// One agent run (CI every 4h, or by hand). Idempotent and catch-up safe:
//  1. rebuilds the Top 50 (30D score, site code) for every 4H slot missed since
//     the last run (max BACKFILL_DAYS), from candles closed at that slot;
//  2. records each slot's Top 50 with its features (data/snapshots);
//  3. opens a paper trade for every strategy whose entry rule matches, follows
//     open trades on 1H candles and closes them at stop / target / time
//     (data/trades), and records each member's next-24h outcome (data/outcomes);
//  4. once per UTC day writes the leaderboard + learning report (data/reports).

import { bars as B, metrics as M, scoring as S, universe as U, squeeze as Q, bybit, strategies, btcswings } from './bench.js';
import { stepListPortfolio, markPositions } from './listpf.js';
import { pendingSlots, resolveTrade, idxAt, HOUR, DAY, monthKey } from './lib.js';
import { readJson, writeJson, appendJsonl } from './io.js';
import { writeReport } from './report.js';
import { computeStability } from './stability.js';
import { readJsonlDir } from './io.js';

bybit.setProxy(process.env.BYBIT_PROXY || 'https://nebula-benchmark.vercel.app/api/bybit');
const BACKFILL = Number(process.env.BACKFILL_DAYS || 30) * DAY;
const IV = { '60': HOUR, '240': 4 * HOUR };
const log = (...a) => console.log(new Date().toISOString(), ...a);
const slice = (b, lo, hi) => ({ t: b.t.slice(lo, hi), o: b.o.slice(lo, hi), h: b.h.slice(lo, hi), l: b.l.slice(lo, hi), c: b.c.slice(lo, hi), v: b.v.slice(lo, hi), q: b.q.slice(lo, hi) });

/** Spot klines from `fromMs` to now (pages backward, 1000 per call). */
async function klines(symbol, interval, fromMs) {
  const rows = [];
  let end = Date.now();
  while (end > fromMs) {
    const r = await bybit.bybitGet('kline', { category: 'spot', symbol, interval, limit: '1000', end: String(end) });
    const list = r.list || [];
    if (!list.length) break;
    rows.push(...list);
    if (list.length < 1000) break;
    end = Number(list[list.length - 1][0]) - IV[interval];
  }
  return B.parseKlines(rows);
}

async function main() {
  const now = Date.now();
  const state = readJson('state.json', { lastSlot: null, lastTop: [], open: [], pendingOutcomes: [], lastReportDay: null, firstSlot: null });
  const slots = pendingSlots(state.lastSlot, now, BACKFILL);
  log(`slots to process: ${slots.length}${slots.length ? ` (${new Date(slots[0]).toISOString()} → ${new Date(slots[slots.length - 1]).toISOString()})` : ''} · open trades ${state.open.length}`);

  // 1H candles for the candidate universe + every symbol with an open trade or a pending outcome.
  // From a GitHub runner Bybit answers 403: the client switches to the Frankfurt
  // proxy after 3 failed direct calls, so the first call is retried once.
  const tickers = await bybit.fetchTickers().catch(() => bybit.fetchTickers());
  const cands = U.selectUniverse(tickers, { limit: 500 }).map((t) => t.symbol);
  const need = new Set([...cands, ...state.open.map((t) => t.symbol), ...state.pendingOutcomes.flatMap((o) => o.symbols)]);
  const oldest = Math.min(slots.length ? slots[0] : now, ...state.open.map((t) => t.entryT), ...state.pendingOutcomes.map((o) => o.t));
  const from1h = oldest - 42 * DAY;
  const d1 = {};
  let failed = 0;
  await bybit.pool([...need], async (s) => { d1[s] = await klines(s, '60', from1h); }, { concurrency: 6 });
  for (const s of need) if (!d1[s]) failed++;
  log(`1H candles: ${Object.keys(d1).length}/${need.size} symbols (${failed} failed) · route ${bybit.currentRoute()}`);

  // Top 50 for each slot.
  const slotData = [];
  for (const t of slots) {
    const ms = [];
    const ctx = {};
    for (const s of cands) {
      const b1 = d1[s];
      if (!b1) continue;
      const k = idxAt(b1.t, t - HOUR);
      if (k < 720 || b1.t[k] + HOUR !== t) continue;
      const m = M.computeTokenMetrics({ symbol: s, bars15: slice(b1, k - 99, k + 1), bars60: slice(b1, Math.max(0, k - 999), k + 1), ticker: null, now: t });
      if (!m) continue;
      ms.push(m);
      let q24 = 0; let q7 = 0; let ss = 0;
      for (let i = k - 167; i <= k; i++) { q7 += b1.q[i]; if (i > k - 24) q24 += b1.q[i]; }
      for (let i = k - 71; i <= k; i++) { const r = Math.log(b1.c[i] / b1.c[i - 1]); ss += r * r; }
      ctx[s] = { k, close: b1.c[k], vol24_7d: q7 > 0 ? q24 / (q7 / 7) : null, volat3d: Math.sqrt(ss / 72) };
    }
    if (ms.length < 100) { log(`slot ${new Date(t).toISOString()}: only ${ms.length} tokens, skipped`); continue; }
    slotData.push({ t, top: S.topList(S.scoreUniverse(ms), 'month', 50, 'score'), ctx });
  }

  // 4H candles (box, quiet, ATR) for every symbol that made a Top 50.
  const topSyms = new Set(slotData.flatMap((x) => x.top.map((m) => m.symbol)));
  const d4 = {};
  await bybit.pool([...topSyms], async (s) => { const b4 = await klines(s, '240', oldest - 170 * DAY); d4[s] = { b4, rng: Q.rngSeries(b4) }; }, { concurrency: 6 });

  let prevTop = new Set(state.lastTop);
  let opened = 0;
  const isOpen = new Set(state.open.map((tr) => `${tr.strategy}|${tr.symbol}`));
  for (const { t, top, ctx } of slotData) {
    const vs = top.map((x) => ctx[x.symbol].volat3d).sort((a, b) => a - b);
    const rows = [];
    for (const x of top) {
      const e = ctx[x.symbol];
      const g = d4[x.symbol];
      const j = g ? idxAt(g.b4.t, t) : -1;
      const box = j >= 1 ? Q.boxAt(g.b4, j - 1) : null;
      e.atr = j >= 0 ? Q.atrAt(g.b4, j) : null;
      e.quiet = j >= 1 ? Q.quietPctAt(g.rng, j - 1) : null;
      e.ceil = box ? box.high : Infinity;
      e.newEntry = prevTop.size > 0 && !prevTop.has(x.symbol);
      e.volatPct = vs.indexOf(e.volat3d) / Math.max(1, vs.length - 1);
      rows.push({
        symbol: x.symbol, rank: x.rank, score: x.scores.month, phase: x.phase, price: e.close,
        h1: x.perf.h1, h4: x.perf.h4, d1: x.perf.d1, w1: x.perf.w1, d30: x.perf.d30,
        pullbackFromHigh: x.pullbackFromHigh, distEma20: x.distEma20, slopeEma20: x.slopeEma20,
        vol24_7d: e.vol24_7d, volat3d: e.volat3d, quiet: e.quiet, distCeil14: box ? e.close / box.high - 1 : null,
        atr: e.atr, newEntry: e.newEntry,
      });
      if (!(e.atr > 0)) continue;
      for (const [fname, fn] of Object.entries(strategies.FAMILIES)) {
        if (!fn(x, e)) continue;
        for (const [xname, ex] of Object.entries(strategies.EXITS)) {
          const key = `${fname} || ${xname}`;
          if (isOpen.has(`${key}|${x.symbol}`)) continue;
          const stop = e.close - ex.k * e.atr;
          state.open.push({ strategy: key, family: fname, exit: xname, symbol: x.symbol, entryT: t, entry: e.close, stop, target: ex.m == null ? null : e.close + ex.m * (e.close - stop), trail: ex.trail ? ex.trail * e.atr : null, expires: t + ex.maxH * HOUR });
          isOpen.add(`${key}|${x.symbol}`);
          opened++;
        }
      }
    }
    const cur = new Set(top.map((x) => x.symbol));
    appendJsonl(`snapshots/${monthKey(t)}.jsonl`, [{ t, iso: new Date(t).toISOString(), entered: [...cur].filter((s) => prevTop.size && !prevTop.has(s)), left: [...prevTop].filter((s) => !cur.has(s)), top: rows }]);
    state.pendingOutcomes.push({ t, symbols: [...cur] });
    prevTop = cur;
    state.lastSlot = t;
    state.firstSlot ??= t;
  }
  state.lastTop = [...prevTop];

  // Follow open trades.
  const stillOpen = [];
  const closed = [];
  for (const tr of state.open) {
    const b1 = d1[tr.symbol];
    if (!b1) { stillOpen.push(tr); continue; }
    const r = resolveTrade(tr, b1, now);
    if (r.closed) closed.push({ ...tr, ...r, entryIso: new Date(tr.entryT).toISOString(), exitIso: new Date(r.exitT).toISOString() });
    else stillOpen.push({ ...tr, mark: r.mark, markR: r.R });
  }
  state.open = stillOpen;
  const byMonth = {};
  for (const c of closed) (byMonth[monthKey(c.exitT)] ||= []).push(c);
  for (const [m, rows] of Object.entries(byMonth)) appendJsonl(`trades/${m}.jsonl`, rows);

  // Next-24h outcome of every Top 50 member (for the learning part of the report).
  const pending = [];
  const outs = {};
  for (const o of state.pendingOutcomes) {
    if (o.t + DAY + HOUR > now) { pending.push(o); continue; }
    for (const s of o.symbols) {
      const b = d1[s];
      if (!b) continue;
      const k0 = idxAt(b.t, o.t - HOUR); const k1 = idxAt(b.t, o.t + DAY - HOUR);
      if (k0 < 0 || k1 <= k0) continue;
      let hi = -Infinity; let lo = Infinity;
      for (let i = k0 + 1; i <= k1; i++) { hi = Math.max(hi, b.h[i]); lo = Math.min(lo, b.l[i]); }
      (outs[monthKey(o.t)] ||= []).push({ t: o.t, symbol: s, r24h: b.c[k1] / b.c[k0] - 1, max24: hi / b.c[k0] - 1, min24: lo / b.c[k0] - 1 });
    }
  }
  state.pendingOutcomes = pending;
  for (const [m, rows] of Object.entries(outs)) appendJsonl(`outcomes/${m}.jsonl`, rows);

  // "Reliable BTC followers" list of the site's /btc page, recomputed every run:
  // paper-buy tokens that enter it, sell tokens that leave it (data/listpf.json, data/listpf/).
  try {
    const site = process.env.SITE_URL || 'https://nebula-benchmark.vercel.app';
    const f = await (await fetch(`${site}/api/followers`, { signal: AbortSignal.timeout(60_000) })).json();
    const list = f.tokens.filter((t) => btcswings.reliability(t, f.waves, f.btc).ok).map((t) => t.symbol).sort();
    const px = Object.fromEntries(tickers.map((t) => [t.symbol, Number(t.lastPrice)]));
    const step = stepListPortfolio(state.listPf, list, px, now);
    state.listPf = step.pf;
    if (step.closed.length) appendJsonl(`listpf/${monthKey(now)}.jsonl`, step.closed);
    const all = readJsonlDir('listpf');
    const open = markPositions(state.listPf, px, now);
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    writeJson('listpf.json', {
      at: new Date(now).toISOString(), startT: state.listPf.startT, list,
      entered: step.opened, left: step.closed.map((c) => c.symbol),
      open: open.sort((a, b) => (b.ret ?? -9) - (a.ret ?? -9)),
      openAvg: mean(open.map((o) => o.ret).filter((x) => x != null)),
      openBtcAvg: mean(open.map((o) => o.btcRet).filter((x) => x != null)),
      closed: { n: all.length, avg: mean(all.map((c) => c.ret)), win: all.length ? all.filter((c) => c.ret > 0).length / all.length : null, btcAvg: mean(all.map((c) => c.btcRet).filter((x) => x != null)) },
    });
    log(`list portfolio: ${list.length} in list · +${step.opened.length} / -${step.closed.length} · open ${open.length}`);
  } catch (e) {
    log(`list portfolio skipped: ${e.message}`);
  }

  // Stable Top 50 (presence over 30 days), read by the site's /stable page.
  writeJson('stability.json', computeStability(readJsonlDir('snapshots'), now));

  // Daily report (once per UTC day).
  const today = Math.floor(now / DAY) * DAY;
  if (state.lastReportDay !== today && state.lastSlot != null) {
    const file = writeReport({ at: now, state });
    state.lastReportDay = today;
    log(`report written: ${file}`);
  }
  writeJson('state.json', state);
  log(`done · slots ${slotData.length} · opened ${opened} · closed ${closed.length} · open ${state.open.length} · outcomes ${Object.values(outs).flat().length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
