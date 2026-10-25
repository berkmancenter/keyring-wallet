// The iOS app does not offer its own folder to the Files app or Finder: Export Wallet hands its backup to the share
// sheet instead (bifold's ExportWallet), so neither file-sharing key belongs in the app's Info.plist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const plist = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../app/ios/AriesBifold/Info.plist'),
  'utf8',
);

for (const key of ['UIFileSharingEnabled', 'LSSupportsOpeningDocumentsInPlace']) {
  test(`Info.plist does not set ${key}`, () => {
    assert.doesNotMatch(plist, new RegExp(`<key>${key}</key>`));
  });
}

test('the plist read is the app one (a positive control for the checks above)', () => {
  assert.match(plist, /<key>CFBundleIdentifier<\/key>/);
  assert.match(plist, /<key>UILaunchStoryboardName<\/key>/);
});
