// node --test scripts/ota/
// The publisher's tier gate, end to end: copies of ota-deploy.mjs and the scripts it runs, in a throwaway repository
// whose one commit after the base is a strict, a plain ota or a store change, and a fake `gh` on PATH answering the
// proof's reads. A change that gets through the gate stops at the next check (no signing key), so nothing is built
// or published here.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
const COPIED = [
  'app/scripts/ota-deploy.mjs',
  'scripts/release/tier.mjs',
  'scripts/ota/strict-proof.mjs',
  'scripts/ota/check-fingerprint.mjs',
  'scripts/ota/fingerprint-report.mjs',
]
const dirs = []
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

// A fake gh: `gh api [--paginate --slurp] <route>` answers from FAKE_GH (met: the launch smoke proven; anything else:
// nothing on GitHub). --slurp wraps the answer as the one page of a list, as gh does.
const FAKE_GH = `#!/usr/bin/env node
const route = process.argv[process.argv.length - 1] || ''
const slurp = process.argv.includes('--slurp')
const sha = process.env.FAKE_SHA
const met = process.env.FAKE_GH === 'met'
const out = route.includes('test-builds.yml/runs')
    ? { workflow_runs: met ? [{ id: 101, head_sha: sha, event: 'workflow_dispatch', conclusion: 'success' }] : [] }
    : route.includes('gate-smoke.yml/runs')
      ? { workflow_runs: met ? [{ id: 201, display_title: 'Gate smoke · Test builds 101', conclusion: 'success' }] : [] }
      : route.includes('/runs/201/jobs')
        ? { jobs: ['iOS smoke (macos-26)', 'Android smoke (ubuntu-latest, KVM)'].map((n) => ({ name: n + ' · ' + sha.slice(0, 8), conclusion: 'success' })) }
        : null
if (out === null) { console.error('unexpected route ' + route); process.exit(1) }
console.log(JSON.stringify(slurp ? [out] : out))
`

/**
 * A repository at <base> plus one commit touching `file`; returns how to run the publisher in it. tier: a stand-in
 * tier.mjs that prints this verdict and exits with this code, for the outcomes a real change can't be made to give.
 */
const repoWith = (file, { tier } = {}) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ota-deploy-strict-'))
  dirs.push(dir)
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'user.name', 'test')
  git('config', 'commit.gpgsign', 'false')
  for (const f of COPIED) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true })
    cpSync(path.join(root, f), path.join(dir, f))
  }
  if (tier) {
    const stub = `console.log(${JSON.stringify(JSON.stringify({ reasons: {}, flags: [], held: [], strict: ['sign-in / key handling'], unchecked: [], ...tier.verdict }))}); process.exitCode = ${tier.exit}\n`
    writeFileSync(path.join(dir, 'scripts/release/tier.mjs'), stub)
  }
  git('add', '.')
  // ota-deploy reads HEAD:bifold; any commit id serves as the gitlink.
  git('update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},bifold`)
  mkdirSync(path.join(dir, 'bifold')) // as an uninitialised submodule is, so the tree reads clean
  git('commit', '-q', '-m', 'base')
  const base = git('rev-parse', 'HEAD')
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  writeFileSync(path.join(dir, file), 'export const x = 1\n')
  git('add', file)
  git('commit', '-q', '-m', 'change')
  const head = git('rev-parse', 'HEAD')
  const bin = path.join(dir, '.bin')
  mkdirSync(bin)
  writeFileSync(path.join(bin, 'gh'), FAKE_GH)
  chmodSync(path.join(bin, 'gh'), 0o755)
  // The fake gh lives in the repository, so it is untracked there: the publisher's clean-tree check must not see it.
  writeFileSync(path.join(dir, '.git', 'info', 'exclude'), '.bin/\n')
  return (gh, { githubSha = head } = {}) =>
    spawnSync('node', [path.join(dir, 'app/scripts/ota-deploy.mjs'), '--base', base, '--channel', 'production'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        FAKE_GH: gh,
        FAKE_SHA: head,
        GITHUB_SHA: githubSha,
        GITHUB_REPOSITORY: 'owner/repo',
        OTA_CHANNEL: '',
        OTA_SIGNING_KEY: path.join(dir, 'no-such-key.pem'),
      },
    })
}

const PASSED_THE_GATE = /no signing key at/

test('a strict change with no launch smoke is refused, naming it', () => {
  const r = repoWith('app/src/screens/SignIn.tsx')('none')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /tier ota-strict \(sign-in \/ key handling\)/)
  assert.match(r.stdout, /MISSING launch smoke/)
  assert.doesNotMatch(r.stdout, /targeted tests|sim check/)
  assert.match(r.stderr, /its launch smoke is not proven: nothing is published/)
  assert.doesNotMatch(r.stderr, PASSED_THE_GATE)
})

test('a strict change with its launch smoke proven passes the tier gate', () => {
  const r = repoWith('app/src/screens/SignIn.tsx')('met')
  assert.match(r.stdout, /met {5}launch smoke: iOS in gate-smoke run 201, Android in gate-smoke run 201/)
  assert.match(r.stderr, PASSED_THE_GATE)
})

test('a plain ota change passes without any proof, as before', () => {
  const r = repoWith('app/src/screens/Home.tsx')('none')
  assert.doesNotMatch(r.stdout, /ota-strict/)
  assert.match(r.stderr, PASSED_THE_GATE)
})

test('a store change is refused whatever is proven', () => {
  const r = repoWith('app/ios/Thing.m')('met')
  assert.match(r.stderr, /tier is "store" \(exit 2\): this change ships as a store build/)
})

test('a strict change proven for its commit is refused when the run checked out another commit', () => {
  const r = repoWith('app/src/screens/SignIn.tsx')('met', { githubSha: '2'.repeat(40) })
  assert.match(r.stderr, /a strict bundle is published only by ota-publish\.yml, from the commit it proves/)
  assert.doesNotMatch(r.stderr, PASSED_THE_GATE)
  const unset = repoWith('app/src/screens/SignIn.tsx')('met', { githubSha: '' })
  assert.match(unset.stderr, /GITHUB_SHA unset/)
})

test('only exit 5 with the verdict ota-strict takes the proof path; a tier error or a mismatch is refused', () => {
  // tier.mjs reports its own error as store, exit 3; nothing proven can turn that into a publish.
  const error = repoWith('app/src/screens/SignIn.tsx', { tier: { exit: 3, verdict: { tier: 'store', error: 'boom' } } })('met')
  assert.match(error.stderr, /tier is "store" \(exit 3\)/)
  for (const [exit, tier] of [[5, 'ota'], [0, 'ota-strict'], [4, 'ota-strict'], [3, 'ota-strict']]) {
    const r = repoWith('app/src/screens/SignIn.tsx', { tier: { exit, verdict: { tier } } })('met')
    assert.match(r.stderr, new RegExp(`tier is "${tier}" \\(exit ${exit}\\)`), `exit ${exit} ${tier}`)
    assert.doesNotMatch(r.stderr, PASSED_THE_GATE, `exit ${exit} ${tier}`)
  }
})
