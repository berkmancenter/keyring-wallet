// node --test e2e/gate/post269Harness.test.mjs
// The harness gaps RC 269's gate found (10-23), each pinned where it was fixed. Read from source: these modules import
// webdriverio, which the quality job does not install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2e = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(path.join(e2e, f), 'utf8');

test('join.openCommunity ends on #473\'s refused screen, but not on its spinner', () => {
  const markers = src('lib/pages/join.js').match(/export const JOIN_MARKERS = \[([\s\S]*?)\];/)[1];
  assert.match(markers, /"JoinAgentRefused"/);
  assert.doesNotMatch(markers, /"JoinCheckingAgent"/, 'a spinner is not an end screen');
});

test('the installed-APK pull makes the artifacts folder first (a fresh checkout has none)', () => {
  const fn = src('lib/keyringRoles.js').match(/export function installedHash[\s\S]*?\n}\n/)[0];
  const mk = fn.indexOf('mkdirSync(ARTIFACTS, { recursive: true })');
  assert.ok(mk > 0 && mk < fn.indexOf('"pull"'), 'mkdir before adb pull');
});

test('a Release build\'s invitation is read from the share sheet, through the driver\'s clipboard', () => {
  const flows = src('lib/flows.js');
  const show = flows.match(/export async function showRelationshipInvitation[\s\S]*?\n}\n/)[0];
  assert.match(show, /process\.env\.E2E_RELEASE === "1" && \(await existsTestId\(driver, "MyQRShareLink"/);
  assert.ok(show.indexOf('return shareLinkFromSheet(driver)') < show.indexOf('waitForTestId(driver, "InvitationUrl", 60000)'), 'before the dev-only wait');
  const share = flows.match(/export async function shareLinkFromSheet[\s\S]*?\n}\n/)[0];
  assert.match(share, /driver\.getClipboard\("plaintext"\)/);
  assert.doesNotMatch(share, /pbpaste/, 'pbpaste came back empty on the MacBook');
  assert.ok(share.indexOf('driver.setClipboard("", "plaintext")') < share.indexOf('tapTestId(driver, "MyQRShareLink"'), 'the clipboard is emptied before the tap, so a stale link cannot pass');
});

test('run-vti-vetting reads the lab\'s stack.env only for what kk does not name', () => {
  const fn = src('run-vti-vetting.js').match(/function admin\(\.\.\.args\) \{[\s\S]*?\n}\n/)[0];
  const named = fn.indexOf('const named = process.env.KEYRING_COMMUNITY_REST && process.env.KEYRING_COMMUNITY_DID;');
  assert.ok(named > 0 && named < fn.indexOf('readFileSync(STACK_ENV'), 'decided before any read');
  assert.match(fn, /const env = named\s*\? \{\}/);
});
