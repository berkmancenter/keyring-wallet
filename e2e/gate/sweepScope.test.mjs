// node --test e2e/gate/sweepScope.test.mjs
// The start-of-run sweep calls pnm only on the runners the run's legs use (W9, docs/plans/farm-test-footprint-plan.md):
// a pair-ios-only run makes no pnm call at all, and a run whose legs use a runner still removes a leftover gate rule
// seeded there. The leg scripts are the real ones (legs/*.sh); pnm-locked is a fake that logs every call by slug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = readFileSync(path.join(here, 'lib.sh'), 'utf8');
const gate = readFileSync(path.join(here, 'gate.sh'), 'utf8');
const fn = (src, name) => src.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}$`, 'm'))?.[0];
const line = (src, re) => src.match(re)?.[0];
const pieces = {
  pnm: fn(lib, 'pnm'),
  ci: [line(lib, /^is_ci\(\) \{.*\}$/m), line(lib, /^CI_REFUSED_SLUGS=.*$/m)].join('\n'),
  tasks: line(lib, /^GATE_RULE_TASKS=.*$/m),
  sweep: fn(lib, 'gate_sweep'),
  runnersFor: fn(lib, 'sweep_runners_for'),
  sweepRunner: fn(lib, 'gate_sweep_runner'),
  legLists: ['LEGS_IOS', 'LEGS_ANDROID', 'LEGS_SOLO', 'LEGS_NIGHTLY_ONLY', 'LEGS_BY_NAME_ONLY']
    .map((v) => line(gate, new RegExp(`^${v}=.*$`, 'm'))).join('\n'),
  legWanted: fn(gate, 'leg_wanted'),
  wantedLegs: line(gate, /^wanted_legs\(\) \{.*\}$/m),
};

// One leftover gate rule on every runner, as a run killed mid-leg leaves it (1009-1608).
const APPROVALS = JSON.stringify({ rules: [{ taskType: 'https://trusttasks.org/spec/acl/swap-key/0.1', approverSet: 'gate-swap-held' }], approverSets: {} });
const ENV = { RUNNER_MAIN_SLUG: 'farm3-runner-uiux', RUNNER_A_SLUG: 'farm3-runner-mini', RUNNER_B_SLUG: 'farm3-runner-openvtc' };

/** gate_sweep over the given legs (a bash word list). Returns every pnm call as "<slug> <args>", and what it said. */
function sweepFor(legs, env = ENV, sweepSrc = pieces.sweep, call = `gate_sweep ${legs}`) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sweep-scope-'));
  try {
    mkdirSync(path.join(dir, 'scripts/openvtc'), { recursive: true });
    const fake = path.join(dir, 'scripts/openvtc/pnm-locked');
    writeFileSync(fake, `#!/bin/bash
slug=$2; shift 2
echo "$slug $*" >> "$CALLS"
case "$*" in
  "approvals list --json") printf '%s\\n' '${APPROVALS}' ;;
  "policy list") ;;
  *) cat > /dev/null ;;
esac
`);
    chmodSync(fake, 0o755);
    const exports = Object.entries(env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('; ');
    const script = `
      set -u
      say() { echo "SAY $*"; }; sleep() { :; }; galarm_reap() { :; }
      REPO=${JSON.stringify(dir)}; GATE_SRC=${JSON.stringify(here)}; PNM_BIN=unused
      ${exports}
      ${pieces.ci}
      ${pieces.pnm}
      ${pieces.tasks}
      ${pieces.runnersFor}
      ${pieces.sweepRunner}
      ${sweepSrc}
      ${call}
    `;
    const out = execFileSync('bash', ['-c', script], { env: { ...process.env, CALLS: path.join(dir, 'calls') }, input: '' }).toString();
    const calls = path.join(dir, 'calls');
    return { calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [], said: out.split('\n').filter((l) => l.startsWith('SAY ')) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const slugsCalled = (calls) => [...new Set(calls.map((c) => c.split(' ')[0]))].sort();

test('lib.sh and gate.sh have the pieces to test', () => {
  for (const [k, v] of Object.entries(pieces)) assert.ok(v && !v.includes('undefined'), `missing ${k}`);
});

test('a pair-ios-only run makes no pnm call at all, and says which runners it left', () => {
  const { calls, said } = sweepFor('pair-ios');
  assert.deepEqual(calls, []);
  assert.ok(said.some((l) => l.includes('not swept') && l.includes('farm3-runner-mini') && l.includes('farm3-runner-uiux') && l.includes('farm3-runner-openvtc')), said.join('\n'));
});

test('a leg that uses only the main runner sweeps only it, and still removes the leftover rule there', () => {
  const { calls } = sweepFor('testreq');
  assert.deepEqual(slugsCalled(calls), ['farm3-runner-uiux']);
  assert.ok(calls.includes('farm3-runner-uiux approvals remove https://trusttasks.org/spec/acl/swap-key/0.1'), calls.join('\n'));
});

test('linkfail names runner A only by its DID (the approver), so A is not swept', () => {
  assert.deepEqual(slugsCalled(sweepFor('linkfail').calls), ['farm3-runner-uiux']);
});

test('agents uses all three runners, and each gets its leftover removed', () => {
  const { calls } = sweepFor('agents');
  assert.deepEqual(slugsCalled(calls), ['farm3-runner-mini', 'farm3-runner-openvtc', 'farm3-runner-uiux']);
  assert.equal(calls.filter((c) => c.endsWith('approvals remove https://trusttasks.org/spec/acl/swap-key/0.1')).length, 3);
});

test('no legs named, or a leg with no script: every runner, as before', () => {
  assert.equal(slugsCalled(sweepFor('').calls).length, 3);
  assert.equal(slugsCalled(sweepFor('pair-ios no-such-leg').calls).length, 3);
});

test('a runner named twice (A = MAIN, as on the mini) is swept once and never reported as not swept', () => {
  const env = { RUNNER_MAIN_SLUG: 'mini-prague', RUNNER_A_SLUG: 'mini-prague', RUNNER_B_SLUG: 'mini-prague' };
  const { calls, said } = sweepFor('testreq', env);
  assert.equal(calls.filter((c) => c === 'mini-prague approvals list --json').length, 1);
  assert.ok(!said.some((l) => l.includes('not swept')), said.join('\n'));
});

test('wanted_legs expands --legs as run_legs does: all, a list, and pair-ios alone', () => {
  const run = (spec) => execFileSync('bash', ['-c', `${pieces.legLists}\n${pieces.legWanted}\n${pieces.wantedLegs}\nwanted_legs ${JSON.stringify(spec)}`]).toString().trim().split('\n').filter(Boolean);
  assert.deepEqual(run('pair-ios'), ['pair-ios']);
  assert.deepEqual(run('kk,smoke-ios').sort(), ['kk', 'smoke-ios']);
  const all = run('all');
  assert.ok(all.includes('linkfail') && all.includes('pair-ios') && all.includes('agents'));
  assert.ok(!all.includes('p2') && !all.includes('signin'), 'nightly-only and by-name-only legs stay out of all');
});

test('every leg gate.sh can schedule has a script, so none falls back to sweeping everything', () => {
  for (const l of `${line(gate, /^LEGS_IOS=.*$/m)} ${line(gate, /^LEGS_ANDROID=.*$/m)} ${line(gate, /^LEGS_SOLO=.*$/m)}`.replace(/LEGS_[A-Z]+=|"/g, '').split(/\s+/).filter(Boolean)) {
    assert.ok(existsSync(path.join(here, 'legs', `${l}.sh`)), `no legs/${l}.sh`);
  }
});

test('control: the old sweep (all three, whatever the legs) fails the pair-ios case', () => {
  const old = `gate_sweep() {
  local slug seen=" "
  galarm_reap
  for slug in "\${RUNNER_MAIN_SLUG:-}" "\${RUNNER_A_SLUG:-}" "\${RUNNER_B_SLUG:-}"; do
    [ -n "$slug" ] && [[ "$seen" != *" $slug "* ]] || continue; seen="$seen$slug "
    gate_sweep_runner "$slug"
  done
}`;
  assert.equal(slugsCalled(sweepFor('pair-ios', ENV, old).calls).length, 3);
});
