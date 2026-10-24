// node --test e2e/gate/galarm.test.mjs — lib.sh's galarm: the whole process group goes on the alarm or a stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
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

// Review on #423: a SIGKILL of the leg's whole group kills the wrapper too; the driver's group, in a group of its own,
// lives on. It is listed, and galarm_reap finds and kills it.
test('a group orphaned by a SIGKILL of the whole leg is reaped from the list', async () => {
  const marker = `galarm-${process.pid}-d`;
  const home = (await import('node:fs')).mkdtempSync(path.join((await import('node:os')).tmpdir(), 'galarm-home-'));
  // The "leg": its own group (detached), running galarm around a hanging driver with a child.
  const leg = spawn('bash', ['-c', `GATE_TARGET=ci GATE_HOME="${home}" . "${LIB}"; LEG_NAME=t; galarm 600 ${hang(marker)}`], { stdio: 'ignore', detached: true });
  await new Promise((r) => setTimeout(r, 1500));
  assert.notEqual(left(marker), '', 'the marker child runs');
  process.kill(-leg.pid, 'SIGKILL'); // the leg's whole group, wrapper included
  await new Promise((r) => setTimeout(r, 500));
  assert.notEqual(left(marker), '', 'orphaned: still running after the leg was killed');
  const r = spawnSync('bash', ['-c', `GATE_TARGET=ci GATE_HOME="${home}" . "${LIB}"; galarm_reap t`], { encoding: 'utf8' });
  assert.match(r.stdout, /killed a leftover group/);
  await new Promise((r2) => setTimeout(r2, 500));
  assert.equal(left(marker), '');
});

// Review on #423: group numbers are reused. A listed group that ended, whose number a stranger now holds, is never
// killed: the leader's start time no longer matches. (The reuse can't be forced, so the line is pointed at a
// stranger's group.)
test('a reused group number is not killed: the leader start time does not match', async () => {
  const fs = await import('node:fs');
  const home = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'galarm-home-'));
  const r1 = spawnSync('bash', ['-c', `GATE_TARGET=ci GATE_HOME="${home}" . "${LIB}"; LEG_NAME=t; galarm 10 bash -c 'exit 0'`]);
  assert.equal(r1.status, 0);
  const line = fs.readFileSync(path.join(home, 'galarm-groups'), 'utf8').trim().split('\n')[0].split('\t');
  const marker = `galarm-${process.pid}-stranger`;
  await new Promise((r) => setTimeout(r, 1500)); // a later second: start times resolve to one
  const stranger = spawn('perl', ['-e', 'setpgrp(0,0); sleep 30', marker], { stdio: 'ignore', detached: true });
  await new Promise((r) => setTimeout(r, 500));
  line[0] = String(stranger.pid); // the old line, its number now the stranger's
  fs.writeFileSync(path.join(home, 'galarm-groups'), line.join('\t') + '\n');
  const r = spawnSync('bash', ['-c', `GATE_TARGET=ci GATE_HOME="${home}" . "${LIB}"; galarm_reap`], { encoding: 'utf8' });
  assert.doesNotMatch(r.stdout, /killed/);
  assert.notEqual(left(marker), '', 'the stranger lives');
  assert.equal(fs.readFileSync(path.join(home, 'galarm-groups'), 'utf8'), '', 'the stale line is dropped');
  process.kill(stranger.pid, 'SIGKILL');
});

// galarm is a shell function: a command runner (env, nohup, xargs, timeout...) in front of it looks for a galarm on the
// PATH and fails 127 before the driver starts. The 241 gate (1014-0451) lost linkfail's 7 rows and devices that way;
// the variables go after it instead (`galarm 1200 env X=1 node ...`).
test('no leg runs galarm through env or another command runner', () => {
  const LEGS = path.join(path.dirname(LIB), 'legs');
  const bad = [];
  for (const f of [...readdirSync(LEGS).filter((n) => n.endsWith('.sh')).map((n) => path.join(LEGS, n)), LIB]) {
    const src = readFileSync(f, 'utf8').replace(/\\\n\s*/g, ' ');
    for (const line of src.split('\n'))
      if (/(?:^|[\s;|&(])(?:env|nohup|xargs|timeout|exec|sudo|time)\s(?:[^;|&]*\s)?galarm\s/.test(line)) bad.push(`${path.basename(f)}: ${line.trim().slice(0, 100)}`);
  }
  assert.deepEqual(bad, []);
});
