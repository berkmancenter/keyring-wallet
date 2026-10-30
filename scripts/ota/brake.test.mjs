// node --test scripts/ota/
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { BRAKE_ACTIONS, brakeTargets, rerunAndJudge, withdrawAll } from './brake.mjs'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
const IOS = '01a188f1-3d6c-73b1-a062-aaa1c538e380'
const ANDROID = '01a188e9-7629-712f-b61f-e973e98fd623'
const BUNDLES = [
  { platform: 'ios', id: IOS, channel: 'production' },
  { platform: 'android', id: ANDROID, channel: 'production' },
]

test('the brake may only withdraw', () => {
  assert.deepEqual([...BRAKE_ACTIONS], ['withdraw'])
  assert.throws(() => BRAKE_ACTIONS.push('publish'))
})

test('it withdraws production and preview bundles of iOS and Android, and refuses anything else, by name', () => {
  const { ok, refused } = brakeTargets([
    ...BUNDLES,
    { platform: 'ios', id: IOS, channel: 'device-test' },
    { platform: 'web', id: ANDROID, channel: 'production' },
    { platform: 'ios', id: 'not-an-id', channel: 'production' },
  ])
  assert.deepEqual(ok, BUNDLES)
  assert.deepEqual(refused.map((r) => r.why), ['channel device-test', 'platform web', 'not a bundle id'])
  assert.deepEqual(brakeTargets('nonsense'), { ok: [], refused: [] })
})

test('withdrawAll calls withdraw once per bundle with its own channel and platform, and nothing else', () => {
  const calls = []
  const r = withdrawAll({ bundles: BUNDLES, withdraw: (t) => calls.push(t), log: () => {} })
  assert.deepEqual(calls, [
    { channel: 'production', platform: 'ios', bundleId: IOS },
    { channel: 'production', platform: 'android', bundleId: ANDROID },
  ])
  assert.equal(r.allWithdrawn, true)
})

test('a withdraw that fails, a refused bundle, or nothing to withdraw is not "all withdrawn"', () => {
  const failing = withdrawAll({ bundles: BUNDLES, withdraw: (t) => { if (t.platform === 'android') throw Object.assign(new Error('x'), { stderr: 'withdraw: is already disabled' }) }, log: () => {} })
  assert.deepEqual([failing.allWithdrawn, failing.results[1].why], [false, 'withdraw: is already disabled'])
  const seen = []
  const mixed = withdrawAll({ bundles: [...BUNDLES, { platform: 'ios', id: IOS, channel: 'device-test' }], withdraw: (t) => seen.push(t.channel), log: () => {} })
  // A refused bundle is never handed to withdraw.
  assert.deepEqual([mixed.allWithdrawn, seen], [false, ['production', 'production']])
  assert.equal(withdrawAll({ bundles: [], withdraw: () => {}, log: () => {} }).allWithdrawn, false)
})

/** A gate-smoke run that is red, then after one re-run either green or red again. */
const fakeSmoke = ({ firstGreen = false, rerunGreen }) => {
  const calls = []
  let attempt = 1
  let reads = 0
  const jobs = (green) => ({
    jobs: [
      { name: 'iOS smoke (macos-26) · cb36b83a', conclusion: 'success' },
      { name: 'Android smoke (ubuntu-latest, KVM) · cb36b83a', conclusion: green ? 'success' : 'failure' },
    ],
  })
  const gh = (...args) => {
    calls.push(args)
    if (args[0] === 'run' && args[1] === 'rerun') { attempt = 2; return '' }
    const route = args[1]
    if (route.endsWith('/jobs?per_page=100')) return JSON.stringify(jobs(attempt === 1 ? firstGreen : rerunGreen))
    reads++
    // The rerun attempt shows up, then completes on the next read.
    const status = attempt === 2 && reads % 2 === 0 ? 'completed' : attempt === 1 ? 'completed' : 'in_progress'
    return JSON.stringify({ id: 601, run_attempt: attempt, status })
  }
  return { gh, calls }
}
const judge = (gh) => rerunAndJudge({ gateSmoke: '601', repo: 'o/r', gh, sleep: async () => {}, log: () => {} })

test('a red smoke is re-run once; green on the re-run withdraws nothing', async () => {
  const { gh, calls } = fakeSmoke({ rerunGreen: true })
  const r = await judge(gh)
  assert.deepEqual([r.stillRed, r.rerun], [false, true])
  assert.equal(calls.filter((c) => c[0] === 'run' && c[1] === 'rerun').length, 1)
})

test('red again after the re-run: still red', async () => {
  const r = await judge(fakeSmoke({ rerunGreen: false }).gh)
  assert.deepEqual([r.stillRed, r.rows.find((x) => x.platform === 'android').conclusion], [true, 'failure'])
})

test('a smoke already green is not re-run', async () => {
  const { gh, calls } = fakeSmoke({ firstGreen: true })
  const r = await judge(gh)
  assert.deepEqual([r.stillRed, r.rerun], [false, false])
  assert.equal(calls.some((c) => c[0] === 'run'), false)
})

test('rerunAndJudge writes nothing but the one re-run: every other gh call is a read', async () => {
  const { gh, calls } = fakeSmoke({ rerunGreen: false })
  await judge(gh)
  const writes = calls.filter((c) => c[0] !== 'api' || c.slice(1).some((a) => /^(-X|--method|-f|-F|--field|--raw-field|--input)$/.test(a)))
  assert.deepEqual(writes, [['run', 'rerun', '601', '--failed', '-R', 'o/r']])
})

// The workflow itself: the brake job can withdraw and nothing else.
const workflow = readFileSync(path.join(root, '.github', 'workflows', 'post-release.yml'), 'utf8')
const brakeJob = workflow.slice(workflow.indexOf('\n  brake:'))
// What the job runs, without its comments (which may name what it never does).
const brakeCode = brakeJob.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')

test('the brake job: the ota environment, no approval gate, and never a signing key', () => {
  assert.match(brakeJob, /environment: ota\n/)
  assert.doesNotMatch(brakeCode, /ota-approval/)
  assert.doesNotMatch(brakeCode, /SIGNING_KEY/)
})

test('the brake job runs only the brake: no publish, promote, deploy or bundle update', () => {
  const runs = [...brakeCode.matchAll(/node (scripts\/[\w/.-]+\.mjs)(?: (\w+))?/g)].map((m) => `${m[1]} ${m[2] ?? ''}`.trim())
  assert.deepEqual([...new Set(runs)], ['scripts/ota/brake.mjs rerun', 'scripts/ota/brake.mjs withdraw'])
  assert.doesNotMatch(brakeCode, /ota-deploy|promote\.mjs|hot-updater (deploy|bundle update)|ota-publish\.yml|--target-cohorts/)
})

test('it acts only on a red post-release smoke, and withdraws only if the re-run is still red', () => {
  assert.match(brakeJob, /needs\.smoke\.outputs\.verdict == 'smoke-red'/)
  // The withdraw step itself is gated on the re-run, not only the install before it.
  assert.match(brakeCode, /- name: Withdraw the release\n\s+if: \$\{\{ steps\.rerun\.outputs\.still_red == 'true' \}\}\n/)
})

test('a published platform with no bundle id: the others are still withdrawn, and the result says partial', () => {
  const calls = []
  const r = withdrawAll({ bundles: [BUNDLES[1]], platforms: ['ios', 'android'], withdraw: (t) => calls.push(t.platform), log: () => {} })
  assert.deepEqual(calls, ['android'])
  assert.deepEqual([r.unidentified, r.allWithdrawn, r.partial], [['ios'], false, true])
  // Every published platform identified and withdrawn: complete, not partial.
  const all = withdrawAll({ bundles: BUNDLES, platforms: ['ios', 'android'], withdraw: () => {}, log: () => {} })
  assert.deepEqual([all.allWithdrawn, all.partial], [true, false])
  // Nothing identified: nothing withdrawn, not partial either.
  const none = withdrawAll({ bundles: [], platforms: ['ios', 'android'], withdraw: () => {}, log: () => {} })
  assert.deepEqual([none.allWithdrawn, none.partial, none.unidentified], [false, false, ['ios', 'android']])
})

test('a re-run that never completes is given up on with an error that says nothing was withdrawn', async () => {
  // The re-run starts but stays in progress for good.
  const calls = []
  const gh = (...args) => {
    calls.push(args)
    if (args[0] === 'run') return ''
    if (String(args[1]).endsWith('/jobs?per_page=100'))
      return JSON.stringify({ jobs: [{ name: 'iOS smoke (macos-26) · cb36b83a', conclusion: 'success' }, { name: 'Android smoke (ubuntu-latest, KVM) · cb36b83a', conclusion: 'failure' }] })
    const reran = calls.some((c) => c[0] === 'run')
    return JSON.stringify({ id: 601, run_attempt: reran ? 2 : 1, status: reran ? 'in_progress' : 'completed' })
  }
  await assert.rejects(
    rerunAndJudge({ gateSmoke: '601', repo: 'o/r', gh, sleep: async () => {}, pollMs: 60000, maxWaitMs: 45 * 60000, log: () => {} }),
    /the re-run of gate-smoke 601 did not complete in 45 min: NOTHING was withdrawn, and the release is still live/
  )
  assert.equal(calls.filter((c) => c[0] === 'run').length, 1)
})

test("the re-run judges only the platforms the release published", async () => {
  // Android red on both attempts, but only iOS was published: not still red, so nothing is withdrawn.
  const r = await rerunAndJudge({ gateSmoke: '601', repo: 'o/r', platforms: ['ios'], gh: fakeSmoke({ firstGreen: false, rerunGreen: false }).gh, sleep: async () => {}, log: () => {} })
  assert.equal(r.stillRed, false)
  // Both published: Android's red counts.
  const both = await rerunAndJudge({ gateSmoke: '601', repo: 'o/r', platforms: ['ios', 'android'], gh: fakeSmoke({ rerunGreen: false }).gh, sleep: async () => {}, log: () => {} })
  assert.equal(both.stillRed, true)
})

test('the brake job hands the re-run the platforms the release published', () => {
  assert.match(brakeCode, /brake\.mjs rerun --gate-smoke "\$GATE_SMOKE" --platforms "\$PLATFORMS"/)
})
