// node --test e2e/gate/refused.test.mjs
// The refused leg (IN-350): in the Android group, not a core journey; a build without the notice SKIPs every row; the
// only ACL it removes mid-run is the phone's own grant (linkedPhoneEntries), and its no-toast row needs evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const leg = readFileSync(path.join(here, 'legs', 'refused.sh'), 'utf8');
const gate = readFileSync(path.join(here, 'gate.sh'), 'utf8');
const driver = readFileSync(path.join(here, '..', 'run-agent-refused.mjs'), 'utf8');

test('refused runs in the Android group and is not a core journey', () => {
  assert.match(gate.match(/^LEGS_ANDROID="([^"]*)"/m)[1], /\brefused\b/);
  assert.doesNotMatch(gate.match(/^CORE_JOURNEYS="([^"]*)"/m)[1], /refused/);
});

test('a build without PersonaAgentNotice SKIPs every row before any device work', () => {
  const skip = leg.indexOf('row "$r" SKIP "the build lacks PersonaAgentNotice');
  assert.ok(skip > 0 && skip < leg.indexOf('emu_start'), 'the SKIP comes before the emulator starts');
});

test('the mid-run removal is the phone\'s own grant only, chosen as the cleanup chooses', () => {
  assert.match(driver, /const mine = linkedPhoneEntries\(listAcl\(/);
  assert.equal((driver.match(/deleteAcl\(/g) ?? []).length, 1, 'one deleteAcl, over `mine`');
  assert.match(driver, /for \(const e of mine\) \{\s*deleteAcl\(/);
});

test('the control comes first, and no toast is a verdict only with the refusal in the log', () => {
  assert.ok(driver.indexOf('"refused-before"') < driver.indexOf('linkedPhoneEntries(listAcl('), 'the control runs before the grant goes');
  assert.match(driver, /if \(!toast && !evidence\) rows\.skip\("refused-no-toast", "no verdict/);
  assert.match(driver, /never "didn't\s+answer"|UNREACHABLE_LINE/);
});
