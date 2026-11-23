// Loads the Top 50 logic from nebula-benchmark (same code as the website), so
// the agent's Top 50 is exactly the site's. BENCH_DIR points to a checkout of
// nebula-benchmark (CI checks it out next to the agent; locally it is the
// sibling folder C:\Users\red1e\nebula-benchmark).

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BENCH_DIR = process.env.BENCH_DIR || path.resolve(HERE, '..', '..', 'nebula-benchmark');
const imp = (p) => import(pathToFileURL(path.join(BENCH_DIR, p)).href);

export const bars = await imp('src/core/bars.js');
export const metrics = await imp('src/core/metrics.js');
export const scoring = await imp('src/core/scoring.js');
export const universe = await imp('src/core/universe.js');
export const squeeze = await imp('src/core/squeeze.js');
export const bybit = await imp('src/lib/bybit.js');
export const strategies = await imp('backtest/top50strat.js'); // FAMILIES, EXITS
export const rr = await imp('backtest/rr.js'); // rStats
export const btcswings = await imp('src/core/btcswings.js'); // reliability (BTC waves list)
