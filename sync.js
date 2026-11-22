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

function pull() {
  const out = execFileSync('git', ['pull', '--ff-only'], { cwd: HERE, encoding: 'utf8' }).trim();
  const head = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: HERE, encoding: 'utf8' }).trim();
  log.info('pulled', { result: out.split('\n').pop(), last: head });
}

const jobs = J.createScheduler({ log });
jobs.every('pull', '1h', pull, { runOnStart: true, offset: '20m' });
