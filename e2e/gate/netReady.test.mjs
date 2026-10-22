// node --test e2e/gate/netReady.test.mjs
// emu_net_ready (lib.sh): before a leg onboards, the emulator must reach the network; a fresh userdata boots cold and
// 1022-1709's link failed at onboarding on it. A fake adb answers as the emulator would; nothing real is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = readFileSync(path.join(here, 'lib.sh'), 'utf8');
const fn = lib.match(/^emu_net_ready\(\) \{[\s\S]*?^\}$/m)[0];

/** Runs emu_net_ready with a fake adb that prints `answer` (or nothing) to its shell probe. */
const ready = (answer, env = {}) => {
  const bin = mkdtempSync(path.join(tmpdir(), 'net-'));
  writeFileSync(path.join(bin, 'adb'), `#!/bin/bash\nprintf '%s' "${answer}"\n`);
  chmodSync(path.join(bin, 'adb'), 0o755);
  return execFileSync('bash', ['-c', `set -u\n${fn}\nemu_net_ready emulator-5572`], {
    encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, GATE_NET_WAIT_S: '2', GATE_NET_STEP_S: '1', ...env },
  }).trim();
};

test('reached over TCP 443, or by its name at least, is said with how', () => {
  assert.match(ready('tcp', { RUNNER_MEDIATOR_HOST: 'mediator.example' }), /mediator\.example reached \(tcp\)/);
  assert.match(ready('dns', { RUNNER_MEDIATOR_HOST: 'mediator.example' }), /reached \(dns\)/);
});

test('never reached: said at the end of the window, and the leg goes on (status 0)', () => {
  assert.match(ready('', { RUNNER_MEDIATOR_HOST: 'mediator.example' }), /NOT reached in 2 s \(the leg goes on/);
});

test('GATE_NET_PROBE_HOST wins over RUNNER_MEDIATOR_HOST; neither set is "not checked"', () => {
  assert.match(ready('tcp', { RUNNER_MEDIATOR_HOST: 'a.example', GATE_NET_PROBE_HOST: 'b.example' }), /b\.example reached/);
  assert.match(ready('tcp'), /no probe host .* not checked/);
});

test('both emulator starts run it: local (after leg_logcat) and CI', () => {
  assert.match(lib, /leg_logcat "emulator-\$port"; emu_net_ready "emulator-\$port"; return 0;/);
  assert.match(lib, /emu_net_ready "emulator-\$port"; echo "emulator-\$port up \(CI\)/);
});
