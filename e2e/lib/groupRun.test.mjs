import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGrouped, TIMED_OUT } from './groupRun.js';

// A fake enrolment that hangs with a grandchild holding a lock, as bash → pnm-locked → pnm does.
test('a timeout kills the whole group: no child left, the lock free at once', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'grouprun-'));
  const lock = path.join(dir, 'slug.lock');
  const marker = `grouprun-marker-${process.pid}-${Date.now()}`;
  const script = path.join(dir, 'hang.sh');
  writeFileSync(script, `#!/bin/bash\nperl -e 'use Fcntl ":flock"; open(my $f, ">", $ARGV[0]) or die; flock($f, LOCK_EX); sleep 600' "${lock}" "${marker}" &\nsleep 600\n`);
  let status;
  try { runGrouped('bash', [script], { timeoutS: 2, stdio: 'ignore' }); } catch (e) { status = e.status; }
  assert.equal(status, TIMED_OUT);
  const left = spawnSync('pgrep', ['-f', marker], { encoding: 'utf8' }).stdout.trim();
  assert.equal(left, '', `left running: ${left}`);
  // The lock is free: a non-blocking flock succeeds.
  const r = spawnSync('perl', ['-e', 'use Fcntl ":flock"; open(my $f, ">", $ARGV[0]) or die; exit(flock($f, LOCK_EX|LOCK_NB) ? 0 : 1)', lock]);
  assert.equal(r.status, 0);
});

test('a command that finishes in time: its exit status and output come through', () => {
  const out = runGrouped('bash', ['-c', 'echo hello'], { timeoutS: 5, encoding: 'utf8' });
  assert.equal(out.trim(), 'hello');
  let status;
  try { runGrouped('bash', ['-c', 'exit 3'], { timeoutS: 5, stdio: 'ignore' }); } catch (e) { status = e.status; }
  assert.equal(status, 3);
});
