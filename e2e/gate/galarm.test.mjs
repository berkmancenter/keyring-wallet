// node --test e2e/gate/galarm.test.mjs — lib.sh's galarm: the whole process group goes on the alarm or a stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib.sh');
const left = (marker) => spawnSync('pgrep', ['-f', marker], { encoding: 'utf8' }).stdout.trim();
// A driver that starts a long-lived child (an Appium, say) and then hangs.
// The child carries the marker in its argv (macOS sleep takes no extra argument, so perl, which ignores it).
const hang = (marker) => `bash -c 'perl -e "sleep 600" ${marker} & sleep 600'`;

test('the alarm kills the driver and its children: exit 142, nothing left', () => {
  const marker = `galarm-${process.pid}-a`;
  const r = spawnSync('bash', ['-c', `GATE_TARGET=ci . "${LIB}"; galarm 2 ${hang(marker)}`], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 142);
  assert.equal(left(marker), '');
});

// Guard against a vacuous test: the marker child really runs while the command is alive.
test('the marker child runs while the command is alive', async () => {
  const marker = `galarm-${process.pid}-c`;
  const p = spawn('bash', ['-c', `GATE_TARGET=ci . "${LIB}"; galarm 3 ${hang(marker)}`], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1000));
  assert.notEqual(left(marker), '', 'the marker child is running');
  await new Promise((r) => p.on('exit', r));
  assert.equal(left(marker), '');
});

test('a stop sent to the leg reaches the group: nothing left', async () => {
  const marker = `galarm-${process.pid}-b`;
  const p = spawn('bash', ['-c', `GATE_TARGET=ci . "${LIB}"; galarm 60 ${hang(marker)}`], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  // gate.sh's stop reaches the leg's shell and the galarm wrapper (its own group), not the driver's group.
  const wrapper = spawnSync('pgrep', ['-P', String(p.pid)], { encoding: 'utf8' }).stdout.trim().split('\n')[0];
  process.kill(Number(wrapper), 'SIGTERM');
  const code = await new Promise((r) => p.on('exit', (c) => r(c)));
  assert.equal(code, 143);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(left(marker), '');
});

test('a command that finishes: its own exit status', () => {
  const r = spawnSync('bash', ['-c', `GATE_TARGET=ci . "${LIB}"; galarm 10 bash -c 'exit 3'`]);
  assert.equal(r.status, 3);
});
