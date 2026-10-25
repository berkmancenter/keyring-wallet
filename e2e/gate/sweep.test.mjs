// node --test e2e/gate/sweep.test.mjs
// The start-of-gate sweep removes every gate rule and gate approver it lists, even when pnm reads stdin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = readFileSync(path.join(here, 'lib.sh'), 'utf8');
// pnm() spans several lines (its CI guard); is_ci and the refused slugs it reads come with it. Off CI (here) the guard
// is skipped, so the sweep sees the Mac's pnm.
const pnmFn = lib.match(/^pnm\(\) \{[\s\S]*?^\}$/m)?.[0];
const ciBits = [lib.match(/^is_ci\(\) \{.*\}$/m)?.[0], lib.match(/^CI_REFUSED_SLUGS=.*$/m)?.[0]].join('\n');
const tasks = lib.match(/^GATE_RULE_TASKS=.*$/m)?.[0];
const sweep = lib.match(/^gate_sweep_runner\(\) \{[\s\S]*?^\}$/m)?.[0];

const APPROVALS = JSON.stringify({
  rules: [
    { taskType: 'https://trusttasks.org/spec/acl/swap-key/0.1', approverSet: 'gate-r11-held' },
    { taskType: 'https://trusttasks.org/spec/vta/contexts/get/1.0', approverSet: 'gate-linkfail' },
    { taskType: 'https://example.org/someone-elses/task', approverSet: 'people' },
  ],
  approverSets: { 'gate-r11-held': ['did:example:a', 'did:example:b'], people: ['did:example:person'] },
});

/** The sweep over a fake pnm-locked that reads all of stdin on every removal. Returns the removals it was asked for. */
function runSweep(pnmDefinition) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sweep-'));
  try {
    mkdirSync(path.join(dir, 'scripts/openvtc'), { recursive: true });
    const fake = path.join(dir, 'scripts/openvtc/pnm-locked');
    writeFileSync(fake, `#!/bin/bash
shift 2  # --vta <slug>
case "$*" in
  "approvals list --json") printf '%s\\n' '${APPROVALS}' ;;
  "policy list") ;;
  *) cat > /dev/null; echo "$*" >> "$CALLS" ;;
esac
`);
    chmodSync(fake, 0o755);
    const script = `
      set -u
      say() { :; }; sleep() { :; }
      REPO=${JSON.stringify(dir)}; PNM_BIN=unused
      ${ciBits}
      ${pnmDefinition}
      ${tasks}
      ${sweep}
      gate_sweep_runner farm3-runner-test
    `;
    execFileSync('bash', ['-c', script], { env: { ...process.env, CALLS: path.join(dir, 'calls') }, input: 'stdin of the caller\n' });
    const calls = path.join(dir, 'calls');
    return existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('lib.sh has the pieces to test', () => {
  assert.ok(pnmFn && tasks && sweep);
});

test('every gate rule and gate approver is removed, foreign ones are left, though pnm reads stdin', () => {
  assert.deepEqual(runSweep(pnmFn), [
    'approvals remove https://trusttasks.org/spec/acl/swap-key/0.1',
    'approvals remove https://trusttasks.org/spec/vta/contexts/get/1.0',
    'approvals approvers remove gate-r11-held did:example:a',
    'approvals approvers remove gate-r11-held did:example:b',
  ]);
});

test('a pnm on the caller’s stdin removes only the first (the bug this guards)', () => {
  const onStdin = pnmFn.replace(' </dev/null', '');
  assert.notEqual(onStdin, pnmFn, 'the stdin variant was not made');
  assert.deepEqual(runSweep(onStdin), ['approvals remove https://trusttasks.org/spec/acl/swap-key/0.1']);
});
