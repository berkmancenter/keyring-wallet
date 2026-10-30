#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * An artifact download that a passing GitHub outage doesn't fail at once. 10-30: 276.10's post-release could not
 * download either bundle record ("HTTP 503: Egress is over the account limit", GitHub's account limit on artifact
 * storage reads), and the release had no bundle ids for the brake. The owner asked for every such 503 to be retried
 * with backoff and named, so each one is reported and logged (~/.keyring-gate/github-egress-503.md, kept by the OTA
 * lane from these warnings).
 *
 *   node scripts/ci/download-artifact.mjs --run <run id> --name <artifact> --dir <dir> --where <label> [--repo owner/name]
 *
 * Tries at once, then after 30 s, 90 s and 270 s, but only for a failure that can pass (an HTTP 5xx, the egress
 * limit, a reset connection). A missing artifact, a 404 or a 403 fails at once. Each egress refusal prints a
 * `github-egress-503` warning (time, where, what) and a step-summary line. <dir> is emptied before each try, so pass
 * one only this download writes to: it must be an absolute path strictly inside $RUNNER_TEMP or $GITHUB_WORKSPACE
 * (in a workflow) or the system temp directory (elsewhere), and anything else is refused before anything is deleted.
 * Exit 0 when downloaded, 1 when not.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const EGRESS = /Egress is over the account limit/i
export const EGRESS_TITLE = 'github-egress-503'
// What can pass: an HTTP 5xx (a permanent 500 too, which then costs the four tries, about six and a half minutes,
// before it fails: a retry here is no evidence the failure was transient), the egress limit, and a dropped or
// unresolved connection. Not 429: rate limiting is its own thing, and this backoff is aimed at the egress 503.
const TRANSIENT = /Egress is over the account limit|HTTP 5\d\d|\b5\d\d (Server Error|Bad Gateway|Service Unavailable|Gateway Time-?out)\b|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|socket hang up/i
export const BACKOFF_MS = [30000, 90000, 270000]

/** All an error says: gh's stderr and the message, since either may carry the HTTP status. */
export const errorText = (error) => `${String(error?.stderr ?? '')}\n${String(error?.message ?? error)}`
export const isTransient = (error) => TRANSIENT.test(errorText(error))
export const isEgress = (error) => EGRESS.test(errorText(error))

/** The warning a workflow log turns into an annotation: one line, no newlines from the error. */
export const egressWarning = ({ at, where, what }) => `::warning title=${EGRESS_TITLE}::${at} ${where}: ${what}`.replace(/[\r\n]+/g, ' ')

/**
 * Runs read() until it returns, retrying a transient failure after each BACKOFF_MS wait. warn(line) gets each egress
 * refusal's warning. Rethrows the last error when the waits run out, or at once for a failure that can't pass.
 */
export async function withBackoff(read, { where, what, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), warn = console.log, log = console.log, backoff = BACKOFF_MS }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read()
    } catch (error) {
      if (isEgress(error)) warn(egressWarning({ at: new Date(now()).toISOString(), where, what }))
      if (!isTransient(error) || attempt >= backoff.length) throw error
      log(`${where}: ${what} failed (try ${attempt + 1}); trying again in ${backoff[attempt] / 1000} s`)
      await sleep(backoff[attempt])
    }
  }
}

/**
 * Why <dir> may not be emptied, or undefined when it may: it must be absolute and strictly inside one of the roots
 * ($RUNNER_TEMP and $GITHUB_WORKSPACE when either is set, else the system temp directory). The one place this script
 * is pedantic, since it deletes recursively: "$RUNNER_TEMP/build" with RUNNER_TEMP unset would otherwise be /build.
 */
export const unsafeDir = (dir, env = process.env) => {
  if (!dir || !path.isAbsolute(dir)) return `--dir must be an absolute path (got "${dir ?? ''}")`
  const roots = [env.RUNNER_TEMP, env.GITHUB_WORKSPACE].filter(Boolean)
  const allowed = roots.length ? roots : [tmpdir()]
  const inside = allowed.some((root) => {
    const rel = path.relative(path.resolve(root), path.resolve(dir))
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
  })
  return inside ? undefined : `--dir ${dir} is not inside ${allowed.join(' or ')}: refusing to empty it`
}

const realGh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

export async function downloadArtifact({ repo, run, name, dir, where, gh = realGh, env = process.env, ...rest }) {
  const unsafe = unsafeDir(dir, env)
  if (unsafe) throw new Error(unsafe)
  return withBackoff(
    () => {
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
      gh('run', 'download', String(run), '-R', repo, '-n', name, '-D', dir)
    },
    { where, what: `artifact ${name} of run ${run}`, ...rest }
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { run: { type: 'string' }, name: { type: 'string' }, dir: { type: 'string' }, where: { type: 'string' }, repo: { type: 'string' } } })
  const repo = values.repo ?? process.env.GITHUB_REPOSITORY
  const summary = (line) => process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${line}\n`)
  try {
    if (!/^\d+$/.test(values.run ?? '') || !values.name || !values.dir || !repo) throw new Error('usage: download-artifact.mjs --run <id> --name <artifact> --dir <dir> --where <label> [--repo owner/name]')
    const where = values.where ?? `${process.env.GITHUB_WORKFLOW ?? 'local'} / ${process.env.GITHUB_JOB ?? '-'}`
    await downloadArtifact({
      repo, run: values.run, name: values.name, dir: values.dir, where,
      warn: (line) => {
        console.log(line)
        summary(`GitHub egress limit: ${line.replace(/^::warning title=[^:]+::/, '')}`)
      },
    })
    console.log(`${where}: downloaded ${values.name} of run ${values.run}`)
  } catch (error) {
    console.error(`download-artifact: ${errorText(error).split('\n').map((l) => l.trim()).find(Boolean)}`)
    process.exitCode = 1
  }
}
