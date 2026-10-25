// node --test e2e/gate/hvCleanup.test.mjs
// The hv leg's cleanup ends what its Appium started (the iOS vetter's WebDriverAgent) by PID, and shuts the vetter
// simulator down by UDID on the Keyring-vetter path only: never a pattern kill, never a delete or an erase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const hv = readFileSync(path.join(here, 'legs', 'hv.sh'), 'utf8');
const fn = (name) => hv.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}$`, 'm'))?.[0] ?? hv.match(new RegExp(`^${name}\\(\\) \\{.*\\}$`, 'm'))?.[0];

test('pid_tree lists a process\'s descendants by parent PID', () => {
  const out = execFileSync('bash', ['-c', `set -u
${fn('pid_tree')}
bash -c 'sleep 30 & sleep 30 & wait' & root=$!
sleep 0.5
kids=$(pid_tree "$root" | wc -l | tr -d ' ')
kill $(pid_tree "$root") "$root" 2>/dev/null
echo "$kids"`], { encoding: 'utf8' }).trim();
  assert.equal(out, '2');
});

test('fin ends Appium\'s descendants by PID and shuts the vetter down by UDID, keyring path only', () => {
  const fin = fn('fin');
  assert.ok(fin, 'fin is defined');
  assert.match(fin, /pid_tree "\$AP"/, 'Appium\'s descendants, by PID');
  assert.doesNotMatch(fin, /\bpkill\b|\bkillall\b|pgrep -f/, 'never by pattern');
  assert.match(fin, /\*emulator\*\|\*qemu\*\) ;;/, 'an emulator is left to emu.sh');
  assert.match(fin, /"\$\{VETTER:-keyring\}" = keyring \] && \[ -n "\$\{HV_VETTER_UDID:-\}" \] && xcrun simctl shutdown "\$HV_VETTER_UDID"/);
  assert.doesNotMatch(hv, /simctl (delete|erase)/, 'the vetter simulator is never deleted or erased');
});
