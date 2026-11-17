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

// Every shell file under e2e/gate, found by walking it (ac on #884: a hand-built list of legs/, lib.sh and ci/ missed
// gate.sh, pnm-rest.sh and watch.sh). A wait is fine only where the deadline's own command IS the wait: each command
// of a line (split on ; && || |) that runs wait-for-device must start with galarm or timeout, after any VAR=value.
// Known false positives, all in the safe direction (a guarded wait flagged, never a bare one passed; ac on #884): a
// guarded wait right after `; then` (or else, do, {); a trailing `# …` comment that mentions a bare wait; `timeout
// --foreground 120`; a guard on the previous `\` continuation line. If one fires, rewrite the line, not this check.
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.name === 'node_modules' ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.sh') ? [path.join(dir, e.name)] : []);
const shells = walk(here);
const guarded = (cmd) => /^\s*(\w+=\S*\s+)*(galarm|timeout)\s+("?\$\w+"?|\d+)\s/.test(cmd);
const bare = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l))
  .filter((l) => l.split(/;|&&|\|\||\|/).some((cmd) => /wait-for-device/.test(cmd) && !guarded(cmd)));

test('the walk finds every shell file, the ones a hand list missed among them', () => {
  const rel = shells.map((f) => path.relative(here, f));
  for (const f of ['gate.sh', 'lib.sh', 'pnm-rest.sh', 'watch.sh', 'legs/lostreq.sh', 'ci/gate-ci-leg.sh']) assert.ok(rel.includes(f), f);
});

test('no bare `adb wait-for-device` is left in any shell file under e2e/gate', () => {
  const found = shells.flatMap((f) => bare(readFileSync(f, 'utf8')).map((l) => `${path.relative(here, f)}: ${l.trim()}`));
  assert.deepEqual(found, []);
});

test('controls: the bare wait that hung lostreq and one chained after a guarded command are caught; a guarded wait is not', () => {
  assert.equal(bare('adb -s $E root >/dev/null 2>&1; sleep 3; adb -s $E wait-for-device').length, 1);
  // ac on #884: a deadline on the line's FIRST command must not cover a wait chained after it.
  assert.equal(bare('galarm 900 node run-join-lost.mjs; adb -s $E wait-for-device').length, 1);
  assert.equal(bare('timeout 60 true && adb -s "$serial" wait-for-device').length, 1);
  // Real controls: each holds wait-for-device, so each is flagged if the exemption goes.
  assert.equal(bare('  GALARM_STEPS=0 galarm "$t" adb -s "$s" wait-for-device; rc=$?').length, 0);
  assert.equal(bare('timeout 120 adb -s "$serial" wait-for-device || { echo ENV; exit 2; }').length, 0);
  assert.equal(bare('    GALARM_STEPS=0 galarm 120 adb -s "emulator-$port" wait-for-device 2>/dev/null \\').length, 0);
});
