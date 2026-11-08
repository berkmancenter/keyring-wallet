// node --test e2e/gate/personasDry.test.mjs
// The persona dry list (personas-dry.mjs): only gate-minted personas, never a fixture or an agent's own DID, only when
// old enough, and (with runner lists) only those a runner still manages. It lists; it never deletes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dryList, isAgentDid, runnerIndex } from './personas-dry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const scid = (c) => `Qm${c.repeat(44)}`;
const P_OLD = `did:webvh:${scid('a')}:dids.ic3.dev:frown-coral`;
const P_NEW = `did:webvh:${scid('b')}:dids.ic3.dev:pause-canyon`;
const VETTER = `did:webvh:${scid('c')}:dids.ic3.dev:marine-yard`;
const RUNNER = `did:webvh:${scid('d')}:dids.ic3.dev:keyring-runner-prague-vta`;
const COMMUNITY = `did:webvh:${scid('e')}:dids-keyring-test.ic3.dev:keyring-lab-community-vtc`;
const NOW = Date.parse('2026-11-08T12:00:00Z');
const day = 86400000;
const seen = [
  { file: 'runs/1025-x/kk/vetting.out', mtimeMs: NOW - 14 * day, text: `JOIN_MEMBER ${P_OLD}\nvetter ${VETTER}\nrunner ${RUNNER}` },
  { file: 'runs/1107-y/waiting/leg.log', mtimeMs: NOW - 1 * day, text: `newest is from ${P_NEW}; ${P_OLD} again; C ${COMMUNITY}` },
];
const fixtures = [`VETTER_DID=${VETTER}\nRUNNER_MAIN_DID="${RUNNER}"`];

test('only an old gate-minted persona is listed; a fixture, an agent and a young one are not', () => {
  const { rows, counts } = dryList({ seen, fixtures, now: NOW });
  assert.deepEqual(rows.map((r) => r.did), [P_OLD]);
  assert.equal(rows[0].firstSeen, '2026-10-25');
  assert.equal(rows[0].ageDays, 14);
  assert.deepEqual({ ...counts }, { inLogs: 5, fixture: 2, agent: 1, tooYoung: 1, notOnRunner: 0, listed: 1 });
});

test('a persona is aged by the EARLIEST log naming it, not the latest', () => {
  assert.equal(dryList({ seen: [...seen].reverse(), fixtures, now: NOW }).rows[0].firstSeen, '2026-10-25');
});

test('with runner lists, only personas a runner still manages are listed, with its slug', () => {
  const on = runnerIndex([{ slug: 'mini-prague', text: `│— ${P_OLD} vta control yes 2026-10-` }]);
  assert.deepEqual(dryList({ seen, fixtures, runners: on, now: NOW }).rows.map((r) => [r.did, r.slug]), [[P_OLD, 'mini-prague']]);
  const off = runnerIndex([{ slug: 'mini-prague', text: 'no DIDs here' }]);
  const r = dryList({ seen, fixtures, runners: off, now: NOW });
  assert.equal(r.rows.length, 0);
  assert.equal(r.counts.notOnRunner, 1);
});

test('control: with the fixture left out, the seated vetter WOULD be listed, so the fixture check is what protects it', () => {
  assert.ok(dryList({ seen, fixtures: [''], now: NOW }).rows.some((r) => r.did === VETTER));
});

test('agent DIDs are recognised: runners and communities by name, community hosts by host', () => {
  assert.ok(isAgentDid(RUNNER) && isAgentDid(COMMUNITY));
  assert.ok(!isAgentDid(P_OLD) && !isAgentDid(VETTER));
});

test('the CLI refuses to list without fixtures, and its output says it is a dry list and holds no delete command', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'personas-'));
  try {
    mkdirSync(path.join(dir, 'runs/1025-x'), { recursive: true }); mkdirSync(path.join(dir, 'env'));
    const log = path.join(dir, 'runs/1025-x/leg.log');
    writeFileSync(log, `JOIN_MEMBER ${P_OLD}\n`); utimesSync(log, (NOW - 14 * day) / 1000, (NOW - 14 * day) / 1000);
    writeFileSync(path.join(dir, 'env/farm.env'), `VETTER_DID=${VETTER}\n`);
    const cli = path.join(here, 'personas-dry.mjs');
    assert.throws(() => execFileSync('node', [cli, '--runs', path.join(dir, 'runs')], { stdio: 'pipe' }));
    assert.throws(() => execFileSync('node', [cli, '--runs', path.join(dir, 'runs'), '--fixtures', path.join(dir, 'nothing')], { stdio: 'pipe' }));
    const out = execFileSync('node', [cli, '--runs', path.join(dir, 'runs'), '--fixtures', path.join(dir, 'env'), '--now', new Date(NOW).toISOString()]).toString();
    assert.match(out, /^# DRY LIST — nothing is deleted/m);
    assert.match(out, new RegExp(`^${P_OLD}\\t\\?\\t2026-10-25\\t14\\t`, 'm'));
    assert.doesNotMatch(out, /\bdelete\b(?! *is)/i.source ? /dids delete|acl delete/ : /x/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the script itself calls no agent and deletes nothing', () => {
  const src = readFileSync(path.join(here, 'personas-dry.mjs'), 'utf8');
  assert.doesNotMatch(src, /child_process|execFile|spawn|pnm-locked|fetch\(/);
  assert.doesNotMatch(src, /unlinkSync|rmSync|writeFileSync/);
});
