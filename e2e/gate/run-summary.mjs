#!/usr/bin/env node
// A gate run as data: <run-dir>/summary.json, the feed the command-center board reads instead of retyping legs.
// From what a run already writes: meta (key=value), legs.tsv (leg, exit, start, end) and each leg's leg.log
// (HEADS, ROW, LEG … BROKEN, ENV lines). Each leg gets a verdict, whose result it is:
//   app      the leg ran and its rows are a verdict on the app (result pass or fail)
//   env      not the app: a Mac sleep inside the leg (ENV line), or the run's meta names it (env-legs=, with env=)
//   harness  not the app: the leg broke (setup, link, crash; LEG … BROKEN), or the meta names it (harness-legs=)
//   none     no result: not run (exit 4, paused) or stopped (exit 143)
// overall: pass (every leg an app pass), fail (any app fail), incomplete (some legs are no verdict on the app).
// A tracked row (rows.js `tracked`: a SKIP until its fix passes) that PASSed in an earlier run and SKIPs again has
// regressed: the leg lists it under regressions and counts as an app fail, so a fixed bug cannot hide as a SKIP.
//
//   run-summary.mjs <run-dir>            writes <run-dir>/summary.json and prints one line
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

/** meta: key -> value; a key written more than once (changed-why=) -> its values in order. */
export function parseMeta(text) {
  const meta = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([a-z][a-z0-9-]*)=(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (k in meta) meta[k] = [].concat(meta[k], v);
    else meta[k] = v;
  }
  return meta;
}

const first = (v) => (Array.isArray(v) ? v[0] : v);
const list = (v) => (first(v) || '').split(/\s+/).filter(Boolean);

/** One leg's record from its legs.tsv line and its log. */
export function legRecord({ name, exit, start, end }, log, meta, passedBefore = new Map()) {
  const rows = [...log.matchAll(/^ROW (.*?) (PASS|FAIL|SKIP) — (.*)$/gm)].map((m) => ({ name: m[1], status: m[2], detail: m[3] }));
  const count = (s) => rows.filter((r) => r.status === s).length;
  const broken = (log.match(/^LEG \S+ BROKEN — (.*)$/m) || [])[1];
  const env = [...log.matchAll(/^ENV (.*)$/gm)].map((m) => m[1]);
  const rec = { name, exit, seconds: end && start ? end - start : null, pass: count('PASS'), fail: count('FAIL'), skip: count('SKIP') };
  const firstFail = rows.find((r) => r.status === 'FAIL');
  // Tracked rows that passed in an earlier run and skip now: regressions.
  const regressions = rows
    .filter((r) => r.status === 'SKIP' && /^tracked\b/.test(r.detail) && passedBefore.has(r.name))
    .map((r) => ({ row: r.name, passedIn: passedBefore.get(r.name) }));
  if (regressions.length) rec.regressions = regressions;
  if (exit === 4) return { ...rec, result: 'not-run', verdict: 'none', reason: 'not run (paused)' };
  if (exit === 143) return { ...rec, result: 'stopped', verdict: 'none', reason: 'stopped mid-leg' };
  const result = exit === 0 ? 'pass' : exit === 3 ? 'fail' : exit === 1 ? 'broken' : 'error';
  if (list(meta['env-legs']).includes(name)) return { ...rec, result, verdict: 'env', reason: (first(meta.env) || 'marked env in meta').slice(0, 200) };
  if (list(meta['harness-legs']).includes(name)) return { ...rec, result, verdict: 'harness', reason: (first(meta.harness) || 'marked harness in meta').slice(0, 200) };
  if (env.length) return { ...rec, result, verdict: 'env', reason: env[0].slice(0, 200) };
  if (result === 'broken') return { ...rec, result, verdict: 'harness', reason: (broken || 'the leg broke').slice(0, 200) };
  if (result === 'error') return { ...rec, result, verdict: 'harness', reason: `exit ${exit}` };
  if (regressions.length && result !== 'broken') return { ...rec, result: 'fail', verdict: 'app', reason: `tracked row ${regressions[0].row} passed in ${regressions[0].passedIn} and skips again: regressed` };
  if (result === 'fail') return { ...rec, result, verdict: 'app', reason: firstFail ? `${firstFail.name}: ${firstFail.detail}`.slice(0, 200) : 'a row failed' };
  return { ...rec, result, verdict: 'app', reason: `${rec.pass} pass, ${rec.skip} skip` };
}

/** Row name -> the newest earlier run (by run id) in which it PASSed, from the sibling run folders. */
export function passedBeforeIn(runDir) {
  const runs = path.dirname(runDir), me = path.basename(runDir);
  const out = new Map();
  let ids = [];
  try { ids = fs.readdirSync(runs).filter((d) => d < me).sort(); } catch { return out; }
  for (const id of ids) {
    let legs = [];
    try { legs = fs.readdirSync(path.join(runs, id), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { continue; }
    for (const leg of legs) for (const m of read(path.join(runs, id, leg, 'leg.log')).matchAll(/^ROW (.*?) PASS — /gm)) out.set(m[1], id);
  }
  return out;
}

/** The whole run. */
export function summarize(runDir) {
  const meta = parseMeta(read(path.join(runDir, 'meta')));
  const passedBefore = passedBeforeIn(runDir);
  const legs = read(path.join(runDir, 'legs.tsv')).split('\n').filter(Boolean).map((l) => {
    const [name, exit, start, end] = l.split('\t');
    return legRecord({ name, exit: Number(exit), start: Number(start), end: Number(end) }, read(path.join(runDir, name, 'leg.log')), meta, passedBefore);
  });
  const by = (v) => legs.filter((l) => l.verdict === v).length;
  const appFail = legs.some((l) => l.verdict === 'app' && l.result === 'fail');
  const overall = appFail ? 'fail' : legs.length && legs.every((l) => l.verdict === 'app' && l.result === 'pass') ? 'pass' : 'incomplete';
  const heads = {};
  for (const k of ['wallet', 'bifold', 'harness', 'target', 'farm', 'openvtc', 'builds', 'push-on']) if (meta[k] !== undefined) heads[k] = first(meta[k]);
  return {
    run: path.basename(runDir),
    kind: first(meta.kind) || null,
    pin: first(meta.pin) || null,
    scope: first(meta.scope) || null,
    rerunOf: first(meta['rerun-of']) || null,
    heads,
    started: first(meta.started) || null,
    ended: first(meta.ended) || null,
    overall,
    counts: { legs: legs.length, app: by('app'), env: by('env'), harness: by('harness'), none: by('none'), appFail: legs.filter((l) => l.verdict === 'app' && l.result === 'fail').length, regressions: legs.reduce((n, l) => n + (l.regressions?.length || 0), 0) },
    env: { note: first(meta.env) || null, paused: first(meta.paused) || null, stopped: first(meta.stopped) || null, legs: legs.filter((l) => l.verdict === 'env').map((l) => l.name) },
    legs,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(path.join(dir, 'meta'))) { console.error('usage: run-summary.mjs <run-dir>  (a folder with meta)'); process.exit(64); }
  const s = summarize(dir);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(s, null, 2) + '\n');
  const c = s.counts;
  console.log(`${s.run}: ${s.overall} · ${c.legs} legs: ${c.app} app (${c.appFail} fail), ${c.env} env, ${c.harness} harness, ${c.none} none`);
}
