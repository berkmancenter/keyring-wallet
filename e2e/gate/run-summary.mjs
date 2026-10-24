#!/usr/bin/env node
// A gate run as data: <run-dir>/summary.json, the feed the command-center board reads instead of retyping legs.
// From what a run already writes: meta (key=value), legs.tsv (leg, exit, start, end) and each leg's leg.log
// (HEADS, ROW, LEG … BROKEN, ENV lines). Each leg gets a verdict, whose result it is:
//   app      the leg ran and its rows are a verdict on the app (result pass or fail)
//   env      not the app: a Mac sleep inside the leg (ENV line), or the run's meta names it (env-legs=, with env=)
//   harness  not the app: the leg broke (setup, link, crash; LEG … BROKEN), or the meta names it (harness-legs=)
//   none     no result: not run (exit 4, paused) or stopped (exit 143)
// overall: pass (every leg an app pass), fail (any app fail), incomplete (some legs are no verdict on the app).
// Informational rows (meta informational=, or the rows a leg names in INFORMATIONAL rows=a,b <why>): the openvtc/TUI rows
// while keyring-test's VTC and openvtc's attestation shape are behind. Listed under informational; they never fail a
// leg, and a leg passing only through them proves no core journey.
// Core journeys (meta core= journey:leg[,leg][@row[+row]]…, gate.sh CORE_JOURNEYS; the rows after @ must PASS too): what people use Keyring for, Keyring to
// Keyring. Each needs a leg that ran with an app pass and at least one PASS row; in a full gate (kind=gate) one that
// did not makes overall incomplete, never pass, and coreMissing says which and why.
// A tracked row (rows.js `tracked`: a SKIP until its fix passes) that PASSed in an earlier run and SKIPs again has
// regressed: the leg lists it under regressions and counts as an app fail, so a fixed bug cannot hide as a SKIP.
// Only when the passing run's build is an ANCESTOR of this run's (wallet pin=, and bifold= when a bifold clone is at
// hand): an older build without the fix (a dry run on the shipped golden, a rerun of an older pin) skips by design.
// Ancestry that can't be told goes under possiblyRegressed, which never changes the verdict. Runs are ordered by
// meta started= (ISO), not the folder name, whose MMDD has no year.
//
//   run-summary.mjs <run-dir>            writes <run-dir>/summary.json and prints one line
import { execFileSync } from 'node:child_process';
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
  const all = [...log.matchAll(/^ROW (.*?) (PASS|FAIL|SKIP) — (.*)$/gm)].map((m) => ({ name: m[1], status: m[2], detail: m[3] }));
  // Informational FAILs are set aside: listed, never a verdict (see the header).
  // A leg's INFORMATIONAL line names its rows (rows=a,b): only those are set aside, never the leg's other rows (a
  // regression in Keyring's own rows must still fail it; review on #518).
  const infoLine = (log.match(/^INFORMATIONAL (.*)$/m) || [])[1];
  const infoLegRows = new Set(((infoLine || '').match(/\brows=(\S+)/) || [])[1]?.split(',').filter(Boolean) || []);
  const infoLeg = infoLine === undefined ? undefined : infoLine.replace(/\brows=\S+\s*/, '').trim();
  const infoRows = new Set(list(meta.informational));
  const isInfo = (r) => r.status === 'FAIL' && (infoLegRows.has(r.name) || infoRows.has(r.name));
  const informational = all.filter(isInfo).map((r) => ({ row: r.name, detail: r.detail.slice(0, 200), why: infoLeg || 'informational row' }));
  const rows = all.filter((r) => !isInfo(r));
  const count = (s) => rows.filter((r) => r.status === s).length;
  const broken = (log.match(/^LEG \S+ BROKEN — (.*)$/m) || [])[1];
  const env = [...log.matchAll(/^ENV (.*)$/gm)].map((m) => m[1]);
  const rec = { name, exit, seconds: end && start ? end - start : null, pass: count('PASS'), fail: count('FAIL'), skip: count('SKIP'), passed: rows.filter((r) => r.status === 'PASS').map((r) => r.name) };
  const firstFail = rows.find((r) => r.status === 'FAIL');
  // Tracked rows that passed in an earlier run and skip now: regressions.
  const regressions = [], possible = [];
  for (const r of rows.filter((x) => x.status === 'SKIP' && /^tracked\b/.test(x.detail) && passedBefore.has(x.name))) {
    const p = passedBefore.get(r.name);
    if (p.ancestor === true) regressions.push({ row: r.name, passedIn: p.run });
    else if (p.ancestor === null) possible.push({ row: r.name, passedIn: p.run, why: 'cannot tell whether that build is an ancestor of this one' });
  }
  if (regressions.length) rec.regressions = regressions;
  if (possible.length) rec.possiblyRegressed = possible;
  if (informational.length) rec.informational = informational;
  if (infoLeg !== undefined) rec.informationalLeg = infoLeg;
  if (exit === 4) return { ...rec, result: 'not-run', verdict: 'none', reason: 'not run (paused)' };
  if (exit === 143) return { ...rec, result: 'stopped', verdict: 'none', reason: 'stopped mid-leg' };
  // A leg whose only FAILs are informational exited 3 for them alone: a pass on the app.
  const result = exit === 0 || (exit === 3 && informational.length && !count('FAIL')) ? 'pass' : exit === 3 ? 'fail' : exit === 1 ? 'broken' : 'error';
  if (list(meta['env-legs']).includes(name)) return { ...rec, result, verdict: 'env', reason: (first(meta.env) || 'marked env in meta').slice(0, 200) };
  if (list(meta['harness-legs']).includes(name)) return { ...rec, result, verdict: 'harness', reason: (first(meta.harness) || 'marked harness in meta').slice(0, 200) };
  if (env.length) return { ...rec, result, verdict: 'env', reason: env[0].slice(0, 200) };
  if (result === 'broken') return { ...rec, result, verdict: 'harness', reason: (broken || 'the leg broke').slice(0, 200) };
  if (result === 'error') return { ...rec, result, verdict: 'harness', reason: `exit ${exit}` };
  if (regressions.length && result !== 'broken') return { ...rec, result: 'fail', verdict: 'app', reason: `tracked row ${regressions[0].row} passed in ${regressions[0].passedIn} and skips again: regressed` };
  if (result === 'fail') return { ...rec, result, verdict: 'app', reason: firstFail ? `${firstFail.name}: ${firstFail.detail}`.slice(0, 200) : 'a row failed' };
  return { ...rec, result, verdict: 'app', reason: `${rec.pass} pass, ${rec.skip} skip` };
}

/** Is commit `a` an ancestor of (or equal to) `b` in the repo at `dir`? null when that can't be told. */
export function isAncestor(dir, a, b) {
  if (!dir || !a || !b) return null;
  if (a === b || b.startsWith(a) || a.startsWith(b)) return true;
  try { execFileSync('git', ['-C', dir, 'merge-base', '--is-ancestor', a, b], { stdio: 'ignore' }); return true; } catch (e) {
    return e.status === 1 ? false : null; // 1: not an ancestor; anything else: unknown commit or no repo
  }
}

/**
 * Row name -> { run, ancestor } for the newest earlier run (by started=) in which it PASSed. `ancestor`: is that
 * run's build an ancestor of this one's (wallet pin, and bifold when BIFOLD_GIT or ./bifold can tell)? true, false,
 * or null when it can't be told. `repos` is { wallet, bifold } paths, injectable for tests.
 */
export function passedBeforeIn(runDir, repos = defaultRepos()) {
  const runs = path.dirname(runDir), me = parseMeta(read(path.join(runDir, 'meta')));
  const myStart = first(me.started) || '';
  const out = new Map();
  let ids = [];
  try { ids = fs.readdirSync(runs).filter((d) => d !== path.basename(runDir)); } catch { return out; }
  const earlier = ids
    .map((id) => ({ id, meta: parseMeta(read(path.join(runs, id, 'meta'))) }))
    .filter((r) => first(r.meta.started) && myStart && first(r.meta.started) < myStart)
    .sort((x, y) => (first(x.meta.started) < first(y.meta.started) ? -1 : 1));
  for (const { id, meta } of earlier) {
    let legs = [];
    try { legs = fs.readdirSync(path.join(runs, id), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { continue; }
    const wallet = isAncestor(repos.wallet, first(meta.pin), first(me.pin));
    const bifold = repos.bifold && first(meta.bifold) && first(me.bifold) ? isAncestor(repos.bifold, first(meta.bifold), first(me.bifold)) : undefined;
    const ancestor = wallet === false || bifold === false ? false : wallet === true && bifold !== null ? true : null;
    // The strongest earlier pass per row wins: an ancestor (true) over unknown (null) over a side build (false), so a
    // later pass on a side branch or an older pin cannot hide a regression an ancestor's pass shows.
    const rank = (x) => (x === true ? 2 : x === null ? 1 : 0);
    for (const leg of legs) for (const m of read(path.join(runs, id, leg, 'leg.log')).matchAll(/^ROW (.*?) PASS — /gm)) {
      const prev = out.get(m[1]);
      if (!prev || rank(ancestor) >= rank(prev.ancestor)) out.set(m[1], { run: id, ancestor });
    }
  }
  return out;
}

function defaultRepos() {
  const wallet = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const bifold = process.env.BIFOLD_GIT || (fs.existsSync(path.join(wallet, 'bifold', '.git')) ? path.join(wallet, 'bifold') : null);
  return { wallet, bifold };
}

/** The whole run. */
/** The core journeys (meta core=) no leg of this run proved, each with its legs and why. */
export function coreJourneysMissing(meta, legs) {
  const missing = [];
  for (const entry of list(meta.core)) {
    // journey:leg[,leg]@row[+row]: the rows after @ must each PASS in the proving leg, where one row is the journey
    // itself (hv-admitted: a shared-community collision SKIPs it while the leg's other rows pass, and that is no proof).
    const [journey, rest = ''] = entry.split(':');
    const [legList = '', rowList = ''] = rest.split('@');
    const names = legList.split(',').filter(Boolean);
    const required = rowList.split('+').filter(Boolean);
    const ran = legs.filter((l) => names.includes(l.name));
    const lacks = (l) => required.filter((r) => !(l.passed ?? []).includes(r));
    const proven = ran.some((l) => l.verdict === 'app' && l.result === 'pass' && l.pass > 0 && l.informationalLeg === undefined && !lacks(l).length);
    if (proven) continue;
    const why = !ran.length ? 'not run'
      : ran.map((l) => `${l.name}: ${l.informationalLeg !== undefined ? `informational (${l.informationalLeg})` : l.result === 'pass' && !l.pass ? 'every row SKIP' : l.result === 'pass' && lacks(l).length ? `${lacks(l).join(', ')} did not PASS` : `${l.result} (${l.verdict})`}`).join('; ');
    missing.push({ journey, legs: names, why: why.slice(0, 300) });
  }
  return missing;
}

export function summarize(runDir, repos) {
  const meta = parseMeta(read(path.join(runDir, 'meta')));
  const passedBefore = passedBeforeIn(runDir, repos);
  const legs = read(path.join(runDir, 'legs.tsv')).split('\n').filter(Boolean).map((l) => {
    const [name, exit, start, end] = l.split('\t');
    return legRecord({ name, exit: Number(exit), start: Number(start), end: Number(end) }, read(path.join(runDir, name, 'leg.log')), meta, passedBefore);
  });
  const by = (v) => legs.filter((l) => l.verdict === v).length;
  const appFail = legs.some((l) => l.verdict === 'app' && l.result === 'fail');
  const coreMissing = coreJourneysMissing(meta, legs);
  const fullGate = first(meta.kind) === 'gate';
  const overall = appFail ? 'fail' : legs.length && legs.every((l) => l.verdict === 'app' && l.result === 'pass') && !(fullGate && coreMissing.length) ? 'pass' : 'incomplete';
  const heads = {};
  for (const k of ['wallet', 'bifold', 'harness', 'target', 'farm', 'farm-drift', 'openvtc', 'builds', 'push-on']) if (meta[k] !== undefined) heads[k] = first(meta[k]);
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
    counts: { legs: legs.length, app: by('app'), env: by('env'), harness: by('harness'), none: by('none'), appFail: legs.filter((l) => l.verdict === 'app' && l.result === 'fail').length, regressions: legs.reduce((n, l) => n + (l.regressions?.length || 0), 0), possiblyRegressed: legs.reduce((n, l) => n + (l.possiblyRegressed?.length || 0), 0) },
    coreMissing,
    informational: legs.flatMap((l) => (l.informational || []).map((i) => ({ leg: l.name, ...i }))),
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
  for (const m of s.coreMissing) console.log(`!! core journey not proven: ${m.journey} (${m.legs.join(', ')}): ${m.why}`);
  for (const i of s.informational) console.log(`info: ${i.leg} ${i.row} — ${i.detail.slice(0, 140)} (${i.why})`);
}
