#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Writes the over-the-air loader's settings into the native files, the same
 * way in every job that needs them: the store build (staging.yaml) and the
 * publish (ota-publish.yml). Nothing here is committed; each job writes it
 * into its own checkout.
 *
 *   OTA_PUBLIC_KEY='-----BEGIN PUBLIC KEY-----...' OTA_CHANNEL=production \
 *     node scripts/ota/native-config.mjs [--no-fingerprint] [--build-timestamp[=<ms>]]
 *
 * - The loader's public key (a repository variable: it is public) goes into
 *   Info.plist (HOT_UPDATER_PUBLIC_KEY) and the Android manifest
 *   (com.hotupdater.PUBLIC_KEY). With it, a phone refuses any bundle that is
 *   unsigned or signed with another key.
 * - The channel goes into the same two files (HOT_UPDATER_CHANNEL,
 *   com.hotupdater.CHANNEL).
 * - With --build-timestamp (the store build only, never the publish), the
 *   build's time in milliseconds goes into Info.plist
 *   (HOT_UPDATER_BUILD_TIMESTAMP), and the MIN_BUNDLE_ID derived from it goes
 *   to the Android build as the Gradle property ORG_GRADLE_PROJECT_MIN_BUNDLE_ID,
 *   through $GITHUB_ENV. The property can't go into android/gradle.properties,
 *   because the fingerprint hashes that file. The update server offers a binary
 *   only bundles at or after its MIN_BUNDLE_ID. Without one, iOS falls back to
 *   HotUpdater.mm's compile time minus 26 hours, so a new store build could be
 *   served a bundle published the day before it, from older code (275 was
 *   served 273's last update that way, 2026-10-27).
 * - Then `hot-updater fingerprint create` writes fingerprint.json and the
 *   native fingerprint hash.
 *
 * The key is written on one line with literal "\n" separators, as the loader's
 * docs show. Both verifiers strip those, real newlines and spaces before
 * decoding (SignatureVerifier.kt createPublicKey, SignatureVerifier.swift
 * createPublicKey), and one line is safe in a plist string and in an XML
 * attribute alike. The fingerprint ignores Info.plist and the manifest, so a
 * build and a later publish hash the same code whatever these edits look like.
 */
import { spawnSync } from 'node:child_process'
import { createPublicKey } from 'node:crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const CHANNEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/

/** The PEM as one line with literal \n separators, after checking it is an RSA key of 2048 bits or more. */
export const normalisePublicKey = (pem) => {
  const text = String(pem ?? '')
    .replace(/\\n/g, '\n')
    .trim()
  let key
  try {
    key = createPublicKey(text)
  } catch (error) {
    throw new Error(`OTA_PUBLIC_KEY is not a PEM public key: ${error.message}`)
  }
  if (key.asymmetricKeyType !== 'rsa') throw new Error(`OTA_PUBLIC_KEY must be RSA, not ${key.asymmetricKeyType}`)
  if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)
    throw new Error('OTA_PUBLIC_KEY must be at least 2048 bits')
  const spki = key.export({ type: 'spki', format: 'pem' }).trim()
  return spki.split('\n').join('\\n')
}

export const checkChannel = (channel) => {
  if (!CHANNEL_PATTERN.test(String(channel ?? ''))) {
    throw new Error(`OTA_CHANNEL must match ${CHANNEL_PATTERN}: ${channel}`)
  }
  return channel
}

/**
 * The MIN_BUNDLE_ID both loaders derive from a build time: a UUID v7 holding the milliseconds, with zeros where
 * a real v7 is random (HotUpdater.mm generateUUIDv7FromTimestamp, HotUpdaterImpl.kt
 * generateMinBundleIdFromBuildTimestamp, @hot-updater/react-native 0.36.18).
 */
export const minBundleIdFor = (ms) => {
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms >= 2 ** 48) {
    throw new Error(`a build timestamp is milliseconds since 1970: ${ms}`)
  }
  const hex = ms.toString(16).padStart(12, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8)}-7000-8000-000000000000`
}

/** --build-timestamp alone means now; --build-timestamp=<ms> pins it (tests). Undefined without the flag. */
export const buildTimestampArg = (argv, now = Date.now) => {
  const arg = argv.find((a) => a === '--build-timestamp' || a.startsWith('--build-timestamp='))
  if (arg === undefined) return undefined
  if (arg === '--build-timestamp') return now()
  const value = arg.slice('--build-timestamp='.length)
  if (!/^\d+$/.test(value)) throw new Error(`--build-timestamp takes milliseconds: ${value}`)
  return Number(value)
}

const escapeXml = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Sets a top-level string in an XML plist: replaces its value, or adds it before the root dict closes. */
export const setPlistString = (plist, key, value) => {
  const keyTag = `<key>${key}</key>`
  const existing = new RegExp(`(${keyTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*<string>)[\\s\\S]*?(</string>)`)
  if (existing.test(plist)) return plist.replace(existing, (_, open, close) => `${open}${escapeXml(value)}${close}`)
  const end = plist.lastIndexOf('</dict>')
  if (end < 0 || !plist.slice(end).includes('</plist>')) throw new Error('Info.plist has no root dict to add to')
  return `${plist.slice(0, end)}\t${keyTag}\n\t<string>${escapeXml(value)}</string>\n${plist.slice(end)}`
}

/** Sets <meta-data android:name=name android:value=value/> inside <application>: replaces it, or adds it first. */
export const setManifestMetaData = (manifest, name, value) => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const existing = new RegExp(`<meta-data\\s+android:name="${escapedName}"\\s+android:value="[^"]*"\\s*/>`)
  const element = `<meta-data android:name="${name}" android:value="${escapeXml(value)}" />`
  if (existing.test(manifest)) return manifest.replace(existing, element)
  const open = manifest.match(/<application\b[^>]*>/)
  if (!open) throw new Error('AndroidManifest.xml has no <application> element')
  const at = open.index + open[0].length
  return `${manifest.slice(0, at)}\n        ${element}${manifest.slice(at)}`
}

const main = () => {
  const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'app')
  const publicKey = normalisePublicKey(process.env.OTA_PUBLIC_KEY)
  const channel = checkChannel(process.env.OTA_CHANNEL ?? 'production')
  const buildTimestamp = buildTimestampArg(process.argv)
  const minBundleId = buildTimestamp === undefined ? undefined : minBundleIdFor(buildTimestamp)

  const plistPath = path.join(appDir, 'ios', 'AriesBifold', 'Info.plist')
  let plist = readFileSync(plistPath, 'utf8')
  plist = setPlistString(plist, 'HOT_UPDATER_PUBLIC_KEY', publicKey)
  plist = setPlistString(plist, 'HOT_UPDATER_CHANNEL', channel)
  if (buildTimestamp !== undefined) plist = setPlistString(plist, 'HOT_UPDATER_BUILD_TIMESTAMP', String(buildTimestamp))
  writeFileSync(plistPath, plist)

  const manifestPath = path.join(appDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')
  let manifest = readFileSync(manifestPath, 'utf8')
  manifest = setManifestMetaData(manifest, 'com.hotupdater.PUBLIC_KEY', publicKey)
  manifest = setManifestMetaData(manifest, 'com.hotupdater.CHANNEL', channel)
  writeFileSync(manifestPath, manifest)

  console.log(`ota native-config: public key and channel "${channel}" written to Info.plist and AndroidManifest.xml`)
  if (minBundleId !== undefined) {
    // OTA_MIN_BUNDLE_ID is for check-min-bundle-id.mjs, which reads it back out of the built binary.
    if (process.env.GITHUB_ENV) {
      appendFileSync(
        process.env.GITHUB_ENV,
        `ORG_GRADLE_PROJECT_MIN_BUNDLE_ID=${minBundleId}\nOTA_MIN_BUNDLE_ID=${minBundleId}\n`
      )
    }
    console.log(`ota native-config: build timestamp ${buildTimestamp}, MIN_BUNDLE_ID ${minBundleId}`)
  }

  if (process.argv.includes('--no-fingerprint')) return
  const run = spawnSync('npx', ['hot-updater', 'fingerprint', 'create'], {
    cwd: appDir,
    stdio: 'inherit',
  })
  if (run.status !== 0) throw new Error(`hot-updater fingerprint create failed (exit ${run.status})`)
  console.log('ota native-config: fingerprint written')
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    main()
  } catch (error) {
    console.error(`ota native-config: ${error.message}`)
    process.exit(1)
  }
}
