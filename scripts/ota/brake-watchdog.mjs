#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * The brake's second path. On 11-09 (278.9, during a GitHub Actions incident) the post-release run's smoke job ended
 * smoke-red, set every output (verdict=smoke-red, bundles, platforms, gate_smoke), and GitHub never created the run's
 * Brake job: no job, not even a skipped one, no check run, no deployment to the ota environment. The workflow and
 * post-release.mjs were byte-identical to the 11-05 run (41944760452) whose Brake job did run on a red, so no
 * condition, needs or output of ours was wrong; a job GitHub never instantiates can't be fixed from inside its run.
 *
 * So brake-watchdog.yml runs this as its own run, after every post-release run completes (by then that run's Brake job,
 * if GitHub made one, has finished too):
 *
 *   node scripts/ota/brake-watchdog.mjs check --post-release-run <id>
 *     Reads that run's verdict (its post-release-handoff artifact) and its jobs, and decides (decide() below):
 *       brake  the verdict is smoke-red and no Brake job ran: this run brakes, with the same two steps the Brake job
 *              uses (brake.mjs rerun, then brake.mjs withdraw if still red). Writes act=true and what they need.
 *       none   only for a verdict post-release.mjs passes on (PASSING_VERDICTS: none, green), or smoke-red whose own
 *              Brake job ran to success. act=false, exit 0.
 *       alert  something a person must read: any other verdict (smoke-incomplete, builds-red, one added later), the
 *              Brake job ran and failed, the verdict is unreadable (or the run was cancelled or timed out before it
 *              wrote one), or the run is too old to act on. act=false, exit 1, so this run is red and says why. It
 *              never brakes on an alert.
 *
 * Who watches the watchdog: a person. It is a separate RUN, a different failure from 11-09's missing JOB, but if GitHub
 * never creates this run either, nothing here says so. There is no scheduled sweep: after every publish the OTA lane
 * reads the post-release run's verdict and its Brake job (and this run, when it is red), and post-release.mjs's own
 * summary says in words when a smoke-red run shows no Brake job.
 *
 * Read only: every gh call here is a read or an artifact download. The only writes are brake.mjs's, in the steps after.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { downloadArtifact } from '../ci/download-artifact.mjs'
import { PASSING_VERDICTS } from './post-release.mjs'

// Older than this, a run is not acted on by itself: a re-run of the watchdog days later must not withdraw anything.
export const MAX_AGE_MS = 6 * 60 * 60 * 1000
export const BRAKE_JOB = /^Brake\b/
export const HANDOFF = /^post-release-handoff-[0-9a-f]{40}$/
// Why each failing verdict that is not a red is not braked, for the alert. A verdict missing here still alerts.
export const NOT_BRAKED = Object.freeze({
  'smoke-incomplete': 'a smoke job was never listed, so nobody verified this release; it is not a red, so the brake does not act on it',
  'builds-red': "the released commit's Test builds were red, so it was never smoked; the brake deliberately does not act on builds (post-release.yml)",
})

/**
 * What to do about one finished post-release run. verdict: its handoff's verdict (undefined when unreadable).
 * brakeJobs: that run's jobs named Brake…, as GitHub lists them ({ status, conclusion }).
 */
export function decide({ verdict, brakeJobs = [], ageMs = 0, runConclusion }) {
  if (verdict === undefined) {
    if (['cancelled', 'timed_out'].includes(runConclusion))
      return { action: 'alert', why: `the post-release run ended ${runConclusion} before it wrote a verdict: nobody has checked this release, read it now` }
    return { action: 'alert', why: 'the post-release run left no readable verdict: read the run, the brake may not have acted' }
  }
  // "Nothing to do" is this watchdog's permissive answer, so it is given only for the verdicts post-release.mjs itself
  // passes on (the one list both read). Every other verdict but smoke-red is an alert: nobody has shown the release good.
  if (PASSING_VERDICTS.includes(verdict)) return { action: 'none', why: `verdict ${verdict}: nothing to brake` }
  if (verdict !== 'smoke-red') return { action: 'alert', why: `verdict ${verdict}: ${NOT_BRAKED[verdict] ?? 'a verdict this watchdog does not know'}. Nothing was withdrawn: read the run now` }
  const ran = brakeJobs.filter((j) => !['skipped', 'cancelled', null, undefined].includes(j.conclusion))
  if (ran.some((j) => j.conclusion === 'success')) return { action: 'none', why: 'smoke-red, and the run\'s own Brake job ran' }
  if (ran.length) return { action: 'alert', why: `smoke-red, and the run's Brake job ended ${ran.map((j) => j.conclusion).join(', ')}: the release may still be live, read it now` }
  if (ageMs > MAX_AGE_MS) return { action: 'alert', why: `smoke-red with no Brake job, but the run finished ${Math.round(ageMs / 3600000)} h ago: not acted on by itself, read it now` }
  const seen = brakeJobs.length ? `its Brake job ${brakeJobs.map((j) => j.conclusion ?? j.status).join(', ')}` : 'no Brake job in the run at all'
  return { action: 'brake', why: `smoke-red and ${seen}: braking here` }
}

const realGh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })

/** Reads one post-release run and decides. gh, download and now are injectable for tests. */
export async function check({ run, repo, gh = realGh, download = downloadArtifact, now = () => Date.now(), dir }) {
  const api = (route) => JSON.parse(gh('api', route))
  const r = api(`repos/${repo}/actions/runs/${run}`)
  if (r.path !== '.github/workflows/post-release.yml') throw new Error(`run ${run} is ${r.path}, not a post-release run`)
  const jobs = api(`repos/${repo}/actions/runs/${run}/jobs?per_page=100`).jobs
  const brakeJobs = jobs.filter((j) => BRAKE_JOB.test(j.name)).map((j) => ({ status: j.status, conclusion: j.conclusion }))
  let handoff
  let unreadable
  try {
    const names = api(`repos/${repo}/actions/runs/${run}/artifacts?per_page=100`).artifacts.filter((a) => !a.expired && HANDOFF.test(a.name)).map((a) => a.name)
    if (names.length !== 1) throw new Error(`${names.length} post-release-handoff artifacts`)
    const into = dir ?? mkdtempSync(path.join(process.env.RUNNER_TEMP || tmpdir(), 'handoff-'))
    const target = path.join(into, 'h')
    await download({ repo, run, name: names[0], dir: target, where: 'brake-watchdog' })
    const file = readdirSync(target).find((f) => f.endsWith('.json'))
    handoff = JSON.parse(readFileSync(path.join(target, file), 'utf8'))
  } catch (error) {
    handoff = undefined
    unreadable = String(error.message).split('\n')[0]
  }
  const ageMs = now() - Date.parse(r.updated_at)
  const d = decide({ verdict: handoff?.verdict, brakeJobs, ageMs, runConclusion: r.conclusion })
  const platforms = Array.isArray(handoff?.platforms) ? handoff.platforms : (handoff?.bundles ?? []).map((b) => b.platform)
  return { ...d, unreadable, run: Number(run), sha: handoff?.sha, gateSmoke: handoff?.gateSmoke, bundles: handoff?.bundles ?? [], platforms, brakeJobs }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, ...rest] = process.argv.slice(2)
  const { values } = parseArgs({ args: rest, options: { 'post-release-run': { type: 'string' }, repo: { type: 'string' } } })
  const out = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`)
  const summary = (lines) => process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n')
  const repo = values.repo ?? process.env.GITHUB_REPOSITORY
  try {
    if (mode !== 'check' || !/^\d+$/.test(values['post-release-run'] ?? '') || !repo) throw new Error('usage: brake-watchdog.mjs check --post-release-run <id>')
    const r = await check({ run: values['post-release-run'], repo })
    const act = r.action === 'brake' && /^\d+$/.test(String(r.gateSmoke ?? '')) && r.bundles.length > 0
    out('act', String(act))
    out('gate_smoke', r.gateSmoke ?? '')
    out('bundles', JSON.stringify(r.bundles))
    out('platforms', JSON.stringify(r.platforms))
    console.log(`post-release ${r.run}: ${r.action}: ${r.why}${r.unreadable ? ` (${r.unreadable})` : ''}`)
    const brakeWithoutTargets = r.action === 'brake' && !act
    summary([
      `### Brake watchdog: ${act ? 'BRAKING (the run\'s own Brake job did not run)' : r.action === 'none' ? 'nothing to do' : 'A PERSON MUST READ THIS'}`, '',
      `- post-release run ${r.run}: ${r.why}`,
      brakeWithoutTargets ? '- **smoke-red with no Brake job, but no gate-smoke run or bundles to act on: NOTHING was withdrawn, and the release is still live**' : '',
      r.unreadable ? `- verdict unreadable: ${r.unreadable}` : '',
    ].filter(Boolean).concat(''))
    process.exitCode = r.action === 'alert' || brakeWithoutTargets ? 1 : 0
  } catch (error) {
    console.error(`brake-watchdog: ${error.message}`)
    out('act', 'false')
    summary([`### Brake watchdog: stopped. ${error.message}`, ''])
    process.exitCode = 1
  }
}
