// node --test scripts/ota/
// check-ota-off.sh in a throwaway repo: it must pass a checkout with none of the loader's settings and fail on each one.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const script = path.join(path.dirname(new URL(import.meta.url).pathname), 'check-ota-off.sh')
const PLIST = 'app/ios/AriesBifold/Info.plist'
const MANIFEST = 'app/android/app/src/main/AndroidManifest.xml'
const STRINGS = 'app/android/app/src/main/res/values/strings.xml'

const run = (platform, files = {}) => {
  const repo = mkdtempSync(path.join(tmpdir(), 'ota-off-'))
  mkdirSync(path.join(repo, 'scripts', 'ota'), { recursive: true })
  copyFileSync(script, path.join(repo, 'scripts', 'ota', 'check-ota-off.sh'))
  const all = {
    'app/.env': 'MEDIATOR_URL=https://example.invalid\n',
    [PLIST]: '<plist><dict><key>CFBundleVersion</key><string>1</string></dict></plist>\n',
    [MANIFEST]: '<manifest><application android:name=".MainApplication"/></manifest>\n',
    [STRINGS]: '<resources><string name="app_name">Keyring</string></resources>\n',
    ...files,
  }
  for (const [f, text] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(repo, f)), { recursive: true })
    writeFileSync(path.join(repo, f), text)
  }
  return spawnSync('bash', [path.join(repo, 'scripts', 'ota', 'check-ota-off.sh'), platform], { encoding: 'utf8' })
}

test('a checkout without the loader settings passes on both platforms', () => {
  for (const platform of ['ios', 'android']) {
    const r = run(platform)
    assert.equal(r.status, 0, r.stdout + r.stderr)
  }
})

test('the update URL in app/.env fails both platforms', () => {
  for (const platform of ['ios', 'android']) {
    const r = run(platform, { 'app/.env': 'OTA_UPDATE_URL=https://example.invalid/hot-updater\n' })
    assert.equal(r.status, 1)
    assert.match(r.stdout, /app\/\.env: OTA_UPDATE_URL/)
  }
})

test('HOT_UPDATER_* keys in Info.plist fail iOS', () => {
  const r = run('ios', { [PLIST]: '<plist><dict><key>HOT_UPDATER_CHANNEL</key><string>production</string></dict></plist>\n' })
  assert.equal(r.status, 1)
  assert.match(r.stdout, /HOT_UPDATER_CHANNEL/)
})

test('com.hotupdater metadata in the manifest fails Android', () => {
  const r = run('android', { [MANIFEST]: '<manifest><meta-data android:name="com.hotupdater.CHANNEL" android:value="production"/></manifest>\n' })
  assert.equal(r.status, 1)
  assert.match(r.stdout, /com\.hotupdater\.CHANNEL/)
})

test('a hot_updater_* resource fails Android', () => {
  const r = run('android', { [STRINGS]: '<resources><string name="hot_updater_channel">production</string></resources>\n' })
  assert.equal(r.status, 1)
  assert.match(r.stdout, /strings\.xml: hot_updater_/)
})
