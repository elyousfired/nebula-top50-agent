# nebula-top50-agent

Follows the Top 50 (30D score, same code as nebula-benchmark) every 4 hours, paper-trades every strategy and writes a daily report.

- **Runs in GitHub Actions** (`.github/workflows/agent.yml`, every 4h at :10 UTC), so it keeps going while the PC is off. A late or skipped run is caught up: every missed 4H slot is rebuilt from Bybit candles (up to 30 days).
- **Bybit access** goes through the site's proxy in Frankfurt (`https://nebula-benchmark.vercel.app/api/bybit`) when Bybit blocks the runner's IP. No API key is needed.
- **Data** is committed to this private repo under `data/` and pulled to the PC by `sync.js` (pm2, every hour).

## Data

| Path | Content |
|---|---|
| `data/snapshots/YYYY-MM.jsonl` | one line per 4H slot: Top 50 with features (rank, score, phase, perfs, volume, quiet, ceiling distance, ATR), entered / left |
| `data/trades/YYYY-MM.jsonl` | closed paper trades of every strategy (entry, stop, target, exit, R) |
| `data/outcomes/YYYY-MM.jsonl` | next-24h return, max and min of every Top 50 member |
| `data/state.json` | last slot, open trades, pending outcomes |
| `data/reports/YYYY-MM-DD.md`, `data/LATEST.md` | daily report: strategy leaderboard (24h / 7d / 30d / all) and what separated the risers |
| `data/leaderboard.json` | same leaderboard as JSON |

Strategies and exits are `FAMILIES` × `EXITS` from `nebula-benchmark/backtest/top50strat.js`.

## Commands

- `npm test` — unit tests.
- `npm run run` — one agent run locally (needs `../nebula-benchmark`; `BACKFILL_DAYS`, `AGENT_DATA` optional).
- `npm run sync` — pull the data every hour (use pm2).

Paper trades only. Nothing here places orders.
