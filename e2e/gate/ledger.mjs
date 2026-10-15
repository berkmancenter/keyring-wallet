#!/usr/bin/env node
// The flakiness ledger (gate-efficiency phase 0): every row's record over the recent runs, from each run's meta (pin,
// harness, start) and its legs' ROW lines (leg.log). A row that both passed and failed on the same pin AND the same
// harness is flaky there: neither the app nor the test changed, so the difference was the run. (A rerun with a fixed
// harness on the same pin is not a flake: 1014-1857 → 2239, link-again-rescan.) SKIP rows are not counted. Read-only.
//   node e2e/gate/ledger.mjs [--days 14] [--home ~/.keyring-fleet/gate] [--json]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** A run's meta file as { key: first value }. */
export function parseMeta(text) {
  const m = {};
  for (const l of text.split('\n')) {
    const i = l.indexOf('=');
    if (i > 0 && !(l.slice(0, i) in m)) m[l.slice(0, i)] = l.slice(i + 1);
  }
  return m;
}

/** A leg log's ROW lines as [{ row, status }] (the last line per row wins, as the report counts). */
export function parseRows(text) {
  const by = new Map();
  for (const m of text.matchAll(/^ROW (.+?) (PASS|FAIL|SKIP) — /gm)) by.set(m[1], m[2]);
  return [...by].map(([row, status]) => ({ row, status }));
}

/** Every run under `home`/runs started within `days` of `now`: [{ run, pin, kind, started, legs: [{ leg, rows }] }]. */
export function readRuns(home, { days = 14, now = Date.now() } = {}) {
  const dir = path.join(home, 'runs');
  if (!existsSync(dir)) return [];
  const since = now - days * 86400000;
  const runs = [];
  for (const run of readdirSync(dir).sort()) {
    const metaFile = path.join(dir, run, 'meta');
    if (!existsSync(metaFile)) continue;
    const meta = parseMeta(readFileSync(metaFile, 'utf8'));
    const started = Date.parse(`${(meta.started || '').replace(/Z?$/, 'Z')}`);
    if (!Number.isFinite(started) || started < since) continue;
    const legs = [];
    for (const leg of readdirSync(path.join(dir, run))) {
      const log = path.join(dir, run, leg, 'leg.log');
      if (existsSync(log)) legs.push({ leg, rows: parseRows(readFileSync(log, 'utf8')) });
    }
    runs.push({ run, pin: meta.pin || '?', harness: meta.harness || '?', kind: meta.kind || '?', started, legs });
  }
  return runs;
}

/** Per leg and row: runs, passes, fails, pass rate, and the pin@harness pairs it both passed and failed on. Worst first. */
export function ledger(runs) {
  const by = new Map();
  for (const r of runs)
    for (const l of r.legs)
      for (const { row, status } of l.rows) {
        if (status === 'SKIP') continue;
        const key = `${l.leg}\t${row}`;
        const e = by.get(key) ?? { leg: l.leg, row, pass: 0, fail: 0, pins: new Map() };
        e[status === 'PASS' ? 'pass' : 'fail']++;
        const at = `${r.pin.slice(0, 8)}@${String(r.harness).slice(0, 7)}`;
        const p = e.pins.get(at) ?? new Set();
        p.add(status);
        e.pins.set(at, p);
        by.set(key, e);
      }
  return [...by.values()]
    .map((e) => ({
      leg: e.leg,
      row: e.row,
      runs: e.pass + e.fail,
      pass: e.pass,
      fail: e.fail,
      rate: e.pass / (e.pass + e.fail),
      flakyOn: [...e.pins].filter(([, s]) => s.size > 1).map(([at]) => at),
    }))
    .sort((a, b) => a.rate - b.rate || b.flakyOn.length - a.flakyOn.length || a.leg.localeCompare(b.leg) || a.row.localeCompare(b.row));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
  const home = arg('--home', process.env.GATE_HOME || path.join(os.homedir(), '.keyring-fleet', 'gate'));
  const days = Number(arg('--days', 14));
  const runs = readRuns(home, { days });
  const rows = ledger(runs);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ days, runs: runs.length, rows }, null, 2));
  else {
    console.log(`ledger: ${runs.length} run(s) in ${days} days, ${rows.length} row(s); worst first`);
    for (const r of rows.filter((x) => x.fail > 0))
      console.log(`${(r.rate * 100).toFixed(0).padStart(3)}%  ${String(r.pass).padStart(3)}/${String(r.runs).padEnd(3)} ${r.leg.padEnd(16)} ${r.row}${r.flakyOn.length ? `  FLAKY on ${r.flakyOn.join(', ')}` : ''}`);
    console.log(`${rows.filter((x) => x.fail === 0).length} row(s) never failed in the window`);
  }
}
