// File storage under data/ (committed by CI, pulled to the PC by sync.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA = process.env.AGENT_DATA || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const p = (f) => { const full = path.join(DATA, f); fs.mkdirSync(path.dirname(full), { recursive: true }); return full; };

export function readJson(f, fallback) {
  try { return JSON.parse(fs.readFileSync(p(f), 'utf8')); } catch { return fallback; }
}
/** Write tmp then rename: a crash never leaves a half-written file. */
export function writeText(f, text) { const full = p(f); fs.writeFileSync(`${full}.tmp`, text); fs.renameSync(`${full}.tmp`, full); }
export const writeJson = (f, v) => writeText(f, `${JSON.stringify(v, null, 1)}\n`);
export function appendJsonl(f, rows) { if (rows.length) fs.appendFileSync(p(f), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`); }
export function readJsonlDir(dir) {
  const full = p(path.join(dir, '.keep'));
  const d = path.dirname(full);
  const out = [];
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.jsonl')).sort()) {
    for (const line of fs.readFileSync(path.join(d, f), 'utf8').split('\n')) if (line.trim()) out.push(JSON.parse(line));
  }
  return out;
}
