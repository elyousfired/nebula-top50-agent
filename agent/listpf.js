// Paper portfolio on the "reliable BTC followers" list of the site's /btc page.
// Every run the list is recomputed: a token that enters is bought (equal
// weight, at the last 1H close), a token that leaves is sold. Pure (tested).

const FEE = 0.001; // 0.1% per side

/**
 * pf: { positions: { SYM: { entryT, entry, btc0 } } }, list: symbols now in the list,
 * px: SYM -> price now (BTCUSDT included), now: ms.
 * Returns { pf, opened: [...], closed: [{ symbol, entryT, entry, exitT, exit, ret, btcRet }] }.
 * A token without a price is kept as is (opened later / closed later).
 */
export function stepListPortfolio(pf, list, px, now) {
  const positions = { ...(pf?.positions || {}) };
  const inList = new Set(list);
  const opened = []; const closed = [];
  for (const [s, p] of Object.entries(positions)) {
    if (inList.has(s) || !(px[s] > 0)) continue;
    const ret = (px[s] * (1 - FEE)) / (p.entry * (1 + FEE)) - 1;
    closed.push({ symbol: s, entryT: p.entryT, entry: p.entry, exitT: now, exit: px[s], ret, btcRet: px.BTCUSDT > 0 && p.btc0 > 0 ? px.BTCUSDT / p.btc0 - 1 : null });
    delete positions[s];
  }
  for (const s of list) {
    if (positions[s] || !(px[s] > 0)) continue;
    positions[s] = { entryT: now, entry: px[s], btc0: px.BTCUSDT > 0 ? px.BTCUSDT : null };
    opened.push(s);
  }
  return { pf: { ...pf, positions, startT: pf?.startT ?? now }, opened, closed };
}

/** Mark-to-market of the open positions: [{ symbol, ret, btcRet, days }]. */
export function markPositions(pf, px, now) {
  return Object.entries(pf?.positions || {}).map(([s, p]) => ({
    symbol: s, entryT: p.entryT, entry: p.entry, price: px[s] ?? null,
    ret: px[s] > 0 ? (px[s] * (1 - FEE)) / (p.entry * (1 + FEE)) - 1 : null,
    btcRet: px.BTCUSDT > 0 && p.btc0 > 0 ? px.BTCUSDT / p.btc0 - 1 : null,
    days: (now - p.entryT) / 86_400_000,
  }));
}
