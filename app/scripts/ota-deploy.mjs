#!/usr/bin/env node
/**
 * Publish an over-the-air bundle to ring 0, with the checks the OTA plan
 * requires (docs/plans/release-cadence-and-testing-strategy/ota_updates_subtask.md).
 *
 *   node scripts/ota-deploy.mjs --base <ref> [--platform ios|android|both]
 *        [--channel <name>] [--scope fix|within-purpose] [--message <text>]
 *
 * --base is the commit the store build was cut from (for example its
 * staging-v* tag). The change since then must be JavaScript-only by
 * scripts/release/tier.mjs, with no held class (stored-record deletion, sign-in
 * or key handling, VTI protocol line): those always ship as store builds.
 *
 * A bundle is deployed at 0% rollout, so it reaches nobody, then targeted at
 * ring 0 only. Widening is a separate, deliberate step:
 *   npx hot-updater bundle update <id> --target-cohorts ring0,ring1 -y
 *   npx hot-updater bundle update <id> --target-cohorts ring0,ring1,ring2 -y
 * Withdrawing: npx hot-updater bundle disable <id> -y (phones on it roll back).
 *
 * Runs in CI behind the GitHub environment that holds the signing key and
 * requires an approver. Run locally only for the spike, with a throwaway key.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

const SCOPES = ['fix', 'within-purpose']
const RING0 = 'ring0'

const { values: args } = parseArgs({
  options: {
    base: { type: 'string' },
    platform: { type: 'string', default: 'both' },
    channel: { type: 'string', default: process.env.OTA_CHANNEL ?? 'production' },
    scope: { type: 'string', default: 'fix' },
    message: { type: 'string' },
    'skip-tier': { type: 'boolean', default: false },
  },
})

const fail = (message) => {
  console.error(`ota-deploy: ${message}`)
  process.exit(1)
}

const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const repoDir = path.resolve(appDir, '..')
const git = (...a) => execFileSync('git', a, { cwd: repoDir, encoding: 'utf8' }).trim()

if (!args.base) fail('--base <ref> is required: the commit the store build was cut from')
if (!SCOPES.includes(args.scope)) fail(`--scope must be one of ${SCOPES.join(', ')}`)
const platforms = args.platform === 'both' ? ['ios', 'android'] : [args.platform]
if (!platforms.every((p) => p === 'ios' || p === 'android')) fail('--platform must be ios, android or both')

// 1. What is published is a commit, not a working tree.
if (git('status', '--porcelain')) fail('the working tree has changes; publish from a clean checkout of a signed commit')
const walletHead = git('rev-parse', 'HEAD')
const bifoldHead = git('rev-parse', 'HEAD:bifold')

// 2. JavaScript-only, and no held class.
const tierScript = path.join(repoDir, 'scripts', 'release', 'tier.mjs')
if (!existsSync(tierScript)) {
  if (!args['skip-tier']) fail('scripts/release/tier.mjs is missing; refusing to publish without the tier check')
  console.warn('ota-deploy: --skip-tier: no tier check (spike only)')
} else {
  const run = spawnSync('node', [tierScript, '--range', `${args.base}..${walletHead}`, '--json'], {
    cwd: repoDir,
    encoding: 'utf8',
  })
  let verdict
  try {
    verdict = JSON.parse(run.stdout)
  } catch {
    fail(`tier.mjs gave no verdict (exit ${run.status}): ${run.stderr}`)
  }
  if (verdict.tier !== 'ota') {
    const held = verdict.held?.length ? `; held: ${verdict.held.join(', ')}` : ''
    fail(`tier is "${verdict.tier}"${held}: this change ships as a store build`)
  }
}

// 3. The signing key must be there: with the public key in the binary, an
// unsigned bundle is refused by every phone, so publishing one helps nobody.
const keyPath = process.env.OTA_SIGNING_KEY ?? path.join(appDir, 'keys', 'ota-private-key.pem')
if (!existsSync(keyPath)) fail(`no signing key at ${keyPath} (OTA_SIGNING_KEY)`)

const message =
  args.message ??
  `[scope: ${args.scope}] wallet ${walletHead.slice(0, 8)} bifold ${bifoldHead.slice(0, 8)} base ${args.base}`

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
