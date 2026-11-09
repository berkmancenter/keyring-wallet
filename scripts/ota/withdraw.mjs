#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Withdraws one production or preview bundle, for ota-publish.yml's disable
 * action. It only narrows: `hot-updater bundle disable` takes the bundle out
 * of every update check, and phones on it go back to the previous bundle (or
 * the build's own). Nothing here can widen a bundle or publish one.
 *
 *   node scripts/ota/withdraw.mjs --channel production --platform ios --bundle-id <id> [--check]
 *
 * The server's record of the bundle (`bundle show`) must be on that channel,
 * for that platform, and still enabled, or the run stops before changing
 * anything. --check (a dry run) does only that. After disabling, the record
 * must read disabled.
 * Needs OTA_SERVER_URL and HOT_UPDATER_AUTH_TOKEN (the CLI's
 * hot-updater.config.ts reads them).
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const WITHDRAW_CHANNELS = ['production', 'preview']

/** Whether `bundle` (the server's record for bundleId, or null) may be withdrawn. */
export const checkWithdraw = (bundle, { channel, platform, bundleId }) => {
  if (!WITHDRAW_CHANNELS.includes(channel)) return { ok: false, reason: `channel ${channel} is not withdrawn here` }
  if (!bundle || bundle.id !== bundleId) return { ok: false, reason: `the server has no bundle ${bundleId}` }
  if (bundle.channel !== channel) return { ok: false, reason: `${bundleId} is a ${bundle.channel} bundle, not ${channel}` }
  if (bundle.platform !== platform) return { ok: false, reason: `${bundleId} is a ${bundle.platform} bundle, not ${platform}` }
  if (bundle.enabled === false) return { ok: false, reason: `${bundleId} is already disabled` }
  return { ok: true, bundle }
}

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app')

const cli = (...args) =>
  spawnSync('npx', ['hot-updater', ...args], { cwd: appDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

// The server's record of one bundle, or null when it has none (`bundle show` exits 1 then).
const show = (bundleId) => {
  const run = cli('bundle', 'show', bundleId, '--json')
  return run.status === 0 ? JSON.parse(run.stdout) : null
}

const main = () => {
  const { values } = parseArgs({
    options: {
      channel: { type: 'string' },
      platform: { type: 'string' },
      'bundle-id': { type: 'string' },
      check: { type: 'boolean', default: false },
    },
  })
  const target = { channel: values.channel, platform: values.platform, bundleId: values['bundle-id'] }
  if (!target.bundleId) throw new Error('--bundle-id is required')
  if (!['ios', 'android'].includes(target.platform)) throw new Error(`--platform must be ios or android (got ${target.platform})`)

  const before = checkWithdraw(show(target.bundleId), target)
  if (!before.ok) throw new Error(`${before.reason}; refusing`)
  console.log(`withdraw: ${target.bundleId} is an enabled ${target.channel} ${target.platform} bundle`)
  if (values.check) return console.log('withdraw: --check, nothing changed')

  const run = cli('bundle', 'disable', target.bundleId, '-y')
  if (run.status !== 0) throw new Error(`hot-updater bundle disable failed (exit ${run.status})`)
  const after = show(target.bundleId)
  if (!after || after.enabled !== false) throw new Error(`${target.bundleId} still reads enabled after disable`)
  console.log(`withdraw: ${target.bundleId} is disabled on ${target.channel}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (e) {
    console.error(`::error::withdraw: ${e.message}`)
    process.exit(1)
  }
}
