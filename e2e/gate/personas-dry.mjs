#!/usr/bin/env node
// Gate-minted personas old enough to retire: a DRY LIST, printed for Alberto to read. It deletes nothing and calls no
// agent (W5 of docs/plans/farm-test-footprint-plan.md, IN-560). A persona is listed only when:
//   - a gate run's own logs name it in full (--runs: the runs folders), so only what the gate minted can appear;
//   - no fixture names it (--fixtures: the env files, which hold every seated vetter, TUI persona, runner and
//     community DID), and it is not an agent's own DID (a name ending -vta or -vtc, a mediator, a community host);
//   - the earliest log file naming it is at least --min-age-days old (default 7);
//   - with --runner-list <slug>=<file> (a saved `pnm --vta <slug> --full-display did-mgmt dids list`), that runner
//     still manages it; the slug is printed so a later delete knows where it lives. Without runner lists the slug is "?".
//
//   node e2e/gate/personas-dry.mjs --runs ~/.keyring-fleet/gate/runs --fixtures ~/.keyring-fleet/gate/env \
//     [--runner-list keyring-mini-gate-farm3-runner-prague=/tmp/prague-dids.txt …] [--min-age-days 7] [--now <iso>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DID = /did:webvh:Qm[1-9A-HJ-NP-Za-km-z]{40,}:[a-z0-9.-]+:[A-Za-z0-9._-]+/g;

/** Every file under `p` (a file or a folder), depth-first; skips images and video. */
export function* filesUnder(p) {
  let st;
  try { st = fs.statSync(p); } catch { return; }
  if (st.isFile()) { if (!/\.(png|jpe?g|mp4|mov|gz|zip|apk|ipa)$/i.test(p)) yield p; return; }
  if (!st.isDirectory()) return;
  for (const e of fs.readdirSync(p)) yield* filesUnder(path.join(p, e));
}

/** DIDs named in full in `text`. */
export const didsIn = (text) => [...new Set(String(text).match(DID) ?? [])];

/** Whether a DID is an agent's own (a runner, a community, a mediator) rather than a persona. */
export function isAgentDid(did) {
  const [, , , host, name = ''] = did.split(':');
  return /-(vta|vtc)$/.test(name) || /mediator/.test(name) || /keyring-test|keyring-stack/.test(host);
}

/** The DIDs each saved `dids list` output names: Map did -> slug. */
export function runnerIndex(lists) {
  const at = new Map();
  for (const { slug, text } of lists) for (const d of didsIn(text)) if (!at.has(d)) at.set(d, slug);
  return at;
}

/**
 * The dry list. `seen`: [{ file, mtimeMs, text }] from the run logs; `fixtures`: texts; `runners`: Map or undefined.
 * Returns { rows: [{ did, slug, firstSeen, ageDays, file }], counts }.
 */
export function dryList({ seen, fixtures, runners, minAgeDays = 7, now = Date.now() }) {
  const fixed = new Set(fixtures.flatMap(didsIn));
  const first = new Map();
  for (const f of seen) for (const d of didsIn(f.text)) {
    const prev = first.get(d);
    if (!prev || f.mtimeMs < prev.mtimeMs) first.set(d, { mtimeMs: f.mtimeMs, file: f.file });
  }
  const counts = { inLogs: first.size, fixture: 0, agent: 0, tooYoung: 0, notOnRunner: 0, listed: 0 };
  const rows = [];
  for (const [did, { mtimeMs, file }] of first) {
    if (fixed.has(did)) { counts.fixture++; continue; }
    if (isAgentDid(did)) { counts.agent++; continue; }
    const ageDays = (now - mtimeMs) / 86400000;
    if (ageDays < minAgeDays) { counts.tooYoung++; continue; }
    const slug = runners ? runners.get(did) : '?';
    if (runners && !slug) { counts.notOnRunner++; continue; }
    rows.push({ did, slug, firstSeen: new Date(mtimeMs).toISOString().slice(0, 10), ageDays: Math.floor(ageDays), file });
    counts.listed++;
  }
  rows.sort((a, b) => a.firstSeen.localeCompare(b.firstSeen) || a.did.localeCompare(b.did));
  return { rows, counts };
}

function main(argv) {
  const opt = { runs: [], fixtures: [], lists: [], minAgeDays: 7, now: Date.now() };
  for (let i = 0; i < argv.length; i++) {
    const [k, v] = [argv[i], argv[i + 1]];
    if (k === '--runs') { opt.runs.push(v); i++; }
    else if (k === '--fixtures') { opt.fixtures.push(v); i++; }
    else if (k === '--runner-list') { const at = v.indexOf('='); opt.lists.push({ slug: v.slice(0, at), file: v.slice(at + 1) }); i++; }
    else if (k === '--min-age-days') { opt.minAgeDays = Number(v); i++; }
    else if (k === '--now') { opt.now = Date.parse(v); i++; }
    else { console.error(`personas-dry: unknown argument ${k}`); process.exit(2); }
  }
  if (!opt.runs.length || !opt.fixtures.length) { console.error('personas-dry: --runs and --fixtures are both required (never list without the fixtures)'); process.exit(2); }
  const seen = opt.runs.flatMap((r) => [...filesUnder(r)]).map((file) => ({ file, mtimeMs: fs.statSync(file).mtimeMs, text: fs.readFileSync(file, 'utf8') }));
  const fixtures = opt.fixtures.flatMap((r) => [...filesUnder(r)]).map((f) => fs.readFileSync(f, 'utf8'));
  if (!fixtures.length) { console.error('personas-dry: the --fixtures paths hold no file: refusing to list'); process.exit(2); }
  const runners = opt.lists.length ? runnerIndex(opt.lists.map(({ slug, file }) => ({ slug, text: fs.readFileSync(file, 'utf8') }))) : undefined;
  const { rows, counts } = dryList({ seen, fixtures, runners, minAgeDays: opt.minAgeDays, now: opt.now });
  console.log('# DRY LIST — nothing is deleted. Gate-minted personas, first seen in a gate run at least', opt.minAgeDays, 'days ago.');
  console.log(`# in logs ${counts.inLogs} · fixtures ${counts.fixture} · agents ${counts.agent} · younger ${counts.tooYoung} · not on a listed runner ${counts.notOnRunner} · listed ${counts.listed}`);
  console.log(['did', 'runner', 'first_seen', 'age_days', 'first_log'].join('\t'));
  for (const r of rows) console.log([r.did, r.slug, r.firstSeen, r.ageDays, r.file].join('\t'));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
