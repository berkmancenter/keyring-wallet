// node --test scripts/ota/
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import {
  buildTimestampArg,
  checkChannel,
  minBundleIdFor,
  normalisePublicKey,
  setManifestMetaData,
  setPlistString,
} from './native-config.mjs'

const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'app')
const rsa = (bits) =>
  generateKeyPairSync('rsa', { modulusLength: bits }).publicKey.export({
    type: 'spki',
    format: 'pem',
  })

test('the key is checked and written on one line with \\n separators', () => {
  const pem = rsa(2048)
  const line = normalisePublicKey(pem)
  assert.ok(line.startsWith('-----BEGIN PUBLIC KEY-----\\n'))
  assert.ok(line.endsWith('\\n-----END PUBLIC KEY-----'))
  assert.ok(!line.includes('\n'))
  // A key already in the one-line form (as a repository variable may hold it) is accepted too.
  assert.equal(normalisePublicKey(line), line)
})

test('weak, non-RSA or garbage keys are refused', () => {
  assert.throws(() => normalisePublicKey(rsa(1024)), /at least 2048/)
  const ec = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  }).publicKey.export({ type: 'spki', format: 'pem' })
  assert.throws(() => normalisePublicKey(ec), /must be RSA/)
  assert.throws(() => normalisePublicKey('not a key'), /not a PEM public key/)
  assert.throws(() => normalisePublicKey(undefined), /not a PEM public key/)
})

test('channels are short lower-case names', () => {
  assert.equal(checkChannel('production'), 'production')
  assert.equal(checkChannel('ci'), 'ci')
  assert.throws(() => checkChannel('Prod'), /must match/)
  assert.throws(() => checkChannel('a/b'), /must match/)
})

test('the real Info.plist gains both keys once, and a second run replaces rather than adds', () => {
  const original = readFileSync(path.join(appDir, 'ios', 'AriesBifold', 'Info.plist'), 'utf8')
  const once = setPlistString(setPlistString(original, 'HOT_UPDATER_PUBLIC_KEY', 'K1'), 'HOT_UPDATER_CHANNEL', 'ci')
  const twice = setPlistString(
    setPlistString(once, 'HOT_UPDATER_PUBLIC_KEY', 'K2'),
    'HOT_UPDATER_CHANNEL',
    'production'
  )
  assert.equal(twice.match(/HOT_UPDATER_PUBLIC_KEY/g).length, 1)
  assert.ok(twice.includes('<key>HOT_UPDATER_PUBLIC_KEY</key>\n\t<string>K2</string>'))
  assert.ok(twice.includes('<key>HOT_UPDATER_CHANNEL</key>\n\t<string>production</string>'))
  assert.ok(twice.trimEnd().endsWith('</dict>\n</plist>'))
  // Nothing else in the file moved: taking the two pairs out gives the original back.
  const removed = twice
    .replace('\t<key>HOT_UPDATER_PUBLIC_KEY</key>\n\t<string>K2</string>\n', '')
    .replace('\t<key>HOT_UPDATER_CHANNEL</key>\n\t<string>production</string>\n', '')
  assert.equal(removed, original)
})

test('the real AndroidManifest gains both meta-data entries inside <application>, once', () => {
  const original = readFileSync(path.join(appDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8')
  const once = setManifestMetaData(original, 'com.hotupdater.PUBLIC_KEY', 'K1')
  const twice = setManifestMetaData(once, 'com.hotupdater.PUBLIC_KEY', 'K2')
  assert.equal(twice.match(/com\.hotupdater\.PUBLIC_KEY/g).length, 1)
  assert.ok(twice.includes('<meta-data android:name="com.hotupdater.PUBLIC_KEY" android:value="K2" />'))
  const application = twice.indexOf('<application')
  assert.ok(twice.indexOf('com.hotupdater.PUBLIC_KEY') > application)
  assert.ok(twice.indexOf('com.hotupdater.PUBLIC_KEY') < twice.indexOf('</application>'))
})

test('values are XML-escaped', () => {
  const manifest = '<manifest><application android:name=".X">\n</application></manifest>'
  assert.ok(setManifestMetaData(manifest, 'a.b', 'x"<&').includes('android:value="x&quot;&lt;&amp;"'))
})

test('the build id is the UUID v7 both loaders derive from a timestamp, and orders by time', () => {
  // 2026-10-27 14:27Z, when 275's store build started (run 40520149511). The expected id was computed outside this
  // code, from HotUpdater.mm's byte layout (12 hex digits of milliseconds, then 7000-8000 and zeros), not with
  // minBundleIdFor. check-min-bundle-id.mjs's LOADER_PINS hold the loader to that layout.
  assert.equal(minBundleIdFor(1793111220000), '01a17dc1-df20-7000-8000-000000000000')
  assert.equal(minBundleIdFor(1), '00000000-0001-7000-8000-000000000000')
  // The server offers only bundles whose id is at or after it. A bundle made 10-26 20:43Z, like 273's last update
  // (01a179f4), sorts before 275's build id and is refused; one made a millisecond after the build is offered.
  const build = minBundleIdFor(1793111220000)
  assert.ok('01a179f4-0000-7abc-9def-0123456789ab' < build)
  assert.ok(minBundleIdFor(1793111220001) > build)
  assert.throws(() => minBundleIdFor(0), /milliseconds since 1970/)
  assert.throws(() => minBundleIdFor(2 ** 48), /milliseconds since 1970/)
  assert.throws(() => minBundleIdFor(1.5), /milliseconds since 1970/)
})

test('--build-timestamp means now, takes pinned milliseconds, and is off without the flag', () => {
  assert.equal(buildTimestampArg(['node', 'x']), undefined)
  assert.equal(
    buildTimestampArg(['node', 'x', '--build-timestamp'], () => 42),
    42
  )
  assert.equal(buildTimestampArg(['node', 'x', '--no-fingerprint', '--build-timestamp=1793111220000']), 1793111220000)
  assert.throws(() => buildTimestampArg(['node', 'x', '--build-timestamp=soon']), /takes milliseconds/)
})

test('the build timestamp joins the real Info.plist beside the key and channel', () => {
  const original = readFileSync(path.join(appDir, 'ios', 'AriesBifold', 'Info.plist'), 'utf8')
  const stamped = setPlistString(original, 'HOT_UPDATER_BUILD_TIMESTAMP', '1793111220000')
  assert.ok(stamped.includes('<key>HOT_UPDATER_BUILD_TIMESTAMP</key>\n\t<string>1793111220000</string>'))
  assert.equal(setPlistString(stamped, 'HOT_UPDATER_BUILD_TIMESTAMP', '1793111220000'), stamped)
})
