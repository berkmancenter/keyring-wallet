#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Checks that a built store binary refuses over-the-air bundles older than itself, for staging.yaml after each
 * platform's build and before anything is uploaded.
 *
 *   node scripts/ota/check-min-bundle-id.mjs ios export/KeyRing.ipa <min-bundle-id>
 *   node scripts/ota/check-min-bundle-id.mjs android <app-release.aab> [<app-release.apk> ...] <min-bundle-id>
 *
 * <min-bundle-id> is what native-config.mjs --build-timestamp derived for this build (OTA_MIN_BUNDLE_ID).
 * - iOS: the app's own Info.plist must hold HOT_UPDATER_BUILD_TIMESTAMP, and that timestamp must give the same id.
 * - Android: some classes*.dex in each file must carry the id. It's the hot-updater module's
 *   BuildConfig.MIN_BUNDLE_ID, a constant in the dex string pool. Every given file is checked, because the .aab is
 *   what Google Play gets and the .apk is what a side-load gets.
 * It names each file and entry it read, and fails on a file with nothing to read (no app Info.plist, no dex).
 *
 * Before reading any binary, it checks the installed loader's own source for the exact lines this relies on
 * (LOADER_PINS). On iOS the read-back above re-derives the id with this repository's code, so on its own it
 * couldn't see a loader that stopped reading the key, or changed how it turns the timestamp into an id. A library
 * upgrade that changes any pinned line fails the store build instead of shipping a binary that falls back to the
 * old default. Re-read the loader, then update the pins.
 * --loader=<dir> names the loader package (tests); by default it's resolved from app/.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { minBundleIdFor } from './native-config.mjs'

/**
 * Exact lines of @hot-updater/react-native (read at 0.36.18) that make our values take effect. iOS: the loader
 * reads HOT_UPDATER_BUILD_TIMESTAMP from Info.plist, and builds the id with the layout minBundleIdFor reproduces.
 * Android: Gradle reads the MIN_BUNDLE_ID property into BuildConfig, and the loader uses it when set.
 */
export const LOADER_PINS = {
  ios: [
    {
      file: 'ios/HotUpdater/Internal/HotUpdater.mm',
      lines: [
        'infoDictionary[@"HOT_UPDATER_BUILD_TIMESTAMP"]',
        'uuid = [HotUpdater generateUUIDv7FromTimestamp:timestampMs];',
        'bytes[0] = (timestampMs >> 40) & 0xFF;',
        'bytes[5] = timestampMs & 0xFF;',
        'bytes[6] = 0x70;',
        'bytes[7] = 0x00;',
        'bytes[8] = 0x80;',
        'bytes[9] = 0x00;',
        'for (int i = 10; i < 16; i++) {',
        '@"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",',
      ],
    },
  ],
  android: [
    {
      file: 'android/build.gradle',
      lines: ['def minBundleId = project.hasProperty("MIN_BUNDLE_ID") ? project.properties["MIN_BUNDLE_ID"] : null'],
    },
    {
      file: 'android/src/main/java/com/hotupdater/HotUpdaterImpl.kt',
      lines: ['return BuildConfig.MIN_BUNDLE_ID.takeIf { it != "null" } ?: generateMinBundleIdFromBuildTimestamp()'],
    },
  ],
}

/** Each pinned line the loader's source lacks, as "file: no ..."; read(file) returns undefined for a missing file. */
export const missingPins = (pins, read) =>
  pins.flatMap(({ file, lines }) => {
    const text = read(file)
    if (text === undefined) return [`${file}: not found`]
    return lines.filter((line) => !text.includes(line)).map((line) => `${file}: no ${JSON.stringify(line)}`)
  })

const checkLoader = (platform, loaderDir) => {
  const read = (file) => {
    try {
      return readFileSync(path.join(loaderDir, file), 'utf8')
    } catch {
      return undefined
    }
  }
  const missing = missingPins(LOADER_PINS[platform], read)
  if (missing.length) {
    throw new Error(`the loader at ${loaderDir} no longer reads our value as pinned:\n  ${missing.join('\n  ')}`)
  }
  const version = JSON.parse(read('package.json') ?? '{}').version
  console.log(`check-min-bundle-id: loader ${loaderDir} (${version}) has all ${platform} pins`)
}

const defaultLoaderDir = () => {
  const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'app')
  const pkg = createRequire(path.join(appDir, 'package.json')).resolve('@hot-updater/react-native/package.json')
  return path.dirname(pkg)
}

/** The app bundle's own Info.plist in an .ipa, not one of its frameworks' or extensions'. */
export const appInfoPlistEntry = (entries) => entries.find((e) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(e))

/** Every dex in an .apk (at its root) or an .aab (under a module's dex/). */
export const dexEntries = (entries) => entries.filter((e) => /(^|\/)classes\d*\.dex$/.test(e))

/** HOT_UPDATER_BUILD_TIMESTAMP from an XML plist, as a number; undefined when absent or not plain digits. */
export const buildTimestampInPlist = (xml) => {
  const match = xml.match(/<key>HOT_UPDATER_BUILD_TIMESTAMP<\/key>\s*<string>(\d+)<\/string>/)
  return match ? Number(match[1]) : undefined
}

const run = (cmd, args, input) => {
  const out = spawnSync(cmd, args, { input, maxBuffer: 512 * 1024 * 1024 })
  if (out.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${String(out.stderr).trim()}`)
  return out.stdout
}

// -Z1 lists bare entry names, one per line (Info-ZIP unzip, on both runner images).
const zipEntries = (file) =>
  String(run('unzip', ['-Z1', file]))
    .split('\n')
    .filter(Boolean)
const zipEntry = (file, entry) => run('unzip', ['-p', file, entry])

const checkIos = (ipa, expected) => {
  const entry = appInfoPlistEntry(zipEntries(ipa))
  if (!entry) throw new Error(`${ipa}: no Payload/*.app/Info.plist`)
  // The built plist is binary; plutil (macOS) turns it into XML on stdout.
  const xml = String(run('plutil', ['-convert', 'xml1', '-o', '-', '-'], zipEntry(ipa, entry)))
  const stamp = buildTimestampInPlist(xml)
  if (stamp === undefined) throw new Error(`${ipa} ${entry}: no HOT_UPDATER_BUILD_TIMESTAMP`)
  const id = minBundleIdFor(stamp)
  if (id !== expected) throw new Error(`${ipa} ${entry}: timestamp ${stamp} gives ${id}, not ${expected}`)
  console.log(`check-min-bundle-id: ${ipa} ${entry} HOT_UPDATER_BUILD_TIMESTAMP ${stamp} = ${id}`)
}

const checkAndroid = (file, expected) => {
  const dexes = dexEntries(zipEntries(file))
  if (dexes.length === 0) throw new Error(`${file}: no classes*.dex`)
  const carrier = dexes.find((entry) => zipEntry(file, entry).includes(expected))
  if (!carrier) throw new Error(`${file}: none of ${dexes.length} dex files carries MIN_BUNDLE_ID ${expected}`)
  console.log(`check-min-bundle-id: ${file} ${carrier} carries MIN_BUNDLE_ID ${expected}`)
}

const main = () => {
  const args = process.argv.slice(2)
  const loaderArg = args.find((a) => a.startsWith('--loader='))
  const [platform, ...rest] = args.filter((a) => a !== loaderArg)
  const expected = rest.pop()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7000-8000-000000000000$/.test(expected ?? '')) {
    throw new Error(`the last argument must be the build's MIN_BUNDLE_ID: ${expected}`)
  }
  if (rest.length === 0) throw new Error('no binary to check')
  if (platform === 'ios' || platform === 'android') {
    checkLoader(platform, loaderArg ? loaderArg.slice('--loader='.length) : defaultLoaderDir())
  }
  if (platform === 'ios' && rest.length === 1) return checkIos(rest[0], expected)
  if (platform === 'android') return rest.forEach((file) => checkAndroid(file, expected))
  throw new Error(`usage: ios <ipa> <id> | android <aab|apk>... <id> (got ${platform})`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    main()
  } catch (error) {
    console.error(`check-min-bundle-id: ${error.message}`)
    process.exit(1)
  }
}
