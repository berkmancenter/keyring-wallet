#!/usr/bin/env node
// An append-only log of the decisions put to Alberto (the testing report's Proposal E, (b)). One JSON record per
// line in a PRIVATE file, never in a repo: it holds his answers verbatim. A correction is a new record, never an
// edit. Records name roles (lanes), not people.
//
//   DECISIONS_FILE (default ~/.keyring-fleet/decisions.jsonl, created mode 600)
//   decisions.mjs ask       --by <lane> --question "…" [--options "a|b|c"] [--recommendation "…"] [--context "…"]
//                           [--owner alberto|colleague] [--board "#29"]                         -> prints the new id
//   decisions.mjs answer    D-<n> --by <lane> --heard-by <lane> --heard-via session|signal|call --summary "…"
//                           [--choice <option index>] [--words "his words, verbatim"]
//   decisions.mjs report    D-<n> --by <lane> --source <lane that heard it> --summary "…" [--choice <index>]
//   decisions.mjs supersede D-<n> --by <lane> --superseded-by D-<m>
//   decisions.mjs withdraw  D-<n> --by <lane> --reason "…"
//   decisions.mjs render [--json]   the current state of each decision, paraphrase only: never the words
//   decisions.mjs show D-<n>        one decision's history, words included (local only)
//
// The rules it enforces: append-only; an "answered" record only from the lane that heard him (heardBy = appendedBy);
// "words" only on "answered"; "choice" is an option index when the decision has options, and every answer or report
// carries a "summary" the board can show; a lane is a role id (letters and digits joined by "-", e.g. coordinator-19).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_FILE = path.join(os.homedir(), '.keyring-fleet', 'decisions.jsonl');
const LANE = /^[a-z]+(?:-[a-z0-9]+)*$/;
const EVENTS = ['asked', 'answered', 'reported', 'superseded', 'withdrawn'];

export function readLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l, i) => {
    try { return JSON.parse(l); } catch { throw new Error(`${file}:${i + 1}: not a JSON record`); }
  });
}

/** Checks a record against the log so far; returns the record with v, at and (for "asked") a new id. */
export function validate(rec, log, now = new Date()) {
  const fail = (m) => { throw new Error(m); };
  if (!EVENTS.includes(rec.event)) fail(`event must be one of ${EVENTS.join(', ')}`);
  if (!LANE.test(rec.appendedBy || '')) fail('appendedBy must be a lane role id, e.g. coordinator-19');
  if ('words' in rec && rec.event !== 'answered') fail('"words" belong only on an "answered" record');
  const asked = log.filter((r) => r.event === 'asked');
  const out = { v: 1, at: now.toISOString(), ...rec };
  if (rec.event === 'asked') {
    if (!rec.question) fail('a question is needed');
    if (rec.options && (!Array.isArray(rec.options) || rec.options.length < 2)) fail('options: two or more');
    if (rec.owner && !['alberto', 'colleague'].includes(rec.owner)) fail('owner: alberto or colleague');
    const n = asked.reduce((m, r) => Math.max(m, Number(String(r.id).replace(/^D-/, '')) || 0), 0) + 1;
    out.id = `D-${n}`;
    return out;
  }
  const d = asked.find((r) => r.id === rec.id);
  if (!d) fail(`no decision ${rec.id}`);
  if (rec.event === 'answered' || rec.event === 'reported') {
    if (!rec.summary) fail('a summary (paraphrase for the board) is needed');
    if (d.options) {
      if (!Number.isInteger(rec.choice) || rec.choice < 0 || rec.choice >= d.options.length) fail(`choice must be an option index 0-${d.options.length - 1}`);
    } else if (rec.choice !== undefined && !Number.isInteger(rec.choice)) fail('choice must be an option index');
  }
  if (rec.event === 'answered') {
    if (!LANE.test(rec.heardBy || '')) fail('heardBy must be a lane role id');
    if (rec.heardBy !== rec.appendedBy) fail('only the lane that heard him may record his answer (heardBy must equal appendedBy); a relay is "reported"');
    if (!['session', 'signal', 'call'].includes(rec.heardVia)) fail('heardVia: session, signal or call');
  }
  if (rec.event === 'reported' && !LANE.test(rec.source || '')) fail('source must be the lane that heard it');
  if (rec.event === 'superseded' && !asked.some((r) => r.id === rec.supersededBy)) fail(`supersededBy must name an existing decision`);
  if (rec.event === 'withdrawn' && !rec.reason) fail('a reason is needed');
  return out;
}

/** Appends one record (the file is created mode 600; an existing file is never rewritten). */
export function append(file, rec, now) {
  const log = readLog(file);
  const out = validate(rec, log, now);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'a', 0o600);
  try { fs.writeSync(fd, JSON.stringify(out) + '\n'); } finally { fs.closeSync(fd); }
  try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
  return out;
}

/** The current state per decision, paraphrase only: no record's "words" ever leaves through this. */
export function render(log) {
  const byId = new Map();
  for (const r of log) {
    if (r.event === 'asked') { byId.set(r.id, { id: r.id, question: r.question, context: r.context, options: r.options, recommendation: r.recommendation, owner: r.owner || 'alberto', board: r.board, askedAt: r.at, askedBy: r.appendedBy, state: 'open' }); continue; }
    const d = byId.get(r.id);
    if (!d) continue;
    if (r.event === 'answered') Object.assign(d, { state: 'answered', choice: r.choice, summary: r.summary, decidedAt: r.at, heardBy: r.heardBy, heardVia: r.heardVia });
    if (r.event === 'reported' && d.state !== 'answered') Object.assign(d, { state: 'reported', choice: r.choice, summary: r.summary, reportedAt: r.at, reportedBy: r.appendedBy, source: r.source });
    if (r.event === 'superseded') Object.assign(d, { state: 'superseded', supersededBy: r.supersededBy });
    if (r.event === 'withdrawn') Object.assign(d, { state: 'withdrawn', reason: r.reason });
  }
  return [...byId.values()];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  const file = process.env.DECISIONS_FILE || DEFAULT_FILE;
  const id = rest[0] && /^D-\d+$/.test(rest[0]) ? rest[0] : undefined;
  const int = (v) => (v === undefined ? undefined : Number.isInteger(Number(v)) ? Number(v) : v);
  const drop = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  try {
    if (cmd === 'render') {
      const s = render(readLog(file));
      if (rest.includes('--json')) console.log(JSON.stringify(s, null, 2));
      else for (const d of s) console.log(`${d.id} [${d.state}] ${d.question}${d.summary ? ` -> ${d.summary}` : ''}`);
    } else if (cmd === 'show') {
      for (const r of readLog(file).filter((x) => x.id === id)) console.log(JSON.stringify(r));
    } else {
      const base = { appendedBy: arg('--by') };
      const rec =
        cmd === 'ask' ? { event: 'asked', ...base, question: arg('--question'), context: arg('--context'), options: arg('--options')?.split('|').map((s) => s.trim()), recommendation: arg('--recommendation'), owner: arg('--owner'), board: arg('--board') }
        : cmd === 'answer' ? { event: 'answered', id, ...base, heardBy: arg('--heard-by'), heardVia: arg('--heard-via'), choice: int(arg('--choice')), summary: arg('--summary'), words: arg('--words') }
        : cmd === 'report' ? { event: 'reported', id, ...base, source: arg('--source'), choice: int(arg('--choice')), summary: arg('--summary') }
        : cmd === 'supersede' ? { event: 'superseded', id, ...base, supersededBy: arg('--superseded-by') }
        : cmd === 'withdraw' ? { event: 'withdrawn', id, ...base, reason: arg('--reason') }
        : null;
      if (!rec) { console.error('usage: decisions.mjs ask|answer|report|supersede|withdraw|render|show … (see the header)'); process.exit(64); }
      const out = append(file, drop(rec));
      console.log(out.event === 'asked' ? out.id : `${out.id} ${out.event}`);
    }
  } catch (e) {
    console.error(`decisions: ${e.message}`);
    process.exitCode = 2;
  }
}
