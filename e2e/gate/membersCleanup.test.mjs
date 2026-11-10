// node --test e2e/gate/membersCleanup.test.mjs
// W5 of docs/plans/farm-test-footprint-plan.md (IN-560): p1 and kk take their applicant off the lab community at
// cleanup, as the other joining legs do, from the drivers' `JOIN_MEMBER <did>` lines. Side by side (a gate's iOS and
// Android groups) the removal waits for the run's end, so p1 (which knows its applicant only by join time) can never
// take kk's member while kk still runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = readFileSync(path.join(here, 'lib.sh'), 'utf8');
const fn = (name) => lib.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}$`, 'm'))?.[0];
const remove = fn('c_members_remove');
const deferred = fn('c_members_deferred');

/** Runs `body` with a fake c_admin that logs each call. Returns the calls, what was echoed, and the defer file. */
function withFake(files, body, env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'members-'));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
    const calls = path.join(dir, 'calls');
    const vars = Object.entries(env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('; ');
    const out = execFileSync('bash', ['-c', `set -u
      D=${JSON.stringify(dir)}; RUN_DIR=$D; GATE_HOME=$D; C_DID=did:example:C; C_REST=https://c.example; ${vars}
      say() { echo "SAY $*"; }
      c_admin() { echo "$*" >> ${JSON.stringify(calls)}; echo "member-removed -> 3"; }
      ${remove}
      ${deferred}
      ${body}`]).toString();
    const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : []);
    return { calls: read(calls), out, defer: read(path.join(dir, 'defer-members')) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const A = 'did:webvh:QmA:dids.ic3.dev:frown-coral', B = 'did:webvh:QmB:dids.ic3.dev:pause-canyon';
const OUT = { 'p1.out': `[e2e] something\nJOIN_MEMBER ${A}\nnoise JOIN_MEMBER not-at-start\n`, 'vetting.out': `JOIN_MEMBER ${A}\nJOIN_MEMBER ${B}\n` };

test('lib.sh has the helpers', () => assert.ok(remove && deferred));

test('every named member is removed once, with the leg\'s reason, from all the driver outputs given', () => {
  const { calls } = withFake(OUT, 'c_members_remove "gate: kk applicant" "$D/p1.out" "$D/vetting.out"');
  assert.deepEqual(calls.sort(), [`member-remove ${A} gate: kk applicant`, `member-remove ${B} gate: kk applicant`].sort());
});

test('a driver output with no JOIN_MEMBER line, or none at all, removes nothing (control)', () => {
  assert.deepEqual(withFake({ 'x.out': 'nothing here\n' }, 'c_members_remove why "$D/x.out" "$D/missing.out"').calls, []);
});

test('side by side the removal is deferred to $GATE_HOME, tagged with the community: no call now', () => {
  const now = withFake(OUT, 'c_members_remove "gate: p1 applicant" "$D/p1.out" "$D/vetting.out"', { GATE_DEFER_KEYS: '1' });
  assert.deepEqual(now.calls, []);
  assert.deepEqual(now.defer.map((l) => l.split('\t').slice(0, 2)).sort(), [['did:example:C', A], ['did:example:C', B]].sort());
});

test('the drain removes each of this community\'s members once and keeps another community\'s lines', () => {
  const later = withFake({ ...OUT, 'defer-members': `did:example:C\t${A}\tgate: p1\ndid:example:C\t${A}\tgate: kk\ndid:example:C\t${B}\tgate: kk\ndid:example:OTHER\t${B}\tgate: other env\n` },
    'c_members_deferred');
  assert.deepEqual(later.calls.map((c) => c.split(' ')[1]).sort(), [A, B].sort(), later.calls.join('\n'));
  assert.deepEqual(later.defer, [`did:example:OTHER\t${B}\tgate: other env`]);
});

test('with no community in the env the drain touches nothing and keeps the list', () => {
  const r = withFake({ 'defer-members': `did:example:C\t${A}\tgate: p1\n` }, 'C_DID=; c_members_deferred');
  assert.deepEqual(r.calls, []);
  assert.equal(r.defer.length, 1);
});

test('kk and p1 remove their members at cleanup, from their own drivers\' output', () => {
  const kk = readFileSync(path.join(here, 'legs/kk.sh'), 'utf8');
  const p1 = readFileSync(path.join(here, 'legs/p1.sh'), 'utf8');
  assert.match(kk.match(/^fin\(\) \{[\s\S]*?^\}$/m)?.[0] ?? '', /c_members_remove "gate: kk applicant, removed after the leg" "\$LEG_DIR\/vetting\.out"/);
  assert.match(p1.match(/^fin\(\) \{[\s\S]*?^\}$/m)?.[0] ?? '', /c_members_remove "gate: p1 applicant, removed after the leg" "\$LEG_DIR\/p1\.out"/);
  assert.match(kk, /run-vti-vetting\.js > "\$LEG_DIR\/vetting\.out"/);
  assert.match(p1, /run-phase1\.mjs[\s\S]*?> "\$LEG_DIR\/p1\.out"/);
});

test('the drivers name the member: kk\'s by the request\'s applicant, p1\'s by the same test as communityListsMember', () => {
  const vetting = readFileSync(path.join(here, '..', 'run-vti-vetting.js'), 'utf8');
  const phase1 = readFileSync(path.join(here, '..', 'openvtc', 'run-phase1.mjs'), 'utf8');
  assert.match(vetting, /console\.log\(`JOIN_MEMBER \$\{request\.applicantDid\}`\)/);
  assert.match(phase1, /const own = p1OwnMember\(\{ before: membersBefore, after: allMembers\(memberSource\), startedAt, fixtures, green: !failure && report\.communityHasMember \}\);\n\s+if \(own\.did\) console\.log\(`JOIN_MEMBER \$\{own\.did\}`\);/);
  assert.doesNotMatch(phase1, /joinedAt[^\n]*console\.log\(`JOIN_MEMBER/, 'no pure time-window selection left');
});

test('gate.sh drains deferred members after each side-by-side pass and at the start of run, rerun and changed', () => {
  const gate = readFileSync(path.join(here, 'gate.sh'), 'utf8');
  assert.equal((gate.match(/^\s+c_members_deferred\b/gm) || []).length, 5);
  assert.equal((gate.match(/^  gate_sweep[^\n]*\n  c_members_deferred/gm) || []).length, 3, 'right after gate_sweep, under the run lock');
});
