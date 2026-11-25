// Daily report: strategy leaderboard (paper trades, in R) + what separated the
// Top 50 members that rose. Writes data/reports/YYYY-MM-DD.md, data/LATEST.md
// and data/leaderboard.json.

import { rr } from './bench.js';
import { readJsonlDir, readJson, writeText, writeJson } from './io.js';
import { DAY, dayKey, quintiles, median } from './lib.js';

const f2 = (x, d = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));
const pc = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`);
const sh = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const short = (s) => s.replace('USDT', '');

const FEATURES = {
  rank: 'Rang', score: 'Score 30D', d1: 'Perf 24h', w1: 'Perf 7J', d30: 'Perf 30J', distEma20: 'Écart EMA20 4H',
  vol24_7d: 'Volume 24h / moy 7J', volat3d: 'Volatilité 3J', quiet: 'Quiet %', distCeil14: 'Écart plafond 14J', pullbackFromHigh: 'Écart plus haut 30J',
};

export function writeReport({ at, state }) {
  const trades = readJsonlDir('trades');
  const snaps = readJsonlDir('snapshots');
  const outcomes = readJsonlDir('outcomes');
  const day = dayKey(at - DAY);
  const L = [];

  L.push(`# Agent Top 50 — rapport du ${dayKey(at)} (UTC)`, '');
  L.push(`Suivi depuis ${state.firstSlot ? new Date(state.firstSlot).toISOString().slice(0, 16) : '—'} UTC · ${snaps.length} photos du Top 50 (toutes les 4h) · ${trades.length} trades papier clôturés · ${state.open.length} ouverts.`, '');
  L.push('> Trades papier uniquement (aucun ordre réel). Frais 0,1 %/côté inclus, pas de slippage. R = distance entrée → stop.', '');

  // Top 50 changes over the last 24h.
  // Net change: current Top 50 vs the photo ~24h earlier (not the 4h churn around rank 50).
  const cur = snaps.length ? snaps[snaps.length - 1] : null;
  const prev = cur ? [...snaps].reverse().find((s) => s.t <= cur.t - DAY) : null;
  const curSet = new Set(cur ? cur.top.map((r) => r.symbol) : []);
  const prevSet = new Set(prev ? prev.top.map((r) => r.symbol) : []);
  const entered = prev ? [...curSet].filter((s) => !prevSet.has(s)) : [];
  const left = prev ? [...prevSet].filter((s) => !curSet.has(s)) : [];
  L.push('## Top 50 — dernières 24h', '');
  if (cur) L.push(`Dernière photo ${cur.iso.slice(0, 16)} UTC · top 10 : ${cur.top.slice(0, 10).map((r) => `#${r.rank} ${short(r.symbol)}`).join(', ')}`);
  L.push(`Entrés (${entered.length}) : ${entered.map(short).join(', ') || '—'}`, `Sortis (${left.length}) : ${left.map(short).join(', ') || '—'}`, '');

  // Paper portfolio on the reliable BTC followers list (/btc), refreshed every 4h.
  const lp = readJson('listpf.json', null);
  if (lp) {
    L.push('## Portefeuille « tokens fiables » (liste /btc, mise à jour toutes les 4h)', '');
    L.push(`Depuis ${new Date(lp.startT).toISOString().slice(0, 16)} UTC · ${lp.list.length} tokens dans la liste · entrés ${lp.entered.map(short).join(', ') || '—'} · sortis ${lp.left.map(short).join(', ') || '—'}.`);
    L.push(`Ouverts : ${lp.open.length}, moyenne ${pc(lp.openAvg)} (BTC sur la même période ${pc(lp.openBtcAvg)}) · clôturés : ${lp.closed.n}, moyenne ${pc(lp.closed.avg)}, gagnants ${sh(lp.closed.win)} (BTC ${pc(lp.closed.btcAvg)}).`, '');
  }

  // Paper trend light on BTC / ETH.
  const bl = readJson('btclight.json', null);
  if (bl) {
    L.push('## Feu BTC / ETH (papier : achat à 🟢, vente à 🔴, au open du lendemain, 0,15 %/côté)', '');
    for (const [sym, s] of Object.entries(bl)) {
      if (!s) continue;
      L.push(`- **${short(sym)}** : feu ${['🔴', '🟡', '🟢'][s.light] ?? '—'} · ${s.pos ? `en position depuis ${f2(s.entryPx, 2)}` : 'hors marché'} · stratégie ${pc((s.eqNow ?? 1) - 1)} (max DD ${pc(s.dd)}) · acheté et gardé ${pc((s.holdNow ?? 1) - 1)} · ${s.trades} entrée(s)`);
    }
    L.push('');
  }

  // Residual signal test: tokens above their expected move (vs BTC) 2 days in a row,
  // do they do better over the next 3 days than the rest of the list?
  const res = readJsonlDir('residual');
  const days = [...new Set(res.map((r) => r.day))].sort();
  L.push('## Signal « au-dessus de l\'attendu » (réel 24 h > Ampl. × BTC)', '');
  if (days.length < 6) {
    L.push(`Collecte en cours : ${days.length} jour(s) enregistré(s), il en faut au moins 6 pour mesurer.`, '');
  } else {
    const by = new Map(res.map((r) => [`${r.day}|${r.symbol}`, r]));
    const sig = []; const rest = [];
    for (let i = 1; i + 3 < days.length; i++) {
      const d0 = days[i]; const dPrev = days[i - 1]; const d3 = days[i + 3];
      for (const r of res.filter((x) => x.day === d0)) {
        const prev = by.get(`${dPrev}|${r.symbol}`); const fut = by.get(`${d3}|${r.symbol}`);
        if (!prev || !fut || !(r.price > 0)) continue;
        const fwd = fut.price / r.price - 1;
        (r.ecart > 0 && prev.ecart > 0 ? sig : rest).push(fwd);
      }
    }
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    L.push(`${days.length} jours · 2 jours de suite au-dessus de l'attendu : ${sig.length} cas, moyenne 3 jours après ${pc(avg(sig))} · les autres : ${rest.length} cas, ${pc(avg(rest))}.`, '');
  }

  // Leaderboard.
  const keys = [...new Set([...trades.map((t) => t.strategy), ...state.open.map((t) => t.strategy)])];
  const win = (ms) => (t) => t.exitT > at - ms && t.exitT <= at;
  const board = keys.map((k) => {
    const all = trades.filter((t) => t.strategy === k);
    const open = state.open.filter((t) => t.strategy === k);
    return {
      strategy: k,
      d1: rr.rStats(all.filter(win(DAY))), d7: rr.rStats(all.filter(win(7 * DAY))), d30: rr.rStats(all.filter(win(30 * DAY))), all: rr.rStats(all),
      open: open.length, openR: open.reduce((s, t) => s + (t.markR || 0), 0),
    };
  });
  const rank = (b) => (b.d30.n >= 10 ? b.d30.expR : -Infinity);
  board.sort((a, b) => rank(b) - rank(a) || (b.all.expR ?? -9) - (a.all.expR ?? -9));
  const row = (b) => `| ${b.strategy} | ${b.d30.n ?? 0} | ${f2(b.d30.expR)} | ${f2(b.d30.totalR, 1)} | ${sh(b.d30.win)} | ${f2(b.d30.pf)} | ${f2(b.d30.maxDD, 1)} | ${f2(b.d7.expR)} (${b.d7.n ?? 0}) | ${f2(b.d1.totalR, 1)} (${b.d1.n ?? 0}) | ${f2(b.all.expR)} (${b.all.n ?? 0}) | ${b.open} / ${f2(b.openR, 1)} |`;
  const best = board.find((b) => b.d30.n >= 10);
  L.push('## Classement des stratégies (30 derniers jours, trades clôturés)', '');
  L.push(best ? `**Meilleure sur 30J : ${best.strategy}** — ${f2(best.d30.expR)}R par trade sur ${best.d30.n} trades (total ${f2(best.d30.totalR, 1)}R, ${sh(best.d30.win)} gagnants).` : 'Pas encore assez de trades clôturés (min 10 sur 30J) pour classer.', '');
  L.push('| Stratégie | n 30J | E 30J (R) | total 30J | win | PF | DD | E 7J (n) | total 24h (n) | E depuis début (n) | ouverts / R latent |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const b of board) L.push(row(b));
  L.push('');

  // Learning: what separated the members that rose >= 10% in 24h.
  const rowsByKey = new Map();
  for (const s of snaps) for (const r of s.top) rowsByKey.set(`${s.t}|${r.symbol}`, r);
  const joined = outcomes.map((o) => ({ ...rowsByKey.get(`${o.t}|${o.symbol}`), ...o })).filter((r) => r.rank != null);
  L.push('## Ce qui distingue ceux qui montent (+10 % en 24h)', '');
  if (joined.length < 200) {
    L.push(`Pas encore assez d'observations (${joined.length}, il en faut 200).`, '');
  } else {
    const base = joined.filter((r) => r.r24h >= 0.10).length / joined.length;
    L.push(`${joined.length} observations · taux de base ${pc(base)} montent ≥ +10 %, ${pc(joined.filter((r) => r.r24h <= -0.10).length / joined.length)} baissent ≤ −10 %.`, '');
    L.push('Groupe du bas (Q1) vs groupe du haut (Q5) de chaque variable. Une variable n\'est utile que si "monte" grimpe **sans** que "baisse" grimpe autant.', '');
    L.push('| Variable | Q1 monte | Q1 baisse | Q1 moy 24h | Q5 monte | Q5 baisse | Q5 moy 24h |', '|---|---|---|---|---|---|---|');
    for (const [f, label] of Object.entries(FEATURES)) {
      const q = quintiles(joined, f);
      if (!q[0].length) continue;
      const st = (g) => [g.filter((r) => r.r24h >= 0.10).length / g.length, g.filter((r) => r.r24h <= -0.10).length / g.length, g.reduce((s, r) => s + r.r24h, 0) / g.length];
      const [u1, d1, m1] = st(q[0]); const [u5, d5, m5] = st(q[4]);
      L.push(`| ${label} | ${pc(u1)} | ${pc(d1)} | ${pc(m1, 2)} | ${pc(u5)} | ${pc(d5)} | ${pc(m5, 2)} |`);
    }
    L.push('');
  }
  const risers = joined.filter((r) => r.t > at - 2 * DAY && r.t <= at - DAY && r.r24h >= 0.10).sort((a, b) => b.r24h - a.r24h);
  L.push(`### Montées ≥ +10 % (photos du ${day})`, '');
  if (!risers.length) L.push('Aucune.');
  else {
    L.push('| Photo | Token | 24h | max 24h | rang | phase | 7J | vol 24h/7J | quiet | écart plafond |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const r of risers.slice(0, 20)) L.push(`| ${new Date(r.t).toISOString().slice(5, 16)} | ${short(r.symbol)} | ${pc(r.r24h)} | ${pc(r.max24)} | ${r.rank} | ${r.phase} | ${f2(r.w1, 1)}% | ${f2(r.vol24_7d)}× | ${f2(r.quiet, 0)} | ${pc(r.distCeil14)} |`);
  }
  L.push('', `_Médiane 24h de toutes les observations : ${pc(median(joined.map((r) => r.r24h)), 2)}._`, '');

  const md = `${L.join('\n')}\n`;
  const file = `reports/${dayKey(at)}.md`;
  writeText(file, md);
  writeText('LATEST.md', md);
  writeJson('leaderboard.json', { at: new Date(at).toISOString(), best: best?.strategy ?? null, board: board.map((b) => ({ strategy: b.strategy, d30: b.d30, d7: b.d7, d1: b.d1, all: b.all, open: b.open, openR: b.openR })) });
  return file;
}
