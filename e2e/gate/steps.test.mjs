// node --test e2e/gate/steps.test.mjs — gate-efficiency phase 0: every leg's steps.tsv, and the report's step line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dur, parseSteps, stepsLine, sumSteps } from './steps.mjs';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib.sh');

test('steps.tsv lines parse, and malformed ones are skipped', () => {
  assert.deepEqual(parseSteps('run-vta-link.js\t1790000000\t200\nbad line\nemu_start 5572\t1790000300\t41\n\n'), [
    { name: 'run-vta-link.js', start: 1790000000, seconds: 200 },
    { name: 'emu_start 5572', start: 1790000300, seconds: 41 },
  ]);
});

test('steps sum by name, longest first, and the line names counts and the timed total', () => {
  const steps = parseSteps(['run-vta-link.js\t1\t600', 'run-vta-link.js\t2\t300', 'emu_start 5572\t3\t40', 'vtc-admin.mjs\t4\t5', 'sim_boot\t5\t20', 'x.mjs\t6\t1'].join('\n'));
  assert.deepEqual(sumSteps(steps).map((s) => [s.name, s.count, s.seconds]), [
    ['run-vta-link.js', 2, 900], ['emu_start 5572', 1, 40], ['sim_boot', 1, 20], ['vtc-admin.mjs', 1, 5], ['x.mjs', 1, 1],
  ]);
  assert.equal(stepsLine(steps), 'steps: run-vta-link.js 2× 15m, emu_start 5572 40s, sim_boot 20s, vtc-admin.mjs 5s, +1 more (timed 16m6s)');
  assert.equal(stepsLine([]), '');
  assert.equal(dur(75), '1m15s');
  assert.equal(dur(3600), '60m');
});

/** Source lib.sh in a scratch leg folder and run `body`; returns { out, steps } (steps: the file's lines). */
function leg(body) {
  const dir = mkdtempSync(path.join(tmpdir(), 'steps-'));
  try {
    const r = spawnSync('bash', ['-c', `export GATE_HOME="$D/home" LEG_DIR="$D/leg"; mkdir -p "$GATE_HOME" "$LEG_DIR"; . "${LIB}" >/dev/null 2>&1; ${body}`], {
      env: { ...process.env, D: dir }, encoding: 'utf8',
    });
    const f = path.join(dir, 'leg', 'steps.tsv');
    return { out: r.stdout.trim(), steps: existsSync(f) ? parseSteps(readFileSync(f, 'utf8')) : [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('galarm records each run under its script name, and keeps the command\'s exit status', () => {
  const { out, steps } = leg(`galarm 10 perl -e 'sleep 1' marker-driver.mjs; echo rc=$?; galarm 10 sh -c 'exit 3' check.sh; echo rc=$?`);
  assert.equal(out, 'rc=0\nrc=3');
  assert.deepEqual(steps.map((s) => s.name), ['marker-driver.mjs', 'check.sh']);
  assert.ok(steps[0].seconds >= 1, `a 1 s sleep took ${steps[0].seconds} s`);
});

test('GALARM_STEPS=0 (a leg timing its own phases) records nothing, and no LEG_DIR records nothing', () => {
  assert.deepEqual(leg(`GALARM_STEPS=0 galarm 10 true quiet.mjs`).steps, []);
  const { out } = leg(`unset LEG_DIR; galarm 10 true quiet.mjs; echo rc=$?`);
  assert.equal(out, 'rc=0');
});
