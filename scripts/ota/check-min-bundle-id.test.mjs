// node --test scripts/ota/
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { appInfoPlistEntry, buildTimestampInPlist, dexEntries } from './check-min-bundle-id.mjs'
import { minBundleIdFor } from './native-config.mjs'

const script = path.join(path.dirname(new URL(import.meta.url).pathname), 'check-min-bundle-id.mjs')
const has = (tool) => spawnSync('which', [tool]).status === 0
// 275's store build started 2026-10-27 14:27Z (run 40520149511).
const STAMP = 1793111220000
const ID = minBundleIdFor(STAMP)

const plist = (extra) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>CFBundleVersion</key>\n\t<string>276</string>\n${extra}</dict>\n</plist>\n`

/** Zips files ({ 'entry/path': contents }) into dir/name, using the zip CLI as a build would produce them. */
const zipOf = (dir, name, files) => {
  const root = path.join(dir, `${name}.d`)
  for (const [entry, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, entry)), { recursive: true })
    writeFileSync(path.join(root, entry), contents)
  }
  const out = path.join(dir, name)
  const zipped = spawnSync('zip', ['-qr', out, '.'], { cwd: root })
  assert.equal(zipped.status, 0, String(zipped.stderr))
  return out
}

const check = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })

test('the app Info.plist is the bundle root one, not a framework or extension plist', () => {
  const entries = [
    'Payload/KeyRing.app/Frameworks/hermes.framework/Info.plist',
    'Payload/KeyRing.app/PlugIns/Share.appex/Info.plist',
    'Payload/KeyRing.app/Info.plist',
  ]
  assert.equal(appInfoPlistEntry(entries), 'Payload/KeyRing.app/Info.plist')
  assert.equal(appInfoPlistEntry(entries.slice(0, 2)), undefined)
})

test('dex files are found at an APK root and under an AAB module', () => {
  const entries = ['classes.dex', 'classes2.dex', 'base/dex/classes.dex', 'base/dex/classes3.dex', 'res/classes.xml']
  assert.deepEqual(dexEntries(entries), entries.slice(0, 4))
})

test('the build timestamp is read only as plain digits', () => {
  assert.equal(
    buildTimestampInPlist(plist(`\t<key>HOT_UPDATER_BUILD_TIMESTAMP</key>\n\t<string>${STAMP}</string>\n`)),
    STAMP
  )
  assert.equal(buildTimestampInPlist(plist('')), undefined)
  // An unexpanded build setting is what an Xcode build leaves when nothing set it.
  const unexpanded = '\t<key>HOT_UPDATER_BUILD_TIMESTAMP</key>\n\t<string>$(HOT_UPDATER_BUILD_TIMESTAMP)</string>\n'
  assert.equal(buildTimestampInPlist(plist(unexpanded)), undefined)
})

test('android: each binary must carry the id in one of its dex files', { skip: !(has('zip') && has('unzip')) }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'min-bundle-'))
  try {
    const aab = zipOf(dir, 'app-release.aab', {
      'base/dex/classes.dex': 'dex\n035 other strings',
      'base/dex/classes2.dex': `dex\n035 ${ID} com.hotupdater`,
    })
    const apk = zipOf(dir, 'app-release.apk', { 'classes.dex': `dex\n035 ${ID}`, 'AndroidManifest.xml': 'x' })
    const ok = check('android', aab, apk, ID)
    assert.equal(ok.status, 0, ok.stderr)
    assert.match(ok.stdout, /app-release\.aab base\/dex\/classes2\.dex carries/)
    assert.match(ok.stdout, /app-release\.apk classes\.dex carries/)

    // A build without the property: the loader falls back to its own default, and the check says so.
    const bare = zipOf(dir, 'bare.apk', { 'classes.dex': 'dex\n035 no id here' })
    const refused = check('android', aab, bare, ID)
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /bare\.apk: none of 1 dex files carries MIN_BUNDLE_ID/)

    const nothing = check('android', zipOf(dir, 'empty.apk', { 'AndroidManifest.xml': 'x' }), ID)
    assert.equal(nothing.status, 1)
    assert.match(nothing.stderr, /no classes\*\.dex/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ios: the app plist timestamp must give the build id', { skip: !(has('zip') && has('plutil')) }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'min-bundle-'))
  try {
    const stamped = plist(`\t<key>HOT_UPDATER_BUILD_TIMESTAMP</key>\n\t<string>${STAMP}</string>\n`)
    const xmlIpa = zipOf(dir, 'xml.ipa', { 'Payload/KeyRing.app/Info.plist': stamped })
    const ok = check('ios', xmlIpa, ID)
    assert.equal(ok.status, 0, ok.stderr)
    assert.match(ok.stdout, new RegExp(`HOT_UPDATER_BUILD_TIMESTAMP ${STAMP} = ${ID}`))

    // A built app's plist is binary.
    writeFileSync(path.join(dir, 'Info.plist'), stamped)
    assert.equal(spawnSync('plutil', ['-convert', 'binary1', path.join(dir, 'Info.plist')]).status, 0)
    const binIpa = path.join(dir, 'bin.ipa')
    mkdirSync(path.join(dir, 'bin', 'Payload', 'KeyRing.app'), { recursive: true })
    spawnSync('cp', [path.join(dir, 'Info.plist'), path.join(dir, 'bin', 'Payload', 'KeyRing.app', 'Info.plist')])
    assert.equal(spawnSync('zip', ['-qr', binIpa, '.'], { cwd: path.join(dir, 'bin') }).status, 0)
    assert.equal(check('ios', binIpa, ID).status, 0)

    const other = check('ios', xmlIpa, minBundleIdFor(STAMP + 1))
    assert.equal(other.status, 1)
    assert.match(other.stderr, /gives .* not /)

    const missing = check('ios', zipOf(dir, 'missing.ipa', { 'Payload/KeyRing.app/Info.plist': plist('') }), ID)
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /no HOT_UPDATER_BUILD_TIMESTAMP/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the last argument must be a build id, and there must be a binary', () => {
  assert.match(check('android', 'x.apk', 'not-an-id').stderr, /must be the build's MIN_BUNDLE_ID/)
  assert.match(check('android', ID).stderr, /no binary to check/)
})
