#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Publish an over-the-air bundle to ring 0, with the checks the OTA plan
 * requires (docs/plans/release-cadence-and-testing-strategy/ota_updates_subtask.md).
 *
 *   node scripts/ota-deploy.mjs --build <N> [--platform ios|android|both]
 *        [--channel <name>] [--scope fix|within-purpose] [--message <text>]
 *
 * --build is the store build the bundle targets: its staging-v*-<N> tag names
 * the commit that build was cut from, the same build whose native fingerprint
 * the bundle must match. The change from that commit to HEAD must be
 * JavaScript-only by scripts/release/tier.mjs (exit 0, tier "ota"), with no
 * held class (stored-record deletion, sign-in or key handling, VTI protocol
 * line): those always ship as store builds. Measuring from any other commit
 * could read "ota" for JS that calls a native method the build lacks.
 *
 * --base <commit> replaces --build only for a build that has no staging tag
 * (the spike's quick-install build); it must still be an ancestor of HEAD.
 *
 * A bundle is deployed at 0% rollout, so it reaches nobody, then targeted at
 * ring 0 only. Widening is a separate, deliberate step:
 *   npx hot-updater bundle update <id> --target-cohorts ring0,ring1 -y
 *   npx hot-updater bundle update <id> --target-cohorts ring0,ring1,ring2 -y
 * Withdrawing: npx hot-updater bundle disable <id> -y (phones on it roll back).
 *
 * --skip-tier: the device-test channel only (the quick-install test app, signed
 * with its own throwaway key that no store build carries), with --base: skip the
 * tier check, so the trial can publish a bundle built against a native change
 * (the fingerprint-mismatch step). Refused for any other channel, and said in
 * the log when used.
 *
 * --expect-fingerprint <platform>=<hash> (repeatable): the native fingerprint
 * the target build carries. Each platform published must have one, and the
 * bundle's own (app/fingerprint.json) must equal it, or nothing is deployed: a
 * bundle for another fingerprint is offered to no phone. --recorded-fingerprint
 * <file> (the target build's fingerprint.json) lets the refusal name the
 * sources that differ (scripts/ota/check-fingerprint.mjs). ota-publish.yml
 * always passes it; without the flag no check is made (the CI gate builds and
 * publishes in one checkout).
 *
 * --after-native-config: the job has just run scripts/ota/native-config.mjs on a
 * checkout it verified clean, so exactly the files that script writes may differ
 * (both Info.plists, the Android manifest, app/fingerprint.json) and nothing else.
 *
 * Runs in CI behind the GitHub environment that holds the signing key and
 * requires an approver. Run locally only for the spike, with a throwaway key.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { assertFingerprint } from '../../scripts/ota/check-fingerprint.mjs'

const SCOPES = ['fix', 'within-purpose']
const RING0 = 'ring0'

const { values: args } = parseArgs({
  options: {
    build: { type: 'string' },
    base: { type: 'string' },
    platform: { type: 'string', default: 'both' },
    channel: { type: 'string', default: process.env.OTA_CHANNEL ?? 'production' },
    scope: { type: 'string', default: 'fix' },
    message: { type: 'string' },
    'after-native-config': { type: 'boolean', default: false },
    'skip-tier': { type: 'boolean', default: false },
    'expect-fingerprint': { type: 'string', multiple: true },
    'recorded-fingerprint': { type: 'string' },
  },
})

const fail = (message) => {
  console.error(`ota-deploy: ${message}`)
  process.exit(1)
}

const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const repoDir = path.resolve(appDir, '..')
const git = (...a) => execFileSync('git', a, { cwd: repoDir, encoding: 'utf8' }).trim()

if (!args.build === !args.base) fail('give exactly one of --build <N> (the store build) or --base <commit>')
if (!SCOPES.includes(args.scope)) fail(`--scope must be one of ${SCOPES.join(', ')}`)
if (args['skip-tier'] && (args.channel !== 'device-test' || !args.base)) {
  fail('--skip-tier is only for the device-test channel with --base (the quick-install test app)')
}
const platforms = args.platform === 'both' ? ['ios', 'android'] : [args.platform]
if (!platforms.every((p) => p === 'ios' || p === 'android')) fail('--platform must be ios, android or both')

// 1. What is published is a commit, not a working tree.
const NATIVE_CONFIG_PATHS = new Set([
  'app/ios/AriesBifold/Info.plist',
  'app/ios/AriesBifoldTests/Info.plist',
  'app/android/app/src/main/AndroidManifest.xml',
  'app/fingerprint.json',
])
// Not git(): its trim() would eat the leading space of the first ' M path' line.
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
  cwd: repoDir,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .map((line) => line.slice(3))
const unexpected = args['after-native-config'] ? dirty.filter((p) => !NATIVE_CONFIG_PATHS.has(p)) : dirty
if (unexpected.length) {
  fail(`the working tree has changes (${unexpected.join(', ')}); publish from a clean checkout of a signed commit`)
}
const walletHead = git('rev-parse', 'HEAD')
const bifoldHead = git('rev-parse', 'HEAD:bifold')

// The store build's own commit.
let baseRef = args.base
if (args.build) {
  const tags = git('tag', '--list', `staging-v*-${args.build}`).split('\n').filter(Boolean)
  if (tags.length !== 1) fail(`build ${args.build}: expected one staging-v*-${args.build} tag, found ${tags.length}`)
  baseRef = tags[0]
}
let base
try {
  base = git('rev-parse', `${baseRef}^{commit}`)
} catch {
  fail(`cannot resolve ${baseRef}`)
}
const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', base, walletHead], { cwd: repoDir })
if (ancestor.status !== 0)
  fail(`${baseRef} (${base.slice(0, 8)}) is not an ancestor of HEAD; a bundle builds on its store build`)

// 2. JavaScript-only, and no held class.
// Only exit 0 with tier "ota" permits a publish (tier.mjs's header).
if (args['skip-tier']) {
  console.log(
    `ota-deploy: TIER CHECK SKIPPED (--skip-tier): channel device-test, base ${base.slice(0, 8)}. ` +
      'This bundle is for the quick-install test app only.'
  )
} else {
  const tierScript = path.join(repoDir, 'scripts', 'release', 'tier.mjs')
  if (!existsSync(tierScript)) fail('scripts/release/tier.mjs is missing; refusing to publish without the tier check')
  const run = spawnSync('node', [tierScript, '--range', `${base}..${walletHead}`, '--json'], {
    cwd: repoDir,
    encoding: 'utf8',
  })
  let verdict
  try {
    verdict = JSON.parse(run.stdout)
  } catch {
    fail(`tier.mjs gave no verdict (exit ${run.status}): ${run.stderr}`)
  }
  if (run.status !== 0 || verdict.tier !== 'ota') {
    const held = verdict.held?.length ? `; held: ${verdict.held.join(', ')}` : ''
    fail(`tier is "${verdict.tier}" (exit ${run.status})${held}: this change ships as a store build`)
  }
}

// 3. The signing key must be there: with the public key in the binary, an
// unsigned bundle is refused by every phone, so publishing one helps nobody.
const keyPath = process.env.OTA_SIGNING_KEY ?? path.join(appDir, 'keys', 'ota-private-key.pem')
if (!existsSync(keyPath)) fail(`no signing key at ${keyPath} (OTA_SIGNING_KEY)`)

// 4. Built for the target build's native fingerprint, when the caller names it.
const expected = new Map()
for (const pair of args['expect-fingerprint'] ?? []) {
  const [platform, hash] = pair.split('=')
  if (platform !== 'ios' && platform !== 'android')
    fail(`--expect-fingerprint ${pair}: platform must be ios or android`)
  expected.set(platform, hash)
}
if (expected.size) {
  const fingerprintFile = path.join(appDir, 'fingerprint.json')
  if (!existsSync(fingerprintFile))
    fail('no app/fingerprint.json to check against the target build (run native-config first)')
  const actual = JSON.parse(readFileSync(fingerprintFile, 'utf8'))
  const recorded = args['recorded-fingerprint']
    ? JSON.parse(readFileSync(args['recorded-fingerprint'], 'utf8'))
    : undefined
  for (const platform of platforms) {
    try {
      const hash = assertFingerprint({ platform, actual, expected: expected.get(platform), recorded })
      console.log(`ota-deploy: ${platform} fingerprint ${hash} is the target build's`)
    } catch (error) {
      fail(error.message)
    }
  }
}

const message =
  args.message ??
  `[scope: ${args.scope}] wallet ${walletHead.slice(0, 8)} bifold ${bifoldHead.slice(0, 8)} base ${baseRef}`

const hotUpdater = (...a) => {
  const result = spawnSync('npx', ['hot-updater', ...a], {
    cwd: appDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  if (result.status !== 0) fail(`hot-updater ${a[0]} failed (exit ${result.status})\n${result.stdout}`)
  return result.stdout
}

for (const platform of platforms) {
  // Deployed at 0%: no device is eligible until ring 0 is targeted below.
  hotUpdater('deploy', '-p', platform, '-c', args.channel, '-r', '0', '-m', message)
  const listed = JSON.parse(hotUpdater('bundle', 'list', '-c', args.channel, '--json', '--limit', '20'))
  const rows = Array.isArray(listed) ? listed : listed.data ?? []
  const bundle = rows.find((b) => b.platform === platform && b.message === message)
  if (!bundle) fail(`deployed, but cannot find the ${platform} bundle with message "${message}"`)
  hotUpdater('bundle', 'update', bundle.id, '--target-cohorts', RING0, '-y')
  console.log(`ota-deploy: ${platform} bundle ${bundle.id} is on ${RING0} (channel ${args.channel})`)
}

console.log(`ota-deploy: done. wallet ${walletHead} bifold ${bifoldHead}`)
