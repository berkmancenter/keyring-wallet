#!/usr/bin/env node
// An append-only log of the decisions put to the owner (the testing report's Proposal E, (b)). One JSON record per
// line in a PRIVATE file, never in a repo: it can hold an owner's answer verbatim. A correction is a new record, never
// an edit. Records name roles (lanes, owner|colleague), not people.
//
//   DECISIONS_FILE (default ~/.keyring-fleet/decisions.jsonl, created mode 600 in a folder created mode 700)
//   decisions.mjs ask       --by <lane> --question "…" [--options "a|b|c"] [--recommendation "…"] [--context "…"]
//                           [--owner owner|colleague] [--board "#29"]                           -> prints the new id
//   decisions.mjs answer    D-<n> --by <lane> --heard-by <lane> --heard-via session|signal|call --summary "…"
//                           [--choice <option index>] [--words "the answer, verbatim"]
//   decisions.mjs report    D-<n> --by <lane> --source <lane that heard it> --summary "…" [--choice <index>]
//   decisions.mjs supersede D-<n> --by <lane> --superseded-by D-<m>
//   decisions.mjs withdraw  D-<n> --by <lane> --reason "…"
//   decisions.mjs render [--json]   the current state of each decision, paraphrase only: never the words
//   decisions.mjs show D-<n>        one decision's history, words included (local only)
//
// The rules it enforces: append-only; "words" only on "answered"; "choice" is an option index when the decision has
// options, and every answer or report carries a "summary" the board can show; a lane is a role id (letters and digits
// joined by "-", e.g. coordinator-19). Withdrawn and superseded are final: nothing more is recorded on that decision
// (reopening it is a fresh ask), and a supersede may not point at itself, at a withdrawn decision, or round a loop.
// The file is refused inside a git work tree, as a symlink, or in a group- or world-writable folder; appends hold
// a lock file, so two lanes never mint the same id.
//
// Honour system: an "answered" record needs heardBy = appendedBy, but both are what the appending lane says. The
// check stops a relay being filed as an answer by mistake; it is not proof that the words were heard first-hand.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_FILE = path.join(os.homedir(), '.keyring-fleet', 'decisions.jsonl');
const LANE = /^[a-z]+(?:-[a-z0-9]+)*$/;
const EVENTS = ['asked', 'answered', 'reported', 'superseded', 'withdrawn'];
const OWNERS = ['owner', 'colleague'];
const FINAL = ['superseded', 'withdrawn'];
const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 30000;

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
    if (rec.owner && !OWNERS.includes(rec.owner)) fail(`owner: ${OWNERS.join(' or ')}`);
    const n = asked.reduce((m, r) => Math.max(m, Number(String(r.id).replace(/^D-/, '')) || 0), 0) + 1;
    out.id = `D-${n}`;
    return out;
  }
  const d = asked.find((r) => r.id === rec.id);
  if (!d) fail(`no decision ${rec.id}`);
  const states = new Map(render(log).map((x) => [x.id, x]));
  const { state } = states.get(rec.id);
  if (FINAL.includes(state)) fail(`${rec.id} is ${state}, which is final; reopening it is a fresh ask`);
  if (rec.event === 'answered' || rec.event === 'reported') {
    if (!rec.summary) fail('a summary (paraphrase for the board) is needed');
    if (d.options) {
      if (!Number.isInteger(rec.choice) || rec.choice < 0 || rec.choice >= d.options.length) fail(`choice must be an option index 0-${d.options.length - 1}`);
    } else if (rec.choice !== undefined && !Number.isInteger(rec.choice)) fail('choice must be an option index');
  }
  if (rec.event === 'answered') {
    if (!LANE.test(rec.heardBy || '')) fail('heardBy must be a lane role id');
    if (rec.heardBy !== rec.appendedBy) fail('only the lane that heard the answer may record it (heardBy must equal appendedBy); a relay is "reported"');
    if (!['session', 'signal', 'call'].includes(rec.heardVia)) fail('heardVia: session, signal or call');
  }
  if (rec.event === 'reported' && !LANE.test(rec.source || '')) fail('source must be the lane that heard it');
  if (rec.event === 'superseded') {
    if (!asked.some((r) => r.id === rec.supersededBy)) fail('supersededBy must name an existing decision');
    if (rec.supersededBy === rec.id) fail('a decision cannot supersede itself');
    const end = follow(rec.supersededBy, states);
    if (end.path.includes(rec.id)) fail(`${rec.supersededBy} leads back to ${rec.id} (${end.path.join(' -> ')}): a loop`);
    if (end.state === 'withdrawn') fail(`${rec.supersededBy} ends at ${end.id}, which is withdrawn`);
  }
  if (rec.event === 'withdrawn' && !rec.reason) fail('a reason is needed');
  return out;
}

/** Follows supersededBy from id to the decision now standing; broken = a missing link or a loop. */
function follow(id, states) {
  const seen = [];
  let cur = id;
  for (;;) {
    const d = states.get(cur);
    if (!d) return { id: cur, state: 'missing', path: seen, broken: true };
    if (seen.includes(cur)) return { id: cur, state: d.state, path: seen, broken: true };
    seen.push(cur);
    if (d.state !== 'superseded') return { id: cur, state: d.state, path: seen, broken: false };
    cur = d.supersededBy;
  }
}

/** The log's own guards: never in a git work tree, never a symlink, never in a folder others can write. */
export function checkPlace(file) {
  const abs = path.resolve(file);
  let base = path.dirname(abs);
  while (!fs.existsSync(base)) base = path.dirname(base);
  for (let d = fs.realpathSync(base); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) throw new Error(`${abs} is inside the git work tree ${d}: the decisions log stays out of every repo`);
    if (d === path.dirname(d)) break;
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
  if ((fs.statSync(path.dirname(abs)).mode & 0o022) !== 0) throw new Error(`${path.dirname(abs)} is group- or world-writable: chmod go-w it first`);
  if (isLink(abs)) throw new Error(`${abs} is a symlink: the decisions log must be a plain file`);
  return abs;
}
const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };

/** Runs fn holding <file>.lock (exclusive create); a lock older than LOCK_STALE_MS is taken as abandoned. */
function withLock(file, fn) {
  const lock = `${file}.lock`;
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try { fs.closeSync(fs.openSync(lock, 'wx', 0o600)); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(lock); continue; } } catch { continue; }
      if (Date.now() > until) throw new Error(`${lock} is held by another append; try again (remove it only if no lane is writing)`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try { return fn(); } finally { try { fs.unlinkSync(lock); } catch { /* already gone */ } }
}

/** Appends one record (the file is created mode 600; an existing file is never rewritten). */
export function append(file, rec, now) {
  const abs = checkPlace(file);
  return withLock(abs, () => {
    const out = validate(rec, readLog(abs), now);
    const fd = fs.openSync(abs, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeSync(fd, JSON.stringify(out) + '\n'); } finally { fs.closeSync(fd); }
    try { fs.chmodSync(abs, 0o600); } catch { /* best effort */ }
    return out;
  });
}

/** The current state per decision, paraphrase only: no record's "words" ever leaves through this. Nothing after a
 * final state (superseded, withdrawn) counts, and each decision says which one now stands ("current"). */
export function render(log) {
  const byId = new Map();
  for (const r of log) {
    if (r.event === 'asked') { byId.set(r.id, { id: r.id, question: r.question, context: r.context, options: r.options, recommendation: r.recommendation, owner: r.owner || 'owner', board: r.board, askedAt: r.at, askedBy: r.appendedBy, state: 'open' }); continue; }
    const d = byId.get(r.id);
    if (!d || FINAL.includes(d.state)) continue;
    if (r.event === 'answered') Object.assign(d, { state: 'answered', choice: r.choice, summary: r.summary, decidedAt: r.at, heardBy: r.heardBy, heardVia: r.heardVia });
    if (r.event === 'reported' && d.state !== 'answered') Object.assign(d, { state: 'reported', choice: r.choice, summary: r.summary, reportedAt: r.at, reportedBy: r.appendedBy, source: r.source });
    if (r.event === 'superseded') Object.assign(d, { state: 'superseded', supersededBy: r.supersededBy });
    if (r.event === 'withdrawn') Object.assign(d, { state: 'withdrawn', reason: r.reason });
  }
  for (const d of byId.values()) {
    if (d.state !== 'superseded') { d.current = d.id; continue; }
    const end = follow(d.supersededBy, byId);
    d.current = end.id;
    if (end.broken || end.state === 'withdrawn') d.unresolved = true;
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
      else for (const d of s) console.log(`${d.id} [${d.state}${d.current !== d.id ? ` -> ${d.current}${d.unresolved ? ', unresolved' : ''}` : ''}] ${d.question}${d.summary ? ` -> ${d.summary}` : ''}`);
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
