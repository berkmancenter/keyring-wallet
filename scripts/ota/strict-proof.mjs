#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Proves the strict conditions for one commit, so an "ota-strict" change
 * (scripts/release/tier.mjs, exit 5) may be published to ring 0. The owner's
 * rule (10-29): bug, fix, minimal tests, OTA. A strict bundle needs, on the
 * exact commit it is built from:
 *
 *   launch smoke    a green gate-smoke.yml run, with its iOS and its Android
 *                   smoke job both green, of a green Test builds run built
 *                   from this commit (a push or a dispatch on its ref: a pull
 *                   request's run builds the merge ref, not this commit)
 *   targeted tests  the commit status ota-strict/targeted-tests is success:
 *                   the change's own tests green, with a control
 *   sim check       the commit status ota-strict/sim-check is success: one
 *                   simulator check of the changed screen
 *
 * The two statuses are attestations: whoever ran the check sets them
 * (gh api repos/<repo>/statuses/<sha> -f context=... -f state=success
 * -f target_url=<the evidence>), and a status without a target_url does not
 * count. The newest status of a context is the one read. The owner's single
 * approval is the ota-approval environment's, and ring 0 first is how every
 * publish works (scripts/ota/promote.mjs widens), so neither is checked here.
 *
 *   node scripts/ota/strict-proof.mjs --sha <full sha> [--repo owner/name]
 *
 * Prints each condition, met or missing. Exit 0 only when all are met. Reads
 * through `gh api` (GH_TOKEN); any error reading counts as not met.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const STATUS_CONTEXTS = [
  ['targeted tests', 'ota-strict/targeted-tests'],
  ['sim check', 'ota-strict/sim-check'],
]
// The events whose Test builds run builds the commit it names (head_sha).
const OWN_COMMIT_EVENTS = ['push', 'workflow_dispatch']
const SMOKE_JOBS = [
  ['iOS', /^iOS smoke /],
  ['Android', /^Android smoke /],
]

/** The newest status of each context, from the commit's statuses (the API lists them newest first). */
export const newestStatuses = (statuses) => {
  const out = new Map()
  for (const s of statuses) if (!out.has(s.context)) out.set(s.context, s)
  return out
}

/** The attested conditions: each context's newest status must be success and name its evidence. */
export const checkStatuses = (statuses) => {
  const newest = newestStatuses(statuses)
  return STATUS_CONTEXTS.map(([name, context]) => {
    const s = newest.get(context)
    if (!s) return { name, met: false, detail: `no ${context} status on the commit` }
    if (s.state !== 'success') return { name, met: false, detail: `${context} is ${s.state}` }
    if (!s.target_url) return { name, met: false, detail: `${context} is success but names no evidence (target_url)` }
    return { name, met: true, detail: `${context} success: ${s.target_url}` }
  })
}

/**
 * The launch smoke. builds: the green Test builds runs listed for the commit; smokes: green gate-smoke runs, each
 * with its jobs. A smoke counts for a build when its title names that run ("Test builds <id>"), and a job counts
 * when it is green and names the commit's short sha (the smoked artifact's).
 */
export const checkSmoke = (sha, builds, smokes) => {
  const ids = builds
    .filter((r) => r.head_sha === sha && OWN_COMMIT_EVENTS.includes(r.event) && r.conclusion === 'success')
    .map((r) => String(r.id))
  if (!ids.length)
    return { name: 'launch smoke', met: false, detail: `no green Test builds run built from ${sha.slice(0, 8)} (push or dispatch)` }
  const short = sha.slice(0, 8)
  const runs = smokes.filter(
    (s) => s.conclusion === 'success' && ids.some((id) => new RegExp(`\\bTest builds ${id}\\b`).test(s.display_title ?? ''))
  )
  const found = SMOKE_JOBS.map(([platform, re]) => {
    const job = runs
      .flatMap((s) => s.jobs.map((j) => ({ ...j, run: s.id })))
      .find((j) => re.test(j.name) && j.conclusion === 'success' && j.name.endsWith(`· ${short}`))
    return [platform, job]
  })
  const missing = found.filter(([, job]) => !job).map(([platform]) => platform)
  if (missing.length)
    return {
      name: 'launch smoke',
      met: false,
      detail: `no green ${missing.join(' or ')} smoke of Test builds ${ids.join(', ')} (gate-smoke.yml -f run-id=<id>)`,
    }
  return {
    name: 'launch smoke',
    met: true,
    detail: found.map(([platform, job]) => `${platform} in gate-smoke run ${job.run}`).join(', '),
  }
}

const gh = (...args) => JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
const ghApi = (route) => gh(route)
// Every page of a list (--paginate --slurp: an array of pages): the gate-smoke list has no sha to filter on, so a
// first page alone would stop finding an older commit's smoke once 100 newer ones were green.
const ghPages = (route) => gh('--paginate', '--slurp', route)

/**
 * Every condition for the commit, read from GitHub. A read that fails is a condition not met, never a pass. api reads
 * one page; pages reads every page of a list (by default, from an api given in its place: that one page).
 */
export const proveStrict = ({ sha, repo, api = ghApi, pages = api === ghApi ? ghPages : (route) => [api(route)] }) => {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) return [{ name: 'commit', met: false, detail: `not a full sha: '${sha}'` }]
  if (!repo) return [{ name: 'repository', met: false, detail: 'no repository (--repo or GITHUB_REPOSITORY)' }]
  const read = (name, fn) => {
    try {
      return fn()
    } catch (error) {
      return [{ name, met: false, detail: `could not read: ${String(error.message).split('\n')[0]}` }]
    }
  }
  const statuses = read('attested checks', () => checkStatuses(api(`repos/${repo}/commits/${sha}/statuses?per_page=100`)))
  const smoke = read('launch smoke', () => {
    const builds = api(`repos/${repo}/actions/workflows/test-builds.yml/runs?head_sha=${sha}&status=success&per_page=100`).workflow_runs
    const ids = builds.map((r) => String(r.id))
    // Jobs only for the smokes whose title names one of those builds; checkSmoke applies every rule again.
    const smokes = pages(`repos/${repo}/actions/workflows/gate-smoke.yml/runs?status=success&per_page=100`)
      .flatMap((page) => page.workflow_runs)
      .filter((s) => ids.some((id) => (s.display_title ?? '').includes(`Test builds ${id}`)))
      .map((s) => ({ ...s, jobs: api(`repos/${repo}/actions/runs/${s.id}/jobs?per_page=100`).jobs }))
    return [checkSmoke(sha, builds, smokes)]
  })
  return [...smoke, ...statuses]
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { sha: { type: 'string' }, repo: { type: 'string' } } })
  const conditions = proveStrict({ sha: values.sha, repo: values.repo ?? process.env.GITHUB_REPOSITORY })
  for (const c of conditions) console.log(`${c.met ? 'met    ' : 'MISSING'} ${c.name}: ${c.detail}`)
  process.exitCode = conditions.every((c) => c.met) ? 0 : 1
}
