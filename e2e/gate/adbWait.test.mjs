// node --test e2e/gate/adbWait.test.mjs — no `adb wait-for-device` without a deadline. On 11-09 emulator-5572 died
// mid-lostreq and its bare wait held the whole nightly 4 h 15 min; lib.sh's adb_wait puts galarm's deadline on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(here, 'lib.sh');

/** adb_wait against a stand-in `adb` on PATH: `body` is that adb's script. */
function adbWait(body, args) {
  const dir = mkdtempSync(path.join(tmpdir(), 'adbwait-'));
  try {
    writeFileSync(path.join(dir, 'adb'), `#!/bin/bash\n${body}\n`); chmodSync(path.join(dir, 'adb'), 0o755);
    const t0 = Date.now();
    const r = spawnSync('bash', ['-c', `GATE_TARGET=ci . "${LIB}"; GALARM_GROUPS=${JSON.stringify(path.join(dir, 'groups'))}; adb_wait ${args}`],
      { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8', timeout: 30000 });
    return { ...r, ms: Date.now() - t0 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a device that never comes back: adb_wait gives up at its deadline (142) and names the device', () => {
  const r = adbWait('perl -e "sleep 600"', 'emulator-5572 2');
  assert.equal(r.status, 142, r.stderr);
  assert.ok(r.ms < 15000, `took ${r.ms} ms`);
  assert.match(r.stderr, /adb_wait: emulator-5572 did not come back within 2 s \(rc 142\)/);
});

test('control: a device that is there returns at once with 0 and says nothing', () => {
  const r = adbWait('[ "$1 $2 $3" = "-s emulator-5572 wait-for-device" ] || exit 9', 'emulator-5572 2');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
});

// Every wait in the harness's shell: legs, lib.sh, the CI leg. A wait is fine only under a deadline (galarm, timeout).
const shells = [
  ...readdirSync(path.join(here, 'legs')).filter((f) => f.endsWith('.sh')).map((f) => path.join(here, 'legs', f)),
  LIB,
  ...readdirSync(path.join(here, 'ci')).filter((f) => f.endsWith('.sh')).map((f) => path.join(here, 'ci', f)),
];
const bare = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l) && /wait-for-device/.test(l) && !/\b(galarm|timeout) +("?\$\w+"?|\d+) /.test(l));

test('no bare `adb wait-for-device` is left in any leg, lib.sh or the CI leg', () => {
  const found = shells.flatMap((f) => bare(readFileSync(f, 'utf8')).map((l) => `${path.relative(here, f)}: ${l.trim()}`));
  assert.deepEqual(found, []);
});

test('control: the check catches a bare wait like the one that hung lostreq, and passes adb_wait and galarm', () => {
  assert.equal(bare('adb -s $E root >/dev/null 2>&1; sleep 3; adb -s $E wait-for-device').length, 1);
  assert.equal(bare('adb_wait $E || broken "x"').length, 0);
  assert.equal(bare('  GALARM_STEPS=0 galarm "$t" adb -s "$s" wait-for-device; rc=$?').length, 0);
  assert.equal(bare('timeout 120 adb -s "$serial" wait-for-device || exit 2').length, 0);
});
