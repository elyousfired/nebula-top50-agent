#!/usr/bin/env node
// Keeps the PC copy of the agent's data up to date: `git pull` every hour (and
// at start). The agent itself runs in GitHub Actions, so it keeps going while
// the PC is off; this only brings the data home. Run under pm2:
//   pm2 start sync.js --name top50-agent-sync && pm2 save
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { jobs as J, createLogger, telegram } from 'nebula-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('top50-sync');

const STALE_MS = 5 * 3_600_000; // agent data older than this -> trigger a run

function pull() {
  const out = execFileSync('git', ['pull', '--ff-only'], { cwd: HERE, encoding: 'utf8' }).trim();
  const head = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: HERE, encoding: 'utf8' }).trim();
  log.info('pulled', { result: out.split('\n').pop(), last: head });
  watchdog();
  notifyLight().catch((e) => log.error('light notify failed', { err: e.message }));
}

/**
 * Telegram when the BTC/ETH paper light changes (user asked for it). Reads the agent's
 * append-only log; the number of lines already handled is kept in .light-notified (not committed).
 */
const MARK = path.join(HERE, '.light-notified');
async function notifyLight() {
  const dir = path.join(HERE, 'data', 'btclight');
  if (!fs.existsSync(dir)) return;
  const lines = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()
    .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean));
  const done = fs.existsSync(MARK) ? Number(fs.readFileSync(MARK, 'utf8')) : 0;
  for (const line of lines.slice(done)) {
    const r = JSON.parse(line);
    const first = r.prev == null; // first day logged: say where the light starts
    if (!first && !r.changed && r.action === 'aucune') continue;
    const act = r.action === 'achat' ? `\nACHAT papier au open ${r.fillPx}` : r.action === 'vente' ? `\nVENTE papier au open ${r.fillPx}` : '';
    const head = first ? `suivi démarré, feu ${r.light}` : `feu ${r.prev} → ${r.light}`;
    await telegram.send(`${r.symbol.replace('USDT', '')} : ${head} (clôture du ${r.day})${act}\n${r.reason}`);
  }
  fs.writeFileSync(MARK, String(lines.length));
}

/**
 * Backup for GitHub's unreliable schedule: if the last data commit is older
 * than STALE_MS, start the workflow (gh CLI, already logged in on this PC).
 */
function watchdog() {
  const last = Number(execFileSync('git', ['log', '-1', '--format=%ct', '--', 'data'], { cwd: HERE, encoding: 'utf8' }).trim()) * 1000;
  const age = Date.now() - last;
  if (age < STALE_MS) return;
  try {
    execFileSync('gh', ['workflow', 'run', 'agent.yml'], { cwd: HERE, encoding: 'utf8' });
    log.warn('agent data stale, workflow started', { ageHours: (age / 3_600_000).toFixed(1) });
  } catch (e) {
    log.error('could not start the workflow', { err: e.message });
  }
}

const jobs = J.createScheduler({ log });
jobs.every('pull', '1h', pull, { runOnStart: true, offset: '20m' });
