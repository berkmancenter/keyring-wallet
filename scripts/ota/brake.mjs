#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * The emergency brake (the owner's decision, 10-29): when the launch smoke
 * after a release fails, withdraw that release's bundles, without waiting for
 * an approval. Withdraw ONLY: nothing here can publish or widen a bundle, and
 * its only write to the update server is scripts/ota/withdraw.mjs, which only
 * disables (narrows). Every publish and every widen still needs the owner's
 * own approval in ota-publish.yml.
 *
 * Two steps, so the install the withdraw needs is paid only when it is used:
 *
 *   node scripts/ota/brake.mjs rerun --gate-smoke <run id>
 *     The smoke went red once. A red is not always the bundle: on 10-29 an
 *     Android smoke failed because the emulator's own launcher hung. So the
 *     failed jobs are re-run once, and the brake acts only if the smoke is
 *     still red. Writes still_red=true|false to $GITHUB_OUTPUT.
 *
 *   node scripts/ota/brake.mjs withdraw --bundles '<json>' --platforms '<json>' (both from post-release)
 *     Withdraws each bundle (scripts/ota/withdraw.mjs, which checks the
 *     server's record is that channel's and platform's, and enabled, then
 *     disables it and checks it reads disabled). A bundle that isn't one this
 *     brake may touch is refused and named. Exit 0 only when every bundle is
 *     withdrawn.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { smokeVerdict } from './post-release.mjs'

// The only things this module may do to a bundle. A test holds it to this.
export const BRAKE_ACTIONS = Object.freeze(['withdraw'])
const CHANNELS = ['production', 'preview']
const PLATFORMS = ['ios', 'android']
const BUNDLE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The bundles the brake may withdraw, and the ones it refuses (named, with why). */
export const brakeTargets = (bundles) => {
  const ok = []
  const refused = []
  for (const b of Array.isArray(bundles) ? bundles : []) {
    const why = !BUNDLE_ID.test(b?.id ?? '')
      ? 'not a bundle id'
      : !PLATFORMS.includes(b.platform)
        ? `platform ${b.platform}`
        : !CHANNELS.includes(b.channel)
          ? `channel ${b.channel}`
          : undefined
    ;(why ? refused : ok).push(why ? { ...b, why } : b)
  }
  return { ok, refused }
}

const realGh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

/** Re-runs a red smoke's failed jobs once and waits; still red only if a platform job is red again. */
export async function rerunAndJudge({ gateSmoke, repo, gh = realGh, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = 60000, log = console.log }) {
  const api = (route) => JSON.parse(gh('api', route))
  const before = api(`repos/${repo}/actions/runs/${gateSmoke}`)
  if (before.status !== 'completed') throw new Error(`gate-smoke ${gateSmoke} is still ${before.status}`)
  const first = smokeVerdict(api(`repos/${repo}/actions/runs/${gateSmoke}/jobs?per_page=100`).jobs)
  if (first.green) return { stillRed: false, rows: first.rows, rerun: false }
  gh('run', 'rerun', String(gateSmoke), '--failed', '-R', repo)
  log(`gate-smoke ${gateSmoke} red (${first.rows.map((r) => `${r.platform} ${r.conclusion}`).join(', ')}): re-running its failed jobs once`)
  // The rerun is a new attempt of the same run: wait for it to start, then to finish.
  for (let r = before; ; ) {
    await sleep(pollMs)
    r = api(`repos/${repo}/actions/runs/${gateSmoke}`)
    if (r.run_attempt > before.run_attempt && r.status === 'completed') break
  }
  const again = smokeVerdict(api(`repos/${repo}/actions/runs/${gateSmoke}/jobs?per_page=100`).jobs)
  log(`gate-smoke ${gateSmoke} re-run: ${again.rows.map((r) => `${r.platform} ${r.conclusion}`).join(', ')}`)
  return { stillRed: !again.green, rows: again.rows, rerun: true }
}

const realWithdraw = ({ channel, platform, bundleId }) =>
  execFileSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), 'withdraw.mjs'), '--channel', channel, '--platform', platform, '--bundle-id', bundleId], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

/**
 * Withdraws each bundle it may; the rest are refused and named. Never anything but a withdraw. platforms: what the
 * release published. A published platform with no bundle id here (its publish log was unreadable) can't be withdrawn
 * and is named as unidentified: the rest are still withdrawn, since that limits the harm, and the result says partial.
 */
export function withdrawAll({ bundles, platforms = [], withdraw = realWithdraw, log = console.log }) {
  const { ok, refused } = brakeTargets(bundles)
  const unidentified = platforms.filter((p) => !ok.some((b) => b.platform === p))
  for (const p of unidentified) log(`${p} was published, but its bundle id is unknown: NOT withdrawn`)
  for (const r of refused) log(`refused ${JSON.stringify(r)}: ${r.why}`)
  const results = ok.map((b) => {
    try {
      withdraw({ channel: b.channel, platform: b.platform, bundleId: b.id })
      log(`withdrew ${b.platform} bundle ${b.id} (channel ${b.channel})`)
      return { ...b, withdrawn: true }
    } catch (error) {
      const why = String(error.stderr || error.message).trim().split('\n').pop()
      log(`could not withdraw ${b.platform} bundle ${b.id}: ${why}`)
      return { ...b, withdrawn: false, why }
    }
  })
  const allWithdrawn = ok.length > 0 && refused.length === 0 && unidentified.length === 0 && results.every((r) => r.withdrawn)
  const anyWithdrawn = results.some((r) => r.withdrawn)
  return { results, refused, unidentified, allWithdrawn, partial: anyWithdrawn && !allWithdrawn }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, ...rest] = process.argv.slice(2)
  const { values } = parseArgs({ args: rest, options: { 'gate-smoke': { type: 'string' }, bundles: { type: 'string' }, platforms: { type: 'string' }, repo: { type: 'string' } } })
  const out = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`)
  const summary = (lines) => process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n')
  try {
    if (mode === 'rerun') {
      const repo = values.repo ?? process.env.GITHUB_REPOSITORY
      if (!/^\d+$/.test(values['gate-smoke'] ?? '') || !repo) throw new Error('usage: brake.mjs rerun --gate-smoke <run id>')
      const r = await rerunAndJudge({ gateSmoke: values['gate-smoke'], repo })
      out('still_red', String(r.stillRed))
      summary([`### Brake: ${r.stillRed ? 'smoke still red after one re-run, withdrawing' : 'smoke green on its re-run, nothing withdrawn'}`, '', ...r.rows.map((row) => `- ${row.platform} smoke: ${row.conclusion}`), ''])
    } else if (mode === 'withdraw') {
      const r = withdrawAll({ bundles: JSON.parse(values.bundles || '[]'), platforms: JSON.parse(values.platforms || '[]') })
      const headline = r.allWithdrawn ? 'the release is withdrawn' : r.partial ? 'the release is PARTIALLY withdrawn' : 'NOTHING was withdrawn'
      summary([
        `### Brake: ${headline}`, '',
        ...r.unidentified.map((p) => `- ${p}: published, bundle id unknown: NOT withdrawn (withdraw it by hand)`),
        ...r.results.map((b) => `- ${b.platform} bundle ${b.id} (channel ${b.channel}): ${b.withdrawn ? 'withdrawn' : `NOT withdrawn: ${b.why}`}`),
        ...r.refused.map((b) => `- refused ${b.id ?? '?'}: ${b.why}`), '',
      ])
      process.exitCode = r.allWithdrawn ? 0 : 1
    } else {
      throw new Error('usage: brake.mjs rerun --gate-smoke <id> | withdraw --bundles <json>')
    }
  } catch (error) {
    console.error(`brake: ${error.message}`)
    process.exitCode = 1
  }
}
