#!/usr/bin/env node
// Whether tonight's nightly runs the link legs (linkwait, linkfail, pnmlink). W1 of
// docs/plans/farm-test-footprint-plan.md (IN-560): they leave the nightly's fixed list and run only when
//   (a) a change touches linking: a path rule on last night's pin to tonight's, in both repos (changed.mjs maps diffs
//       only through testIDs, so VtaClient.ts and vtaAgent.ts come back "unmapped");
//   (b) a runner VTA's or pnm's version changed: the VTA's `info.version` from <url>/openapi.json, and the sha256 of
//       each pnm file the gate's wrapper can run;
//   (c) always, on the store-build gate (gate.sh run --kind gate: not this file's business).
// With no recorded fingerprint, or no last nightly, it says run: never skip on what it cannot compare.
// A rollback range (tonight's pin behind the recorded one) reads its file changes like any range, which can read as none;
// the fingerprint axis (a runner or pnm moving) still covers what a rollback changes on the Farm side.
//
//   linkTrigger.mjs --range <last-pin>..<pin> [--fingerprint-file F] [--runner slug=url …] [--pnm file …] [--json]
//   exit 0: run the link legs; 1: no trigger.
//   linkTrigger.mjs --record --pin <pin> --fingerprint-file F [--runner …] [--pnm …]: the pin and fingerprint checked
//   through (gate.sh link_record, at the end of the nightly run that ran the Android part).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedFiles } from './changed.mjs';

/** The link code: the app's link screens and clients, and the harness that drives a link. Tests never count. */
export const LINK_PATHS = [
  /^bifold\/packages\/core\/src\/modules\/trust-tasks\/screens\/(VtaLink|AgentCreate|MyAgent)[^/]*\.tsx?$/,
  /^bifold\/packages\/core\/src\/modules\/trust-tasks\/screens\/linkFailureWords\.ts$/,
  /^bifold\/packages\/core\/src\/modules\/trust-tasks\/module\/(VtaClient|vtaAgent|VtaLinkStore)\.ts$/,
  /^bifold\/packages\/core\/src\/navigators\/MyAgentStack\.tsx$/,
  // The whole trust-tasks package: VtaClient.ts signs the whoAmI probe and every sendTask document with it
  // (signDocumentProof, signCompactJws, tsp), so a change there changes what every link sends. #974 changed
  // documentProof.ts inside the 278.7 pin bump, which this rule first read as NO (ac on #874).
  /^bifold\/packages\/trust-tasks\/src\//,
  /^e2e\/run-vta-link\.js$/,
  /^e2e\/lib\/aclCleanup\.js$/,
  /^e2e\/lib\/pages\/link\.js$/,
  /^e2e\/gate\/legs\/(link[a-z]*|pnmlink)\.sh$/,
];
const isTest = (f) => /(^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(f);

/** The changed files the link rule matches. */
export const linkFiles = (files) => files.filter((f) => !isTest(f) && LINK_PATHS.some((re) => re.test(f)));

/** What changed between two fingerprints ({ runners: {slug: version}, pnm: {file: sha} }); every key of either side. */
export function fingerprintDiff(prev, now) {
  if (!prev) return ['no recorded fingerprint'];
  const out = [];
  for (const part of ['runners', 'pnm']) {
    const a = prev[part] ?? {}, b = now[part] ?? {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) out.push(`${part === 'runners' ? 'VTA' : 'pnm'} ${k}: ${a[k] ?? 'none'} → ${b[k] ?? 'none'}`);
  }
  return out;
}

/** The decision from its parts: run when any trigger fired; an unknown range runs. */
export function decide({ files, rangeKnown = true, rangeWhy = 'no last nightly pin to compare with', prevFingerprint, fingerprint }) {
  const why = [];
  if (!rangeKnown) why.push(rangeWhy);
  else for (const f of linkFiles(files)) why.push(`link file changed: ${f}`);
  for (const d of fingerprintDiff(prevFingerprint, fingerprint)) why.push(d);
  return { run: why.length > 0, why };
}

/** The served version, read-only: <url>/openapi.json info.version, or "unread". */
function servedVersion(url) {
  try {
    const out = execFileSync('curl', ['-s', '-m', '15', `${url.replace(/\/$/, '')}/openapi.json`], { encoding: 'utf8' });
    return JSON.parse(out)?.info?.version ?? 'unread';
  } catch {
    return 'unread';
  }
}
const sha = (file) => { try { return createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16); } catch { return 'missing'; } };

function main(argv) {
  const opt = { runners: [], pnm: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--range') opt.range = argv[++i];
    else if (k === '--fingerprint-file') opt.file = argv[++i];
    else if (k === '--runner') opt.runners.push(argv[++i]);
    else if (k === '--pnm') opt.pnm.push(argv[++i]);
    else if (k === '--record') opt.record = true;
    else if (k === '--pin') opt.pin = argv[++i];
    else if (k === '--json') opt.json = true;
    else { console.error(`linkTrigger: unknown argument ${k}`); process.exit(2); }
  }
  const fingerprint = {
    runners: Object.fromEntries(opt.runners.map((r) => { const at = r.indexOf('='); return [r.slice(0, at), servedVersion(r.slice(at + 1))]; })),
    pnm: Object.fromEntries(opt.pnm.map((f) => [path.basename(path.dirname(f)) + '/' + path.basename(f), sha(f)])),
  };
  if (opt.record) {
    if (!opt.file || !opt.pin) { console.error('linkTrigger: --record needs --fingerprint-file and --pin'); process.exit(2); }
    fs.mkdirSync(path.dirname(opt.file), { recursive: true });
    fs.writeFileSync(opt.file, JSON.stringify({ pin: opt.pin, ...fingerprint, at: new Date().toISOString() }, null, 2));
    console.log(`recorded ${opt.file}`);
    return;
  }
  let prev;
  try { prev = opt.file ? JSON.parse(fs.readFileSync(opt.file, 'utf8')) : undefined; } catch { prev = undefined; }
  let files = [], rangeKnown = Boolean(opt.range && !opt.range.startsWith('..')), rangeWhy;
  if (rangeKnown) {
    try { files = changedFiles(opt.range); } catch (e) {
      rangeKnown = false;
      rangeWhy = `the range ${opt.range} could not be read (${String(e.message).split('\n')[0].slice(0, 120)}; an empty bifold/ in a worktree needs BIFOLD_GIT)`;
    }
  }
  const d = decide({ files, rangeKnown, rangeWhy, prevFingerprint: prev, fingerprint });
  if (opt.json) console.log(JSON.stringify({ ...d, fingerprint }, null, 2));
  else console.log(d.run ? `RUN link legs: ${d.why.join('; ')}` : 'NO link trigger: no link file changed, no runner or pnm version moved');
  process.exitCode = d.run ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
