#!/usr/bin/env node
// The coverage manifest (gate-efficiency phase 0): every row the gate runs, with its leg and the anchor it covers
// (coverage.flows.json), from a run's leg logs. The committed e2e/gate/coverage.tsv is the record of what the gate
// proves; a change that removes a row or adds a leg changes it in the same diff.
//   node e2e/gate/coverage.mjs <run dir>            write e2e/gate/coverage.tsv from that run (a full gate)
//   node e2e/gate/coverage.mjs <run dir> --check    exit 1 and print the difference when the run and the file differ
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MANIFEST = path.join(HERE, 'coverage.tsv');
const HEADER = 'leg\trow\tanchor';

/** The rules file as { rows: [[RegExp, anchor]], legs }. */
export function loadFlows(text = readFileSync(path.join(HERE, 'coverage.flows.json'), 'utf8')) {
  const j = JSON.parse(text);
  return { anchors: j.anchors, rows: j.rows.map(([re, a]) => [new RegExp(re), a]), legs: j.legs ?? {} };
}

/** The anchor of one row: the first row rule that matches, else its leg's, else "other". */
export function anchorOf(leg, row, flows) {
  for (const [re, a] of flows.rows) if (re.test(row)) return a;
  return flows.legs[leg] ?? 'other';
}

/** A run's rows: [{ leg, row }] from every leg's ROW lines, sorted, unique. */
export function runRows(runDir) {
  const out = new Set();
  for (const leg of readdirSync(runDir).sort()) {
    const log = path.join(runDir, leg, 'leg.log');
    if (!existsSync(log)) continue;
    for (const m of readFileSync(log, 'utf8').matchAll(/^ROW (.+?) (PASS|FAIL|SKIP) — /gm)) out.add(`${leg}\t${m[1]}`);
  }
  return [...out].sort().map((l) => { const [leg, row] = l.split('\t'); return { leg, row }; });
}

/** The manifest text for rows. */
export function manifest(rows, flows) {
  return [HEADER, ...rows.map((r) => `${r.leg}\t${r.row}\t${anchorOf(r.leg, r.row, flows)}`)].join('\n') + '\n';
}

/** Lines only in a (−) and only in b (+). */
export function diff(a, b) {
  const A = new Set(a.split('\n').filter(Boolean)), B = new Set(b.split('\n').filter(Boolean));
  return [...[...A].filter((l) => !B.has(l)).map((l) => `- ${l}`), ...[...B].filter((l) => !A.has(l)).map((l) => `+ ${l}`)];
}

/** Rows per anchor: { anchor: count }. */
export function byAnchor(text) {
  const n = {};
  for (const l of text.split('\n').slice(1).filter(Boolean)) { const a = l.split('\t')[2]; n[a] = (n[a] ?? 0) + 1; }
  return n;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [runDir] = process.argv.slice(2);
  if (!runDir || !existsSync(runDir)) { console.error('usage: coverage.mjs <run dir> [--check]'); process.exit(2); }
  const text = manifest(runRows(runDir), loadFlows());
  if (process.argv.includes('--check')) {
    const d = diff(existsSync(MANIFEST) ? readFileSync(MANIFEST, 'utf8') : '', text);
    if (d.length) { console.log(`coverage: ${d.length} difference(s) between coverage.tsv (−) and ${path.basename(runDir)} (+)`); console.log(d.join('\n')); process.exit(1); }
    console.log(`coverage: ${path.basename(runDir)} matches coverage.tsv`);
  } else {
    writeFileSync(MANIFEST, text);
    console.log(`coverage.tsv: ${text.split('\n').length - 2} rows from ${path.basename(runDir)} · ${JSON.stringify(byAnchor(text))}`);
  }
}
