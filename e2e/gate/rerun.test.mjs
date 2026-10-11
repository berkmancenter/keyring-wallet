// node --test e2e/gate/rerun.test.mjs
// gate.sh rerun runs every leg that did not pass, even when a leg reads stdin (as adb, node and pnm do).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gate = readFileSync(path.join(here, 'gate.sh'), 'utf8');
const rerunLegs = gate.match(/^rerun_legs\(\) \{[\s\S]*?^\}$/m)?.[0];

/** Run a rerun loop over legs.tsv with a run_leg that reads all of stdin, as a real leg's programs can. */
function rerun(loop) {
  const dir = mkdtempSync(path.join(tmpdir(), 'rerun-'));
  try {
    writeFileSync(path.join(dir, 'legs.tsv'), ['kk\t0\t1\t2', 'update-ios\t1\t3\t4', 'p1\t4\t5\t5', 'testreq\t143\t6\t7', 'linkwait\t3\t8\t9', ''].join('\n'));
    const script = `
      set -u
      run_leg() { cat > /dev/null; echo "$2|\${3:-}" >> "$CALLS"; }
      leg_rows() { printf 'FAIL\\tlink-no-answer\\tthrew\\nPASS\\tother\\tok\\n'; }
      ${loop}
      rerun_legs "$OLD" "$NEW"
    `;
    execFileSync('bash', ['-c', script], { env: { ...process.env, OLD: dir, NEW: dir, CALLS: path.join(dir, 'calls') }, input: 'stdin of the caller\n' });
    const calls = path.join(dir, 'calls');
    return existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('gate.sh has a rerun_legs function to test', () => {
  assert.ok(rerunLegs, 'rerun_legs() { … } not found in gate.sh');
});

test('every leg that did not pass reruns, though each one reads stdin', () => {
  assert.deepEqual(rerun(rerunLegs), ['update-ios|', 'p1|', 'testreq|', 'linkwait|link-no-answer']);
});

test('the same loop fed on stdin loses the legs after the first (the bug this guards)', () => {
  const onStdin = rerunLegs.replace(' <&3; do', '; do').replace(/done 3< "\$old\/legs\.tsv"/, 'done < "$old/legs.tsv"');
  assert.notEqual(onStdin, rerunLegs, 'the stdin variant was not made');
  assert.deepEqual(rerun(onStdin), ['update-ios|']);
});
