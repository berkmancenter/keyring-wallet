// node --test scripts/ota/
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { check, decide, MAX_AGE_MS, NOT_BRAKED } from './brake-watchdog.mjs'
import { PASSING_VERDICTS } from './post-release.mjs'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
const read = (...p) => readFileSync(path.join(root, ...p), 'utf8')
const BUNDLES = [
  { platform: 'ios', id: '01a1c166-191f-781d-ab0d-3b9bcb4fdc6c', channel: 'production' },
  { platform: 'android', id: '01a1c15b-9d7d-75ed-a5c4-1288a272e412', channel: 'production' },
]

// The decision. A red verdict brakes unless the run's own Brake job ran; nothing else ever brakes.
test('smoke-red with NO Brake job in the run (278.9, 11-09): brake', () => {
  assert.equal(decide({ verdict: 'smoke-red', brakeJobs: [] }).action, 'brake')
})

test('smoke-red with a Brake job that was skipped or cancelled: brake', () => {
  assert.equal(decide({ verdict: 'smoke-red', brakeJobs: [{ status: 'completed', conclusion: 'skipped' }] }).action, 'brake')
  assert.equal(decide({ verdict: 'smoke-red', brakeJobs: [{ status: 'completed', conclusion: 'cancelled' }] }).action, 'brake')
})

test('smoke-red whose own Brake job ran to success: nothing (no second re-run, no second withdraw)', () => {
  assert.equal(decide({ verdict: 'smoke-red', brakeJobs: [{ status: 'completed', conclusion: 'success' }] }).action, 'none')
})

test('smoke-red whose Brake job ran and failed: an alert for a person, never a second automatic brake', () => {
  const d = decide({ verdict: 'smoke-red', brakeJobs: [{ status: 'completed', conclusion: 'failure' }] })
  assert.equal(d.action, 'alert')
  assert.match(d.why, /may still be live/)
})

// The controls: no verdict but smoke-red ever brakes, with or without a Brake job; and "nothing to do", this
// watchdog's permissive answer, is given only for the verdicts post-release.mjs itself passes on.
const SKIPPED_BRAKE = [[], [{ status: 'completed', conclusion: 'skipped' }]]
for (const verdict of ['green', 'none']) {
  test(`control: verdict ${verdict} (a passing verdict) never brakes and needs nothing`, () => {
    for (const brakeJobs of SKIPPED_BRAKE) assert.equal(decide({ verdict, brakeJobs }).action, 'none')
  })
}

test('smoke-incomplete is an alert, not a quiet nothing: the smoke never finished, so nobody verified the release', () => {
  for (const brakeJobs of SKIPPED_BRAKE) {
    const d = decide({ verdict: 'smoke-incomplete', brakeJobs })
    assert.equal(d.action, 'alert')
    assert.match(d.why, /nobody verified this release/)
    assert.match(d.why, /Nothing was withdrawn/)
  }
})

test('builds-red is an alert, never a brake: the released commit was never smoked, and the brake does not act on builds', () => {
  for (const brakeJobs of SKIPPED_BRAKE) {
    const d = decide({ verdict: 'builds-red', brakeJobs })
    assert.equal(d.action, 'alert')
    assert.match(d.why, /never smoked/)
  }
})

test('a verdict this watchdog has never heard of is an alert that names it, never nothing and never a brake', () => {
  const d = decide({ verdict: 'smoke-purple', brakeJobs: [] })
  assert.equal(d.action, 'alert')
  assert.match(d.why, /verdict smoke-purple: a verdict this watchdog does not know/)
})

test('only none and green pass, one list for both: post-release.mjs exits 0 on PASSING_VERDICTS and decide() reads the same', () => {
  assert.deepEqual([...PASSING_VERDICTS], ['none', 'green'])
  assert.match(read('scripts', 'ota', 'post-release.mjs'), /process\.exitCode = PASSING_VERDICTS\.includes\(r\.verdict\) \? 0 : 2\n/)
})

// Every verdict post-release.mjs can write, read from its source, so a new one there forces a decision here.
const verdictsInPostRelease = () => {
  const src = read('scripts', 'ota', 'post-release.mjs')
  const found = new Set([...src.matchAll(/verdict: '([a-z-]+)'/g)].map((m) => m[1]))
  const named = src.split('\n').find((l) => /const name = verdict\.green \?/.test(l)) ?? ''
  for (const m of named.matchAll(/'([a-z-]+)'/g)) found.add(m[1])
  return found
}

test('the scan of post-release.mjs finds its verdicts (so the next row cannot pass on an empty list)', () => {
  assert.deepEqual([...verdictsInPostRelease()].sort(), ['builds-red', 'green', 'none', 'smoke-incomplete', 'smoke-red'])
})

test('every verdict post-release.mjs writes is decided here: passing is nothing, smoke-red brakes, any other alerts with a written reason', () => {
  for (const verdict of verdictsInPostRelease()) {
    const d = decide({ verdict, brakeJobs: [] })
    if (PASSING_VERDICTS.includes(verdict)) assert.equal(d.action, 'none', verdict)
    else if (verdict === 'smoke-red') assert.equal(d.action, 'brake', verdict)
    else {
      assert.equal(d.action, 'alert', verdict)
      assert.ok(NOT_BRAKED[verdict], `${verdict} has no reason in NOT_BRAKED`)
    }
  }
})

test('an unreadable verdict is an alert, never a brake and never a quiet nothing', () => {
  assert.equal(decide({ verdict: undefined, brakeJobs: [] }).action, 'alert')
  assert.match(decide({ verdict: undefined, brakeJobs: [], runConclusion: 'failure' }).why, /no readable verdict/)
})

test('a post-release run cancelled or timed out before its verdict says so: nobody checked, not "unreadable"', () => {
  for (const runConclusion of ['cancelled', 'timed_out']) {
    const d = decide({ verdict: undefined, brakeJobs: [], runConclusion })
    assert.equal(d.action, 'alert')
    assert.match(d.why, new RegExp(`ended ${runConclusion} before it wrote a verdict: nobody has checked this release`))
  }
})

test('a run older than six hours is not braked by itself: an alert', () => {
  assert.equal(decide({ verdict: 'smoke-red', brakeJobs: [], ageMs: MAX_AGE_MS + 1 }).action, 'alert')
  assert.equal(decide({ verdict: 'smoke-red', brakeJobs: [], ageMs: MAX_AGE_MS - 1 }).action, 'brake')
})

// check(): reading a real run's shape. The fake gh answers the run, its jobs and its artifacts; download writes a file.
const fakeRun = ({ verdict, jobs, path: wfPath = '.github/workflows/post-release.yml', updated = '2026-11-09T18:10:07Z', artifacts, platforms = ['ios', 'android'], conclusion = 'failure' }) => {
  const calls = []
  const gh = (...args) => {
    calls.push(args)
    const route = String(args[1])
    if (route.endsWith('/jobs?per_page=100')) return JSON.stringify({ jobs })
    if (route.endsWith('/artifacts?per_page=100'))
      return JSON.stringify({ artifacts: artifacts ?? [{ name: 'post-release-handoff-5d150fbb2270762cdfa4d493e55346726287c49c', expired: false }] })
    return JSON.stringify({ id: 42668414326, path: wfPath, updated_at: updated, conclusion })
  }
  const download = async ({ dir }) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'post-release-handoff.json'), JSON.stringify({ sha: '5d150fbb2270762cdfa4d493e55346726287c49c', verdict, bundles: BUNDLES, platforms, gateSmoke: 42668538128 }))
  }
  return { gh, download, calls }
}
const SMOKE_FAILED = { name: 'Post-release smoke · hotfix/278-ota-9', status: 'completed', conclusion: 'failure' }
const at = (iso) => () => Date.parse(iso)
const scratch = () => mkdtempSync(path.join(tmpdir(), 'watchdog-'))

test('check: the 278.9 run itself (smoke-red, the smoke job only) brakes, handing over its gate-smoke, bundles and platforms', async () => {
  const f = fakeRun({ verdict: 'smoke-red', jobs: [SMOKE_FAILED] })
  const r = await check({ run: '42668414326', repo: 'o/r', gh: f.gh, download: f.download, now: at('2026-11-09T18:12:00Z'), dir: scratch() })
  assert.equal(r.action, 'brake')
  assert.deepEqual([r.gateSmoke, r.bundles, r.platforms], [42668538128, BUNDLES, ['ios', 'android']])
})

test('check control: a smoke-red run whose Brake job succeeded does nothing', async () => {
  const f = fakeRun({ verdict: 'smoke-red', jobs: [SMOKE_FAILED, { name: 'Brake · hotfix/277-ota-12', status: 'completed', conclusion: 'success' }] })
  const r = await check({ run: '1', repo: 'o/r', gh: f.gh, download: f.download, now: at('2026-11-09T18:12:00Z'), dir: scratch() })
  assert.equal(r.action, 'none')
})

test('check control: a green run with its Brake job skipped does nothing', async () => {
  const f = fakeRun({ verdict: 'green', jobs: [{ ...SMOKE_FAILED, conclusion: 'success' }, { name: 'Brake · hotfix/278-ota-11', status: 'completed', conclusion: 'skipped' }] })
  const r = await check({ run: '1', repo: 'o/r', gh: f.gh, download: f.download, now: at('2026-11-09T18:12:00Z'), dir: scratch() })
  assert.equal(r.action, 'none')
})

test('check: no handoff artifact is an alert that names why', async () => {
  const f = fakeRun({ verdict: 'smoke-red', jobs: [SMOKE_FAILED], artifacts: [] })
  const r = await check({ run: '1', repo: 'o/r', gh: f.gh, download: f.download, now: at('2026-11-09T18:12:00Z'), dir: scratch() })
  assert.deepEqual([r.action, r.unreadable], ['alert', '0 post-release-handoff artifacts'])
})

test('check: a post-release run cancelled before its handoff alerts as cancelled, reading the run\'s own conclusion', async () => {
  const f = fakeRun({ verdict: 'smoke-red', jobs: [SMOKE_FAILED], artifacts: [], conclusion: 'cancelled' })
  const r = await check({ run: '1', repo: 'o/r', gh: f.gh, download: f.download, now: at('2026-11-09T18:12:00Z'), dir: scratch() })
  assert.equal(r.action, 'alert')
  assert.match(r.why, /ended cancelled before it wrote a verdict/)
})

test('check reads only the post-release-handoff-<sha> artifact, beside any other artifact of the run', async () => {
  const artifacts = [
    { name: 'post-release-handoff-5d150fbb2270762cdfa4d493e55346726287c49c', expired: false },
    { name: 'screen-check-handoff-notes', expired: false },
    { name: 'post-release-handoff-5d150fbb2270762cdfa4d493e55346726287c49c-old', expired: false },
  ]
  const f = fakeRun({ verdict: 'smoke-red', jobs: [SMOKE_FAILED], artifacts })
  const r = await check({ run: '1', repo: 'o/r', gh: f.gh, download: f.download, now: at('2026-11-09T18:12:00Z'), dir: scratch() })
  assert.deepEqual([r.action, r.unreadable], ['brake', undefined])
})

test('check: a handoff without platforms (written before this change) takes them from its bundles', async () => {
  const f = fakeRun({ verdict: 'smoke-red', jobs: [SMOKE_FAILED], platforms: null })
  const r = await check({ run: '1', repo: 'o/r', gh: f.gh, download: f.download, now: at('2026-11-09T18:12:00Z'), dir: scratch() })
  assert.deepEqual(r.platforms, ['ios', 'android'])
})

test('check refuses a run that is not a post-release run', async () => {
  const f = fakeRun({ verdict: 'smoke-red', jobs: [], path: '.github/workflows/ota-publish.yml' })
  await assert.rejects(check({ run: '1', repo: 'o/r', gh: f.gh, download: f.download, dir: scratch() }), /not a post-release run/)
})

test('check only reads: every gh call is a GET', async () => {
  const f = fakeRun({ verdict: 'smoke-red', jobs: [SMOKE_FAILED] })
  await check({ run: '1', repo: 'o/r', gh: f.gh, download: f.download, now: at('2026-11-09T18:12:00Z'), dir: scratch() })
  assert.ok(f.calls.length > 0)
  for (const c of f.calls) {
    assert.equal(c[0], 'api')
    assert.equal(c.slice(1).some((a) => /^(-X|--method|-f|-F|--field|--raw-field|--input)$/.test(a)), false)
  }
})

// The workflow: triggered by post-release by its real name, one job, withdraw only, the Brake job's own steps.
const watchdog = read('.github', 'workflows', 'brake-watchdog.yml')
const postRelease = read('.github', 'workflows', 'post-release.yml')
const code = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')

test('it follows post-release.yml by that file\'s own name, on completion', () => {
  const name = postRelease.match(/^name: (.+)$/m)[1]
  assert.match(watchdog, new RegExp(`workflows: \\["${name}"\\]`))
  assert.match(watchdog, /types: \[completed\]/)
})

test('one job only: no needs, since a needed job is the shape GitHub failed to create on 11-09', () => {
  const jobs = [...code(watchdog.slice(watchdog.indexOf('\njobs:'))).matchAll(/^ {2}([\w-]+):$/gm)].map((m) => m[1])
  assert.deepEqual(jobs, ['watchdog'])
  assert.doesNotMatch(code(watchdog), /\bneeds:/)
})

test('withdraw only: the ota environment, no approval gate, no signing key, nothing but the watchdog and the brake', () => {
  const c = code(watchdog)
  assert.match(c, /environment: ota\n/)
  assert.doesNotMatch(c, /ota-approval|SIGNING_KEY/)
  const runs = [...c.matchAll(/node (scripts\/[\w/.-]+\.mjs)(?: (\w+))?/g)].map((m) => `${m[1]} ${m[2] ?? ''}`.trim())
  assert.deepEqual([...new Set(runs)], ['scripts/ota/brake-watchdog.mjs check', 'scripts/ota/brake.mjs rerun', 'scripts/ota/brake.mjs withdraw'])
  assert.doesNotMatch(c, /ota-deploy|promote\.mjs|hot-updater (deploy|bundle update)|ota-publish\.yml|--target-cohorts/)
})

test('every brake step is gated on act, and the withdraw also on the re-run still being red', () => {
  const steps = code(watchdog).split(/\n {6}- /).slice(1)
  const brakeSteps = steps.filter((s) => !/^uses: actions\/(checkout|setup-node)@/.test(s) && !/name: Did the brake run\?/.test(s))
  assert.ok(brakeSteps.length >= 6)
  for (const s of brakeSteps) assert.match(s, /if: \$\{\{ steps\.check\.outputs\.act == 'true'/, s.split('\n')[0])
  assert.match(code(watchdog), /- name: Withdraw the release\n\s+if: \$\{\{ steps\.check\.outputs\.act == 'true' && steps\.rerun\.outputs\.still_red == 'true' \}\}\n/)
})

test('its brake steps are the Brake job\'s own, step for step (names and commands), so the two cannot drift', () => {
  const stepsOf = (yml) =>
    code(yml)
      .split(/\n {6}- /)
      .slice(1)
      .map((s) => ({ name: (s.match(/^name: (.+)$/m) ?? [])[1], run: (s.match(/run: (node .+|git .+)$/m) ?? [])[1] }))
      .filter((s) => s.name && s.name !== 'Did the brake run?')
  const brakeJob = postRelease.slice(postRelease.indexOf('\n  brake:'))
  assert.deepEqual(stepsOf(watchdog), stepsOf(brakeJob))
})

test('the watchdog reads every run that can hold a red: post-release exits non-zero on any verdict but none or green', () => {
  assert.match(watchdog, /if: \$\{\{ !contains\(fromJSON\('\["success","skipped"\]'\), github\.event\.workflow_run\.conclusion\) \}\}/)
  assert.match(read('scripts', 'ota', 'post-release.mjs'), /process\.exitCode = PASSING_VERDICTS\.includes\(r\.verdict\) \? 0 : 2\n/)
})

test('the in-run Brake job still acts on a failed smoke job: always(), or a red (which fails the job) would skip it', () => {
  assert.match(postRelease, /\n {2}brake:\n(?: {4}.*\n)*? {4}if: \$\{\{ always\(\) && needs\.smoke\.outputs\.verdict == 'smoke-red' \}\}\n/)
})

test('the handoff carries what the watchdog reads: verdict, bundles, platforms and gateSmoke', () => {
  const line = read('scripts', 'ota', 'post-release.mjs').split('\n').find((l) => l.includes("writeFileSync('post-release-handoff.json'"))
  for (const k of ['verdict: r.verdict', 'bundles: r.bundles', 'platforms: r.platforms', 'gateSmoke: r.gateSmoke']) assert.ok(line.includes(k), k)
})
