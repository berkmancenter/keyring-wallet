#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Widens one production or preview bundle past ring 0, for ota-publish.yml's
 * promote action. A published bundle reaches ring 0 only (ota-deploy.mjs);
 * this is the one way it goes further.
 *
 *   node scripts/ota/promote.mjs --channel production --platform ios --bundle-id <id> --to ring2 \
 *     [--soak-hours N] [--check]
 *   node scripts/ota/promote.mjs --channel production --bundles ios:<id>,android:<id> --to ring2 ...
 *
 * With --bundles, each platform's bundle is checked first, every check on each;
 * if any fails, none is widened and the run names which one failed. Only then
 * are they widened, one after another. That second step can't be atomic: if a
 * later update fails after an earlier one went through, the run says which one
 * widened, and recovery is `disable` on it (or re-running the promote, which
 * refuses the one already wide).
 *
 * A phone takes a bundle when its ring is in the bundle's target cohorts
 * (isCohortEligibleForUpdate in @hot-updater/core). Ring names are not numeric
 * cohorts, so the percentage rollout never applies to them, and it must stay 0.
 * Promoting to a ring targets every ring up to it: ring1 is ring0 and ring1,
 * ring2 is all three.
 *
 * The server's record (`bundle show`) must show a bundle on that channel and
 * platform, enabled, with a 0 rollout, targeting exactly the ring below the
 * new one, and published at least --soak-hours ago (its id is a UUIDv7, so the
 * publish time is in it). The soak defaults to DEFAULT_SOAK_HOURS when nothing
 * sets it. ota-publish passes the repository variable OTA_PROMOTE_SOAK_HOURS;
 * setting it to 0 (no soak, while the audience is beta testers) is a recorded
 * decision, and a missing variable gives the safe number, not none. Until rings have members beyond ring 0, ring0 may go
 * straight to ring2 (ring 1 is empty: no install can join it yet). --check (a
 * dry run) checks and changes nothing. After the update, the record must
 * target the new rings with the rollout still 0.
 * Needs OTA_SERVER_URL and HOT_UPDATER_AUTH_TOKEN (the CLI's
 * hot-updater.config.ts reads them).
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const PROMOTE_CHANNELS = ['production', 'preview']
export const DEFAULT_SOAK_HOURS = 24
export const RING_TARGETS = { ring0: ['ring0'], ring1: ['ring0', 'ring1'], ring2: ['ring0', 'ring1', 'ring2'] }
// The rings a bundle may be promoted from, per destination. ring0 -> ring2 is allowed while ring 1 has no members.
const FROM = { ring1: ['ring0'], ring2: ['ring0', 'ring1'] }

/** The publish time of a UUIDv7 bundle id, in milliseconds. */
export const publishedAt = (id) => parseInt(String(id).replace(/-/g, '').slice(0, 12), 16)

/** The ring a target-cohort list amounts to, or null when it is not one of RING_TARGETS. */
export const ringOf = (targetCohorts) => {
  const have = [...(targetCohorts ?? [])].sort().join(',')
  return Object.keys(RING_TARGETS).find((r) => [...RING_TARGETS[r]].sort().join(',') === have) ?? null
}

/** Whether `bundle` (the server's record for bundleId, or null) may be promoted to `to` at time `now`. */
export const checkPromote = (bundle, { channel, platform, bundleId, to, soakHours = DEFAULT_SOAK_HOURS, now = Date.now() }) => {
  if (!PROMOTE_CHANNELS.includes(channel)) return { ok: false, reason: `channel ${channel} is not promoted here` }
  if (!FROM[to]) return { ok: false, reason: `--to must be ring1 or ring2 (got ${to})` }
  if (!bundle || bundle.id !== bundleId) return { ok: false, reason: `the server has no bundle ${bundleId}` }
  if (bundle.channel !== channel) return { ok: false, reason: `${bundleId} is a ${bundle.channel} bundle, not ${channel}` }
  if (bundle.platform !== platform) return { ok: false, reason: `${bundleId} is a ${bundle.platform} bundle, not ${platform}` }
  if (bundle.enabled === false) return { ok: false, reason: `${bundleId} is disabled` }
  if ((bundle.rolloutCohortCount ?? 0) !== 0) {
    return { ok: false, reason: `${bundleId} has a percentage rollout (${bundle.rolloutCohortCount}); rings only` }
  }
  const from = ringOf(bundle.targetCohorts)
  if (from === null) return { ok: false, reason: `${bundleId} targets ${JSON.stringify(bundle.targetCohorts)}, not a ring` }
  if (!FROM[to].includes(from)) return { ok: false, reason: `${bundleId} is at ${from}; ${to} is promoted from ${FROM[to].join(' or ')}` }
  const hours = (now - publishedAt(bundle.id)) / 3600000
  if (!(soakHours >= 0)) return { ok: false, reason: `the soak must be a number of hours (got ${soakHours})` }
  if (!(hours >= soakHours)) {
    return { ok: false, reason: `${bundleId} was published ${hours.toFixed(1)} h ago; it soaks ${soakHours} h first` }
  }
  return { ok: true, from, hours }
}

/** The soak from its raw form: unset or empty (an unset repository variable) is the default; '0' is 0. */
export const soakHoursOf = (value) => (value === undefined || value === '' ? DEFAULT_SOAK_HOURS : Number(value))

/** `ios:<id>,android:<id>` (either order, each platform once) → [{ platform, bundleId }]. */
export const parseBundles = (value) => {
  const pairs = String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [platform, bundleId, extra] = part.split(':')
      if (extra !== undefined || !['ios', 'android'].includes(platform) || !bundleId) {
        throw new Error(`--bundles takes ios:<id>,android:<id> (got '${part}')`)
      }
      return { platform, bundleId }
    })
  if (pairs.length === 0) throw new Error('--bundles names no bundle')
  if (new Set(pairs.map((p) => p.platform)).size !== pairs.length) throw new Error('--bundles names a platform twice')
  return pairs
}

/** Every bundle's check, and whether all passed (nothing is widened unless they did). */
export const checkPromoteAll = (records, targets, common) => {
  const results = targets.map((t, i) => ({ ...t, ...checkPromote(records[i], { ...common, ...t }) }))
  return { ok: results.every((r) => r.ok), results }
}

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app')

const cli = (...args) =>
  spawnSync('npx', ['hot-updater', ...args], { cwd: appDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

// The server's record of one bundle, or null when it has none (`bundle show` exits 1 then).
const show = (bundleId) => {
  const run = cli('bundle', 'show', bundleId, '--json')
  return run.status === 0 ? JSON.parse(run.stdout) : null
}

const widen = (bundleId, to, channel) => {
  const run = cli('bundle', 'update', bundleId, '--target-cohorts', RING_TARGETS[to].join(','), '-y')
  if (run.status !== 0) throw new Error(`hot-updater bundle update failed for ${bundleId} (exit ${run.status})`)
  const after = show(bundleId)
  if (!after || ringOf(after.targetCohorts) !== to || (after.rolloutCohortCount ?? 0) !== 0) {
    throw new Error(`${bundleId} does not read ${to} with a 0 rollout after the update`)
  }
  console.log(`promote: ${bundleId} now reaches ${RING_TARGETS[to].join(', ')} on ${channel}`)
}

const main = () => {
  const { values } = parseArgs({
    options: {
      channel: { type: 'string' },
      platform: { type: 'string' },
      'bundle-id': { type: 'string' },
      bundles: { type: 'string' },
      to: { type: 'string' },
      // Empty (an unset repository variable) is the default, not 0.
      'soak-hours': { type: 'string', default: '' },
      check: { type: 'boolean', default: false },
    },
  })
  const common = {
    channel: values.channel,
    to: values.to,
    soakHours: soakHoursOf(values['soak-hours']),
  }
  let targets
  if (values.bundles !== undefined) {
    if (values['bundle-id'] || values.platform) throw new Error('--bundles takes the place of --platform and --bundle-id')
    targets = parseBundles(values.bundles)
  } else {
    if (!values['bundle-id']) throw new Error('--bundle-id is required')
    if (!['ios', 'android'].includes(values.platform)) {
      throw new Error(`--platform must be ios or android (got ${values.platform})`)
    }
    targets = [{ platform: values.platform, bundleId: values['bundle-id'] }]
  }

  const { ok, results } = checkPromoteAll(
    targets.map((t) => show(t.bundleId)),
    targets,
    common,
  )
  for (const r of results) {
    console.log(
      r.ok
        ? `promote: ${r.platform} ${r.bundleId} is an enabled ${common.channel} bundle at ${r.from}, published ${r.hours.toFixed(1)} h ago`
        : `promote: ${r.platform} ${r.bundleId}: ${r.reason}`,
    )
  }
  if (!ok) {
    const failed = results.filter((r) => !r.ok).map((r) => `${r.platform} (${r.reason})`)
    throw new Error(`refusing; nothing widened: ${failed.join('; ')}`)
  }
  if (values.check) return console.log(`promote: --check, nothing changed (would widen to ${common.to})`)

  const widened = []
  for (const t of targets) {
    try {
      widen(t.bundleId, common.to, common.channel)
      widened.push(`${t.platform} ${t.bundleId}`)
    } catch (e) {
      const done = widened.length ? `already widened: ${widened.join(', ')} (disable to undo)` : 'nothing widened'
      throw new Error(`${t.platform}: ${e.message}; ${done}`)
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (e) {
    console.error(`::error::promote: ${e.message}`)
    process.exit(1)
  }
}
