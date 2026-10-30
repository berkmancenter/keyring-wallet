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
 *   2. reads the bundle ids from the run's ota-bundle records, else from the
 *      publish job's ota-bundle notices (check-run annotations), else from
 *      ota-deploy's own log lines ("<platform> bundle <id> is on ring0 (channel <c>)");
 *   3. reuses the release chain's green Test builds of the released commit when
 *      both its push-off builds are still downloadable; otherwise dispatches
 *      Test builds on the released branch, finds that run by its head_sha and
 *      dispatch time, and waits for it;
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
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

// CSI escape sequences (colours, cursor moves; every ECMA-48 parameter byte, so colon truecolour too). A log gh was
// told to print anyway still carries them. OSC (hyperlinks, \x1b]8;;…) is not taken out; the notice source covers that.
const CSI = /\x1b\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/g

/**
 * The bundles ota-deploy says it put on ring 0, from a job's log, with its CSI escape sequences taken out first. 10-30:
 * 276.10's logs had escapes on about 500 lines each, none on ota-deploy's own lines, which nothing keeps that way.
 */
export const bundlesFromLog = (log) =>
  [...String(log).replace(CSI, '').matchAll(/ota-deploy: (ios|android) bundle ([0-9a-f-]{36}) is on ring0 \(channel ([\w-]+)\)/g)].map(
    ([, platform, id, channel]) => ({ platform, id, channel })
  )

/** The bundles in an ota-bundle record (ota-deploy's JSON lines); a line that isn't one is skipped. */
export const bundlesFromRecord = (text) =>
  String(text)
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const r = JSON.parse(line)
        return /^(ios|android)$/.test(r.platform) && /^[0-9a-f-]{36}$/.test(r.id) && r.channel ? [{ platform: r.platform, id: r.id, channel: r.channel }] : []
      } catch {
        return []
      }
    })

/**
 * The notice ota-publish.yml writes for each bundle it records, read back from the publish job's check-run
 * annotations: a third place for the ids, apart from both the artifact store and the job log. 10-30: 276.10's records
 * failed to download with "Egress is over the account limit", one log read got HTTP 503 six times, and gh refused the
 * other for its terminal escape sequences, so the post-release had no ids at all. GitHub keeps only about ten notices
 * per step, which is plenty for the one bundle a publish job records but not a place to list many.
 */
export const NOTICE_TITLE = 'ota-bundle'
export const bundleNotice = (b) => `::notice title=${NOTICE_TITLE}::${b.platform} bundle ${b.id} (channel ${b.channel})`
export const bundlesFromAnnotations = (annotations) =>
  (Array.isArray(annotations) ? annotations : [])
    .filter((a) => a?.title === NOTICE_TITLE)
    .flatMap((a) => {
      const m = /^(ios|android) bundle ([0-9a-f-]{36}) \(channel ([\w-]+)\)$/.exec(String(a.message ?? '').trim())
      return m ? [{ platform: m[1], id: m[2], channel: m[3] }] : []
    })

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

/** A gate-smoke run's verdict from its jobs: green only with every judged platform's job green (skipped is not). */
export const smokeVerdict = (jobs, platforms = SMOKE_JOBS.map(([p]) => p)) => {
  // Only the platforms the release published are judged: a platform that never got a bundle (its job failed before
  // publishing) has nothing for its smoke to say about this release, and must not withdraw the other's healthy one.
  const judged = SMOKE_JOBS.filter(([platform]) => platforms.includes(platform))
  if (!judged.length) return { green: false, rows: [] }
  const rows = judged.map(([platform, re]) => {
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

/**
 * What a failed gh call says: gh's own line from stderr (it names the HTTP status, e.g. "gh: Not Found (HTTP 404)"),
 * else the first line of the error. execFileSync's message alone is only "Command failed: gh api …".
 */
export const ghError = (error) =>
  String(error?.stderr ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? String(error?.message ?? error).split('\n')[0]

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
  // Each ota-bundle-<platform> artifact of the publish run, downloaded and read. Any read that fails gives no record,
  // and the log is read instead.
  const readBundleRecords = (runId) => {
    let names = []
    try {
      names = api(`repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`)
        .artifacts.filter((a) => !a.expired && /^ota-bundle-(ios|android)$/.test(a.name))
        .map((a) => a.name)
    } catch (error) {
      log(`the publish run's artifacts are unreadable: ${ghError(error)}`)
      return []
    }
    const out = []
    for (const name of names) {
      try {
        const dir = mkdtempSync(path.join(tmpdir(), 'ota-bundle-'))
        gh('run', 'download', String(runId), '-R', repo, '-n', name, '-D', dir)
        out.push(...bundlesFromRecord(readFileSync(path.join(dir, 'ota-bundle.jsonl'), 'utf8')))
      } catch (error) {
        log(`the ${name} record is unreadable: ${ghError(error)}`)
      }
    }
    return out
  }

  // A job's log is not always readable the moment its run completes (10-29: the first post-release run failed on
  // exactly that). Retry for a few minutes; if it still isn't there, smoke anyway with the bundles unknown: the smoke
  // doesn't need them, and the brake refuses an empty list loudly rather than guessing.
  const readLog = async (jobId) => {
    let anyway = []
    for (let attempt = 1; ; attempt++) {
      try {
        return gh('api', `repos/${repo}/actions/jobs/${jobId}/logs`, ...anyway)
      } catch (error) {
        // A newer gh refuses a response with terminal escape sequences (a job log's colours) unless told to print it
        // (276.10's iOS log). A gh that refuses names the flag and an older one never refuses, so it is passed only
        // after that refusal, and at once.
        if (!anyway.length && ghError(error).includes('--allow-escape-sequences')) {
          anyway = ['--allow-escape-sequences']
          continue
        }
        if (attempt >= LOG_ATTEMPTS) {
          log(`the log of job ${jobId} is still unreadable after ${attempt} tries (${ghError(error)}): bundle ids unknown`)
          return ''
        }
        await sleep(LOG_RETRY_MS)
      }
    }
  }
  // The publish job's ota-bundle notices (bundlesFromAnnotations). Any read that fails gives none, and the log is read.
  const readNotices = (jobId) => {
    try {
      return bundlesFromAnnotations(api(`repos/${repo}/check-runs/${jobId}/annotations?per_page=100`))
    } catch (error) {
      log(`the notices of job ${jobId} are unreadable: ${ghError(error)}`)
      return []
    }
  }
  // The structured record first (ota-publish.yml's ota-bundle-<platform> artifact, from ota-deploy), so the ids don't
  // depend on a log's timing or wording; then the job's notice of the same record; the log only for a platform with
  // neither (a run from before both). The brake is left with no id for a platform only when all three gave none.
  // Where each published platform's id came from (record, log or none), said rather than inferred from whether ids
  // appeared: a record read is what proves the artifact path works under the workflow's token.
  const recorded = readBundleRecords(publishRun)
  const bundles = [...recorded]
  const sources = {}
  for (const j of published) {
    if (recorded.some((b) => b.platform === j.platform)) {
      sources[j.platform] = 'record'
      continue
    }
    const noticed = readNotices(j.id).filter((b) => b.platform === j.platform)
    if (noticed.length) {
      bundles.push(...noticed)
      sources[j.platform] = 'notice'
      continue
    }
    log(`no bundle record or notice for ${j.platform}: reading the publish log`)
    const fromLog = bundlesFromLog(await readLog(j.id)).filter((b) => b.platform === j.platform)
    bundles.push(...fromLog)
    sources[j.platform] = fromLog.length ? 'log' : 'none'
  }
  log(`bundle id sources: ${Object.entries(sources).map(([p, s]) => `${p} ${s}`).join(', ')}`)
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

  // The release chain has usually built and smoked this exact commit already, about 50 minutes of work. Reuse that run
  // when it's green and both its push-off builds are still downloadable, so the brake's verdict lands minutes after
  // the widen instead of an hour; build afresh only when there's no such run.
  const reusableBuilds = () => {
    const sha8 = run.head_sha.slice(0, 8)
    const wanted = [new RegExp(`^keyring-ios-sim-${sha8}-bf[0-9a-f]+$`), new RegExp(`^keyring-android-${sha8}-bf[0-9a-f]+$`)]
    try {
      const runs = api(`repos/${repo}/actions/workflows/test-builds.yml/runs?head_sha=${run.head_sha}&status=success&per_page=20`)
        .workflow_runs.filter((r) => r.head_sha === run.head_sha && r.conclusion === 'success')
      for (const r of runs) {
        const names = api(`repos/${repo}/actions/runs/${r.id}/artifacts?per_page=100`).artifacts.filter((a) => !a.expired).map((a) => a.name)
        if (wanted.every((re) => names.some((n) => re.test(n)))) return r
      }
      log(`no green Test builds of ${sha8} with both push-off builds still downloadable: building afresh`)
    } catch (error) {
      log(`earlier Test builds of ${sha8} are unreadable (${ghError(error)}): building afresh`)
    }
    return undefined
  }
  const reused = reusableBuilds()
  if (reused) log(`reusing Test builds ${reused.id}: green, built from ${run.head_sha.slice(0, 8)}, the commit that was published`)
  const builds = reused ?? (await dispatchAndWait('test-builds.yml', ['platform=both', 'push=off'], { sha: run.head_sha }))
  if (builds.conclusion !== 'success') {
    log(`Test builds ${builds.id} ended ${builds.conclusion}: no smoke`)
    return { ...base, bundles, sources, screens, since, verdict: 'builds-red', testBuilds: builds.id, reusedBuilds: Boolean(reused) }
  }
  const smoke = await dispatchAndWait('gate-smoke.yml', [`run-id=${builds.id}`, 'platform=both'], { title: `Test builds ${builds.id}` })
  const verdict = smokeVerdict(api(`repos/${repo}/actions/runs/${smoke.id}/jobs?per_page=100`).jobs, base.platforms)
  log(`gate-smoke ${smoke.id}: ${verdict.rows.map((r) => `${r.platform} ${r.conclusion}`).join(', ')}`)
  return { ...base, bundles, sources, screens, since, verdict: verdict.green ? 'green' : 'smoke-red', testBuilds: builds.id, reusedBuilds: Boolean(reused), gateSmoke: smoke.id, rows: verdict.rows }
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
    writeFileSync('post-release-handoff.json', JSON.stringify({ sha: r.sha, ref: r.ref, bundles: r.bundles, sources: r.sources ?? {}, since: r.since, screens: r.screens ?? [], verdict: r.verdict, testBuilds: r.testBuilds, gateSmoke: r.gateSmoke }, null, 2))
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}\n`).join(''))
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
        `### Post-release smoke: ${r.verdict}`, '',
        `- released: ${r.ref} at ${r.sha}`,
        ...r.bundles.map((b) => `- ${b.platform} bundle ${b.id} (channel ${b.channel}, from its ${r.sources?.[b.platform] ?? 'unknown source'})`),
        ...(r.platforms ?? []).filter((p) => !r.bundles.some((b) => b.platform === p)).map((p) => `- ${p}: published, bundle id UNKNOWN (no record, no notice, and its log was unreadable)`),
        r.testBuilds ? `- Test builds run ${r.testBuilds}${r.reusedBuilds ? ' (reused: the release chain\'s green build of this commit)' : ''}` : '', r.gateSmoke ? `- gate-smoke run ${r.gateSmoke}` : '',
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
