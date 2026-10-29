#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * The launch smoke after a release, for post-release.yml (the owner's pipeline,
 * 10-29: release on merge, then test the released commit). Given a finished
 * "OTA publish (ring 0)" run (renamed "OTA release"), it:
 *
 *   1. reads which platforms it published: a job whose "Publish to ring 0"
 *      step succeeded. A dry run, a promote, a withdraw or a device-test run
 *      publishes nothing, and the script stops there with nothing to do;
 *   2. reads the bundle ids from ota-deploy's own log lines
 *      ("<platform> bundle <id> is on ring0 (channel <c>)");
 *   3. dispatches Test builds on the released branch, finds that run by its
 *      head_sha and dispatch time, and waits for it;
 *   4. dispatches gate-smoke.yml with that run's id, on the same branch, and
 *      waits for it;
 *   5. lists the screens changed since the previous release (or the store
 *      build), for the quick simulator check of each one after release.
 *
 *   node scripts/ota/post-release.mjs --publish-run <id> [--repo owner/name]
 *
 * Writes the result to $GITHUB_OUTPUT (verdict, sha, ref, bundles, screens,
 * test_builds, gate_smoke), $GITHUB_STEP_SUMMARY and post-release-handoff.json. verdict: none (not a
 * publish), green, smoke-red, builds-red. Exit 0 for none and green, 2 for a
 * red build or smoke, 1 for an error. It never publishes, widens or withdraws
 * anything.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { changedFiles } from '../release/tier.mjs'

const PUBLISH_STEP = 'Publish to ring 0'
const SMOKE_JOBS = [
  ['ios', /^iOS smoke /],
  ['android', /^Android smoke /],
]

/** The platforms a publish run published: its jobs whose "Publish to ring 0" step succeeded. */
export const publishedJobs = (jobs) =>
  jobs
    .filter((j) => (j.steps ?? []).some((s) => s.name === PUBLISH_STEP && s.conclusion === 'success'))
    .map((j) => ({ id: j.id, platform: /\((ios|android)\)/.exec(j.name)?.[1] }))
    .filter((j) => j.platform)

/** The bundles ota-deploy says it put on ring 0, from a job's log. */
export const bundlesFromLog = (log) =>
  [...String(log).matchAll(/ota-deploy: (ios|android) bundle ([0-9a-f-]{36}) is on ring0 \(channel ([\w-]+)\)/g)].map(
    ([, platform, id, channel]) => ({ platform, id, channel })
  )

/** The screens a person would look at: the app's and bifold's .tsx screens and components, not tests. */
export const screensOf = (files) =>
  files.filter((f) => /^(app\/src|bifold\/packages\/[^/]+\/src)\/(.*\/)?(screens|components)\/[^/]+\.tsx$/.test(f) && !/__tests__|\.test\./.test(f))

/**
 * Where to measure the changed screens from: the newest earlier publish whose commit is an ancestor of this one
 * (the screens it shipped were checked after it), else the store build's tag. isAncestor and describe are git reads.
 */
export const baseOf = ({ sha, earlier, isAncestor, describe }) => earlier.find((e) => e !== sha && isAncestor(e, sha)) ?? describe(sha)

/**
 * The run this script dispatched: by dispatch, created at or after it asked, and either on the sha (Test builds) or
 * titled for the Test builds run it smokes (gate-smoke's run-name names its run-id). More than one match is refused,
 * naming them, never resolved by picking one: the run found decides the verdict (and, with the brake, a withdraw), so
 * a manual dispatch in the same minute (say an Android-only smoke) must not be taken for this one.
 */
export const pickDispatched = (runs, { sha, title, since }) => {
  const matches = runs.filter(
    (r) =>
      r.event === 'workflow_dispatch' &&
      Date.parse(r.created_at) >= since &&
      (sha ? r.head_sha === sha : true) &&
      (title ? new RegExp(`\\b${title}\\b`).test(r.display_title ?? '') : true)
  )
  if (matches.length > 1) throw new Error(`more than one run matches (${matches.map((r) => r.id).join(', ')}): refusing to pick one`)
  return matches[0]
}

/** A gate-smoke run's verdict from its jobs: green only with both platform jobs green (a skipped one is not). */
export const smokeVerdict = (jobs) => {
  const rows = SMOKE_JOBS.map(([platform, re]) => {
    const job = jobs.find((j) => re.test(j.name))
    return { platform, conclusion: job?.conclusion ?? 'missing' }
  })
  return { green: rows.every((r) => r.conclusion === 'success'), rows }
}

const realGh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

/**
 * The whole post-release run. gh and sleep are injectable for tests. Every read that fails throws: the caller reports
 * an error, never a green smoke.
 */
const gitOk = (...args) => { try { execFileSync('git', args, { stdio: 'ignore' }); return true } catch { return false } }
const realIsAncestor = (a, b) => gitOk('merge-base', '--is-ancestor', a, b)
const realDescribe = (sha) => execFileSync('git', ['describe', '--tags', '--match', 'staging-v*', '--abbrev=0', sha], { encoding: 'utf8' }).trim()

// Reading a just-finished job's log: up to six tries, 30 s apart.
const LOG_ATTEMPTS = 6
const LOG_RETRY_MS = 30000

// How long a dispatched run may take before this gives up with an error (Test builds about 45 min, the smoke about 30):
// a bound of its own, so a waiting environment or a stuck runner can't hold the job to GitHub's six-hour limit.
const MAX_WAIT_MS = 100 * 60 * 1000

export async function postRelease({ publishRun, repo, gh = realGh, isAncestor = realIsAncestor, describe = realDescribe, listChanged = changedFiles, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), pollMs = 60000, maxWaitMs = MAX_WAIT_MS, log = console.log }) {
  const api = (route) => JSON.parse(gh('api', route))
  const run = api(`repos/${repo}/actions/runs/${publishRun}`)
  const jobs = api(`repos/${repo}/actions/runs/${publishRun}/jobs?per_page=100`).jobs
  const published = publishedJobs(jobs)
  const base = { sha: run.head_sha, ref: run.head_branch, bundles: [], platforms: published.map((j) => j.platform) }
  if (!published.length) {
    log(`publish run ${publishRun} published nothing (a dry run, promote, withdraw or device test): no smoke`)
    return { ...base, verdict: 'none' }
  }
  // A job's log is not always readable the moment its run completes (10-29: the first post-release run failed on
  // exactly that). Retry for a few minutes; if it still isn't there, smoke anyway with the bundles unknown: the smoke
  // doesn't need them, and the brake refuses an empty list loudly rather than guessing.
  const readLog = async (jobId) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return gh('api', `repos/${repo}/actions/jobs/${jobId}/logs`)
      } catch (error) {
        if (attempt >= LOG_ATTEMPTS) {
          log(`the log of job ${jobId} is still unreadable after ${attempt} tries: bundle ids unknown`)
          return ''
        }
        await sleep(LOG_RETRY_MS)
      }
    }
  }
  const bundles = []
  for (const j of published) bundles.push(...bundlesFromLog(await readLog(j.id)))
  let screens = []
  let since
  try {
    // Earlier publishes, newest first: successful runs of this workflow with a "Publish to ring 0" step that succeeded.
    const earlier = api(`repos/${repo}/actions/workflows/ota-publish.yml/runs?status=success&per_page=30`)
      .workflow_runs.filter((r) => r.id !== Number(publishRun) && r.head_sha !== run.head_sha)
      .filter((r) => publishedJobs(api(`repos/${repo}/actions/runs/${r.id}/jobs?per_page=100`).jobs).length)
      .map((r) => r.head_sha)
    since = baseOf({ sha: run.head_sha, earlier, isAncestor, describe })
    screens = screensOf(listChanged(`${since}..${run.head_sha}`))
  } catch (error) {
    log(`changed screens unknown: ${String(error.message).split('\n')[0]}`)
  }
  log(`published from ${run.head_branch} at ${run.head_sha.slice(0, 8)}: ${bundles.map((b) => `${b.platform} ${b.id}`).join(', ') || 'no bundle ids in the logs'}`)

  const dispatchAndWait = async (workflow, fields, match) => {
    const since = now() - 5000
    gh('workflow', 'run', workflow, '-R', repo, '--ref', run.head_branch, ...fields.flatMap((f) => ['-f', f]))
    let found
    for (let i = 0; !found && i < 20; i++) {
      await sleep(Math.min(pollMs, 15000))
      const runs = api(`repos/${repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&branch=${encodeURIComponent(run.head_branch)}&per_page=20`).workflow_runs
      found = pickDispatched(runs, { ...match, since })
    }
    // Not found also when the branch moved past the released commit: its Test builds would build another commit.
    if (!found) throw new Error(`dispatched ${workflow} on ${run.head_branch}, but found no run of it for ${run.head_sha.slice(0, 8)}`)
    log(`${workflow}: run ${found.id}`)
    for (let r = found, waited = 0; ; waited += pollMs) {
      if (r.status === 'completed') return r
      if (waited >= maxWaitMs) throw new Error(`${workflow} run ${found.id} still ${r.status} after ${Math.round(waited / 60000)} min: giving up`)
      await sleep(pollMs)
      r = api(`repos/${repo}/actions/runs/${found.id}`)
    }
  }

  const builds = await dispatchAndWait('test-builds.yml', ['platform=both', 'push=off'], { sha: run.head_sha })
  if (builds.conclusion !== 'success') {
    log(`Test builds ${builds.id} ended ${builds.conclusion}: no smoke`)
    return { ...base, bundles, screens, since, verdict: 'builds-red', testBuilds: builds.id }
  }
  const smoke = await dispatchAndWait('gate-smoke.yml', [`run-id=${builds.id}`, 'platform=both'], { title: `Test builds ${builds.id}` })
  const verdict = smokeVerdict(api(`repos/${repo}/actions/runs/${smoke.id}/jobs?per_page=100`).jobs)
  log(`gate-smoke ${smoke.id}: ${verdict.rows.map((r) => `${r.platform} ${r.conclusion}`).join(', ')}`)
  return { ...base, bundles, screens, since, verdict: verdict.green ? 'green' : 'smoke-red', testBuilds: builds.id, gateSmoke: smoke.id, rows: verdict.rows }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { 'publish-run': { type: 'string' }, repo: { type: 'string' } } })
  const repo = values.repo ?? process.env.GITHUB_REPOSITORY
  try {
    if (!/^\d+$/.test(values['publish-run'] ?? '') || !repo) throw new Error('usage: post-release.mjs --publish-run <id> [--repo owner/name]')
    const r = await postRelease({ publishRun: values['publish-run'], repo })
    const out = {
      verdict: r.verdict, sha: r.sha, ref: r.ref, bundles: JSON.stringify(r.bundles), platforms: JSON.stringify(r.platforms ?? []),
      test_builds: r.testBuilds ?? '', gate_smoke: r.gateSmoke ?? '', screens: JSON.stringify(r.screens ?? []),
    }
    // The screen check's handoff (the owner's pipeline: a quick simulator check of each changed screen after release).
    writeFileSync('post-release-handoff.json', JSON.stringify({ sha: r.sha, ref: r.ref, bundles: r.bundles, since: r.since, screens: r.screens ?? [], verdict: r.verdict, testBuilds: r.testBuilds, gateSmoke: r.gateSmoke }, null, 2))
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}\n`).join(''))
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
        `### Post-release smoke: ${r.verdict}`, '',
        `- released: ${r.ref} at ${r.sha}`,
        ...r.bundles.map((b) => `- ${b.platform} bundle ${b.id} (channel ${b.channel})`),
        ...(r.platforms ?? []).filter((p) => !r.bundles.some((b) => b.platform === p)).map((p) => `- ${p}: published, bundle id UNKNOWN (its log was unreadable)`),
        r.testBuilds ? `- Test builds run ${r.testBuilds}` : '', r.gateSmoke ? `- gate-smoke run ${r.gateSmoke}` : '',
        ...(r.rows ?? []).map((row) => `- ${row.platform} smoke: ${row.conclusion}`), '',
        `#### Changed screens since ${r.since ?? 'unknown'} (for the screen check)`, '',
        ...((r.screens ?? []).length ? r.screens.map((f) => `- ${f}`) : ['- none found']), '',
      ].filter((l) => l !== '').join('\n') + '\n')
    }
    process.exitCode = r.verdict === 'none' || r.verdict === 'green' ? 0 : 2
  } catch (error) {
    console.error(`post-release: ${error.message}`)
    process.exitCode = 1
  }
}
