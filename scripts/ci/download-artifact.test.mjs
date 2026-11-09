// node --test scripts/ci/download-artifact.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { BACKOFF_MS, downloadArtifact, EGRESS_TITLE, egressWarning, isTransient, unsafeDir, withBackoff } from './download-artifact.mjs'

/** A failed gh call as execFileSync throws it: the message names the command, stderr carries gh's own line. */
const ghFailure = (stderr) => Object.assign(new Error('Command failed: gh run download 41113292153 …'), { stderr: `${stderr}\n` })
// The 276.10 post-release's own line, 10-30.
const EGRESS = 'error downloading ota-bundle-ios: HTTP 503: 503 Egress is over the account limit. (https://productionresultssa2.blob.core.windows.net/…)'
const AT = Date.parse('2026-10-30T20:24:43Z')

const harness = (failures) => {
  const slept = []
  const warned = []
  let calls = 0
  const read = () => {
    calls++
    const f = failures.shift()
    if (f) throw f
    return 'done'
  }
  const opts = { where: 'post-release', what: 'artifact ota-bundle-ios of run 41113292153', sleep: async (ms) => { slept.push(ms) }, now: () => AT, warn: (l) => warned.push(l), log: () => {} }
  return { read, opts, slept, warned, calls: () => calls }
}

test('an egress refusal is named as a warning, waited out, and the download tried again', async () => {
  const h = harness([ghFailure(EGRESS)])
  assert.equal(await withBackoff(h.read, h.opts), 'done')
  assert.equal(h.calls(), 2)
  assert.deepEqual(h.slept, [30000])
  assert.deepEqual(h.warned, [`::warning title=${EGRESS_TITLE}::2026-10-30T20:24:43.000Z post-release: artifact ota-bundle-ios of run 41113292153`])
})

test('control: a missing artifact or a refused token fails at once, with no wait and no egress warning', async () => {
  for (const stderr of ['no artifact matches any of the names or patterns provided', 'gh: Not Found (HTTP 404)', 'gh: Resource not accessible by integration (HTTP 403)']) {
    const h = harness([ghFailure(stderr)])
    await assert.rejects(withBackoff(h.read, h.opts))
    assert.deepEqual([h.calls(), h.slept, h.warned], [1, [], []], stderr)
  }
})

test('another 5xx is retried with the same backoff, but is not called an egress refusal', async () => {
  const h = harness([ghFailure('gh: HTTP 503'), ghFailure('HTTP 502: Server Error (https://api.github.com/…)')])
  assert.equal(await withBackoff(h.read, h.opts), 'done')
  assert.deepEqual([h.calls(), h.slept, h.warned], [3, [30000, 90000], []])
})

test('the waits run out after 30 s, 90 s and 270 s: four tries, each egress refusal named, then the last error', async () => {
  const h = harness([1, 2, 3, 4].map(() => ghFailure(EGRESS)))
  await assert.rejects(withBackoff(h.read, h.opts), /Command failed/)
  assert.deepEqual(BACKOFF_MS, [30000, 90000, 270000])
  assert.deepEqual([h.calls(), h.slept, h.warned.length], [4, [30000, 90000, 270000], 4])
})

test('what can pass and what cannot', () => {
  assert.equal(isTransient(ghFailure(EGRESS)), true)
  assert.equal(isTransient(ghFailure('gh: HTTP 500')), true)
  assert.equal(isTransient(new Error('read ECONNRESET')), true)
  assert.equal(isTransient(new Error('getaddrinfo EAI_AGAIN api.github.com')), true)
  assert.equal(isTransient(ghFailure('gh: API rate limit exceeded (HTTP 429)')), false)
  assert.equal(isTransient(ghFailure('gh: Not Found (HTTP 404)')), false)
  assert.equal(isTransient(new Error('ENOSPC: no space left on device')), false)
})

test('a warning is one line, whatever the error carried', () => {
  assert.equal(egressWarning({ at: 'T', where: 'gate-smoke ios', what: 'a\nb\r\nc' }), `::warning title=${EGRESS_TITLE}::T gate-smoke ios: a b c`)
})

test('each try starts from an empty directory, so a half-written download never mixes with the next', async () => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'dl-')), 'build')
  mkdirSync(dir)
  writeFileSync(path.join(dir, 'stale.zip'), 'old')
  const seen = []
  let tries = 0
  const gh = (...args) => {
    const d = args[args.indexOf('-D') + 1]
    seen.push(readdirSync(d))
    if (tries++ === 0) {
      writeFileSync(path.join(d, 'partial.zip'), 'half')
      throw ghFailure(EGRESS)
    }
    writeFileSync(path.join(d, 'app.zip'), 'whole')
  }
  await downloadArtifact({ repo: 'owner/repo', run: 41102899638, name: 'keyring-ios-sim', dir, where: 'gate-smoke ios', gh, env: {}, sleep: async () => {}, warn: () => {}, log: () => {} })
  assert.deepEqual(seen, [[], []])
  assert.deepEqual(readdirSync(dir), ['app.zip'])
})

test('the command line refuses a call without a run, name or directory, and exits 1', () => {
  const cli = fileURLToPath(new URL('./download-artifact.mjs', import.meta.url))
  let status = 0
  let stderr = ''
  try {
    execFileSync(process.execPath, [cli, '--name', 'x'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GITHUB_REPOSITORY: 'owner/repo' } })
  } catch (error) {
    status = error.status
    stderr = String(error.stderr)
  }
  assert.equal(status, 1)
  assert.match(stderr, /usage: download-artifact\.mjs/)
  assert.equal(existsSync('x'), false)
})

test('a directory outside the runner\'s temp and workspace, relative, or a root itself is refused, and nothing is deleted', async () => {
  const runnerTemp = mkdtempSync(path.join(tmpdir(), 'runner-temp-'))
  const elsewhere = mkdtempSync(path.join(tmpdir(), 'elsewhere-'))
  writeFileSync(path.join(elsewhere, 'keep.txt'), 'mine')
  const env = { RUNNER_TEMP: runnerTemp }
  // "$RUNNER_TEMP/build" with RUNNER_TEMP unset.
  assert.match(unsafeDir('/build', env), /not inside/)
  assert.match(unsafeDir('build', env), /absolute/)
  assert.match(unsafeDir('', env), /absolute/)
  assert.match(unsafeDir(runnerTemp, env), /not inside/)
  assert.match(unsafeDir(path.join(runnerTemp, '..', 'x'), env), /not inside/)
  assert.equal(unsafeDir(path.join(runnerTemp, 'build'), env), undefined)
  assert.equal(unsafeDir(path.join(runnerTemp, 'build'), { GITHUB_WORKSPACE: elsewhere, RUNNER_TEMP: runnerTemp }), undefined)
  let calls = 0
  await assert.rejects(
    downloadArtifact({ repo: 'owner/repo', run: 1, name: 'x', dir: elsewhere, where: 'test', env, gh: () => { calls++ }, sleep: async () => {}, warn: () => {}, log: () => {} }),
    /refusing to empty it/
  )
  assert.deepEqual([calls, readdirSync(elsewhere)], [0, ['keep.txt']])
})
