// The Android app keeps its data on the phone: no cloud backup and no device-to-device transfer. Android 11 and below
// read android:allowBackup; Android 12+ ignore it for device transfer and read android:dataExtractionRules instead, so
// the manifest needs both, and the rules file must exclude every domain in both sections and include nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const main = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../app/android/app/src/main');
const manifest = readFileSync(path.join(main, 'AndroidManifest.xml'), 'utf8');
const application = manifest.match(/<application\b[^>]*>/)?.[0] ?? '';
const DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external', 'device_root', 'device_file', 'device_database', 'device_sharedpref'];

test('the application turns backup off for Android 11 and below', () => {
  assert.match(application, /android:allowBackup="false"/);
});

test('the application names the data extraction rules for Android 12 and above', () => {
  assert.match(application, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
});

for (const section of ['cloud-backup', 'device-transfer']) {
  test(`${section} excludes every domain and includes nothing`, () => {
    const rules = readFileSync(path.join(main, 'res/xml/data_extraction_rules.xml'), 'utf8');
    const body = rules.match(new RegExp(`<${section}>([\\s\\S]*?)</${section}>`))?.[1];
    assert.ok(body !== undefined, `<${section}> is present`);
    assert.doesNotMatch(body, /<include\b/);
    for (const domain of DOMAINS) assert.match(body, new RegExp(`<exclude domain="${domain}" path="\\." />`), domain);
  });
}
