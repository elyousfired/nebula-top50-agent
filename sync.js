#!/usr/bin/env node
// Keeps the PC copy of the agent's data up to date: `git pull` every hour (and
// at start). The agent itself runs in GitHub Actions, so it keeps going while
// the PC is off; this only brings the data home. Run under pm2:
//   pm2 start sync.js --name top50-agent-sync && pm2 save
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jobs as J, createLogger } from 'nebula-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('top50-sync');

const STALE_MS = 5 * 3_600_000; // agent data older than this -> trigger a run

function pull() {
  const out = execFileSync('git', ['pull', '--ff-only'], { cwd: HERE, encoding: 'utf8' }).trim();
  const head = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: HERE, encoding: 'utf8' }).trim();
  log.info('pulled', { result: out.split('\n').pop(), last: head });
  watchdog();
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
