// node --test scripts/ci/link-schemes.test.mjs
//
// The link schemes Keyring tells each phone it opens, so that a link tapped outside the app is handed to it. They are
// registered twice, by hand: in the iOS Info.plist (CFBundleURLSchemes) and in the Android manifest (the VIEW
// intent-filter's <data android:scheme>). A scheme in one and not the other opens Keyring on half the phones, and
// nothing says so until someone taps the link. Both lists are held to the same set here.
//
// A scheme is only the hand-over: what Keyring does with the link is in bifold (routeKeyringAgentLink).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const plist = readFileSync(path.join(root, 'app/ios/AriesBifold/Info.plist'), 'utf8');
const manifest = readFileSync(path.join(root, 'app/android/app/src/main/AndroidManifest.xml'), 'utf8');

/** Every scheme under a CFBundleURLSchemes key. */
const iosSchemes = () =>
  [...plist.matchAll(/<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/g)]
    .flatMap(([, list]) => [...list.matchAll(/<string>([^<]+)<\/string>/g)].map(([, scheme]) => scheme))
    .sort();

/** The body of each intent-filter: what Keyring opens. The <queries> block, what it asks about, is not read. */
const filters = () => [...manifest.matchAll(/<intent-filter[^>]*>([\s\S]*?)<\/intent-filter>/g)].map(([, body]) => body);
const dataOf = (body) => [...body.matchAll(/<data\s+([^>]*?)\/>/g)].map(([, attributes]) => attributes);

/** Every scheme an intent-filter names, without the web links (https) that are claimed by host. */
const androidSchemes = () =>
  [...new Set(filters().flatMap(dataOf).map((attributes) => /android:scheme="([^"]+)"/.exec(attributes)?.[1]))]
    .filter((scheme) => scheme && scheme !== 'https')
    .sort();

const EXPECTED = ['did', 'didcomm', 'keyring', 'openid-credential-offer', 'vetting-ticket', 'web+interaction'];

test('iOS registers exactly the link schemes Keyring opens', () => {
  assert.deepEqual(iosSchemes(), EXPECTED);
});

test('Android registers exactly the same ones', () => {
  assert.deepEqual(androidSchemes(), EXPECTED);
});

test('web+interaction is registered as written: lower case, no slashes, in a browsable VIEW filter', () => {
  assert.match(plist, /<string>web\+interaction<\/string>/);
  const filter = filters().find((body) => body.includes('android:scheme="web+interaction"'));
  assert.ok(filter, 'no intent-filter names web+interaction');
  assert.match(filter, /android\.intent\.action\.VIEW/);
  assert.match(filter, /android\.intent\.category\.BROWSABLE/);
  assert.match(filter, /android\.intent\.category\.DEFAULT/);
});

test('control: the reads find what is known to be there, and a scheme nobody registered is in neither', () => {
  assert.ok(iosSchemes().includes('keyring'));
  assert.ok(androidSchemes().includes('keyring'));
  assert.ok(!iosSchemes().includes('interaction'));
  assert.ok(!androidSchemes().includes('interaction'));
  // https is opened for named hosts only (the invitation links), never as a whole scheme.
  const web = filters().flatMap(dataOf).filter((attributes) => attributes.includes('android:scheme="https"'));
  assert.ok(web.length > 0);
  for (const attributes of web) assert.match(attributes, /android:host="[^"]+"/);
});
