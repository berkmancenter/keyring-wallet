// node --test scripts/ota/
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { baseOf, bundlesFromLog, pickDispatched, postRelease, publishedJobs, screensOf, smokeVerdict } from './post-release.mjs'

const SHA = 'cb36b83a1e0b6a67fb0e8fd32b6b95dd88d9ac3f'
const PREV = 'a'.repeat(40)
const REF = 'hotfix/276-ota-1'
const R = 'owner/repo'
const step = (name, conclusion) => ({ name, conclusion })
const publishJob = (platform, published = true) => ({
  id: platform === 'ios' ? 11 : 12,
  name: `publish (${platform})`,
  steps: [step('Publish to ring 0', published ? 'success' : 'skipped'), step('Dry run', published ? 'skipped' : 'success')],
})
const LOG = (platform, id) =>
  `2026-10-29T19:50:00Z ota-deploy: ${platform} fingerprint abc is the target build's\n` +
  `2026-10-29T19:50:01Z ota-deploy: ${platform} bundle ${id} is on ring0 (channel production)\n`
const IOS = '01a188f1-3d6c-73b1-a062-aaa1c538e380'
const ANDROID = '01a188e9-7629-712f-b61f-e973e98fd623'

test('a publish run published the platforms whose "Publish to ring 0" step succeeded; a dry run published none', () => {
  assert.deepEqual(publishedJobs([publishJob('ios'), publishJob('android')]).map((j) => j.platform), ['ios', 'android'])
  assert.deepEqual(publishedJobs([publishJob('ios', false), publishJob('android', false)]), [])
  // A promote or withdraw run has the step skipped, and the approve job has no steps of that name.
  assert.deepEqual(publishedJobs([{ id: 1, name: 'approve', steps: [] }, { id: 2, name: 'publish (both)', steps: [step('Promote (production)', 'success')] }]), [])
  assert.deepEqual(publishedJobs([{ ...publishJob('ios'), steps: [step('Publish to ring 0', 'failure')] }]), [])
})

test("bundle ids come from ota-deploy's own lines, with platform and channel", () => {
  assert.deepEqual(bundlesFromLog(LOG('ios', IOS) + LOG('android', ANDROID)), [
    { platform: 'ios', id: IOS, channel: 'production' },
    { platform: 'android', id: ANDROID, channel: 'production' },
  ])
  assert.deepEqual(bundlesFromLog('ota-deploy: ios fingerprint abc is the target build\'s'), [])
})

test('the dispatched run: on the sha, by dispatch, at or after the ask', () => {
  const since = Date.parse('2026-10-29T20:00:00Z')
  const run = (id, over) => ({ id, event: 'workflow_dispatch', head_sha: SHA, created_at: '2026-10-29T20:00:10Z', ...over })
  const others = [run(1, { created_at: '2026-10-29T19:59:00Z' }), run(3, { head_sha: 'f'.repeat(40) }), run(4, { event: 'push' })]
  assert.equal(pickDispatched([...others, run(2)], { sha: SHA, since }).id, 2)
  assert.equal(pickDispatched(others, { sha: SHA, since }), undefined)
  // gate-smoke: the run titled for the Test builds run it smokes; one for another build doesn't count.
  const smokes = [run(7, { display_title: 'Gate smoke · Test builds 5010' }), run(8, { display_title: 'Gate smoke · Test builds 501' })]
  assert.equal(pickDispatched(smokes, { title: 'Test builds 501', since }).id, 8)
})

test('two matching runs are refused, naming both, never resolved by taking the newest', () => {
  // A manual Android-only gate-smoke of the same build, dispatched in the same minute: taking it would read red.
  const since = Date.parse('2026-10-29T20:00:00Z')
  const run = (id, at) => ({ id, event: 'workflow_dispatch', head_sha: SHA, display_title: 'Gate smoke · Test builds 501', created_at: at })
  assert.throws(() => pickDispatched([run(601, '2026-10-29T20:00:05Z'), run(602, '2026-10-29T20:00:20Z')], { title: 'Test builds 501', since }), /more than one run matches \(601, 602\): refusing to pick one/)
  assert.throws(() => pickDispatched([run(501, '2026-10-29T20:00:05Z'), run(502, '2026-10-29T20:00:06Z')], { sha: SHA, since }), /refusing/)
})

test('the smoke is green only with both platform jobs green; skipped or missing is not', () => {
  const job = (name, conclusion) => ({ name, conclusion })
  assert.equal(smokeVerdict([job('Which build', 'success'), job('iOS smoke (macos-26) · cb36b83a', 'success'), job('Android smoke (ubuntu-latest, KVM) · cb36b83a', 'success')]).green, true)
  assert.equal(smokeVerdict([job('iOS smoke (macos-26) · cb36b83a', 'success'), job('Android smoke (ubuntu-latest, KVM) · cb36b83a', 'failure')]).green, false)
  assert.equal(smokeVerdict([job('iOS smoke (macos-26) · cb36b83a', 'success'), job('Android smoke (ubuntu-latest, KVM) · cb36b83a', 'skipped')]).green, false)
  assert.equal(smokeVerdict([job('iOS smoke (macos-26) · cb36b83a', 'success')]).green, false)
})

/** A fake gh over a scripted GitHub: two runs it dispatches, each completing on the second read. */
const fakeGh = ({ publishJobs, builds = 'success', smokeJobs }) => {
  const calls = []
  const reads = {}
  const dispatched = {}
  const gh = (...args) => {
    calls.push(args)
    if (args[0] === 'workflow') {
      const wf = args[2]
      const id = wf === 'test-builds.yml' ? 501 : 601
      const title = wf === 'gate-smoke.yml' ? `Gate smoke · Test builds ${args.find((a) => a.startsWith('run-id=')).slice(7)}` : 'Test builds'
      dispatched[wf] = { id, event: 'workflow_dispatch', head_sha: SHA, display_title: title, created_at: new Date(1e12).toISOString(), status: 'queued' }
      return ''
    }
    const route = args[1]
    const j = (o) => JSON.stringify(o)
    if (route === `repos/${R}/actions/runs/900`) return j({ id: 900, head_sha: SHA, head_branch: REF })
    if (route.startsWith(`repos/${R}/actions/runs/900/jobs`)) return j({ jobs: publishJobs })
    if (route === `repos/${R}/actions/jobs/11/logs`) return LOG('ios', IOS)
    if (route === `repos/${R}/actions/jobs/12/logs`) return LOG('android', ANDROID)
    if (route.startsWith(`repos/${R}/actions/workflows/ota-publish.yml/runs`))
      return j({ workflow_runs: [{ id: 900, head_sha: SHA }, { id: 800, head_sha: PREV }, { id: 700, head_sha: 'd'.repeat(40) }] })
    if (route.startsWith(`repos/${R}/actions/runs/800/jobs`)) return j({ jobs: [publishJob('ios'), publishJob('android')] })
    if (route.startsWith(`repos/${R}/actions/runs/700/jobs`)) return j({ jobs: [publishJob('ios', false)] })
    const list = /actions\/workflows\/([\w.-]+)\/runs/.exec(route)
    if (list) return j({ workflow_runs: dispatched[list[1]] ? [dispatched[list[1]]] : [] })
    const one = /actions\/runs\/(\d+)$/.exec(route)
    if (one) {
      reads[one[1]] = (reads[one[1]] ?? 0) + 1
      const id = Number(one[1])
      return j({ id, status: reads[one[1]] > 1 ? 'completed' : 'in_progress', conclusion: id === 501 ? builds : 'success' })
    }
    if (route.startsWith(`repos/${R}/actions/runs/601/jobs`)) return j({ jobs: smokeJobs })
    throw new Error(`unexpected ${args.join(' ')}`)
  }
  return { gh, calls }
}
const GREEN = [{ name: 'iOS smoke (macos-26) · cb36b83a', conclusion: 'success' }, { name: 'Android smoke (ubuntu-latest, KVM) · cb36b83a', conclusion: 'success' }]
const opts = (gh, more = {}) => ({
  publishRun: '900', repo: R, gh, sleep: async () => {}, now: () => 1e12, log: () => {},
  isAncestor: () => true, describe: () => 'staging-v0.2.0-276', listChanged: () => [], ...more,
})

test('a publish: Test builds on the released branch, then gate-smoke on that run; green', async () => {
  const { gh, calls } = fakeGh({ publishJobs: [publishJob('ios'), publishJob('android')], smokeJobs: GREEN })
  const r = await postRelease(opts(gh))
  assert.deepEqual([r.verdict, r.sha, r.ref, r.testBuilds, r.gateSmoke], ['green', SHA, REF, 501, 601])
  assert.deepEqual(r.bundles.map((b) => b.id), [IOS, ANDROID])
  const runs = calls.filter((c) => c[0] === 'workflow')
  assert.deepEqual(runs.map((c) => [c[2], c[c.indexOf('--ref') + 1]]), [['test-builds.yml', REF], ['gate-smoke.yml', REF]])
  assert.ok(runs[1].includes('run-id=501'), 'gate-smoke smokes the run it just built')
})

test('a red smoke is reported as smoke-red, with the rows', async () => {
  const red = [GREEN[0], { ...GREEN[1], conclusion: 'failure' }]
  const r = await postRelease(opts(fakeGh({ publishJobs: [publishJob('ios'), publishJob('android')], smokeJobs: red }).gh))
  assert.equal(r.verdict, 'smoke-red')
  assert.deepEqual(r.rows, [{ platform: 'ios', conclusion: 'success' }, { platform: 'android', conclusion: 'failure' }])
})

test('red Test builds: no smoke is dispatched', async () => {
  const { gh, calls } = fakeGh({ publishJobs: [publishJob('ios')], builds: 'failure', smokeJobs: GREEN })
  const r = await postRelease(opts(gh))
  assert.equal(r.verdict, 'builds-red')
  assert.equal(calls.some((c) => c[0] === 'workflow' && c[2] === 'gate-smoke.yml'), false)
})

test('a run that published nothing dispatches nothing', async () => {
  const { gh, calls } = fakeGh({ publishJobs: [publishJob('ios', false), publishJob('android', false)], smokeJobs: GREEN })
  const r = await postRelease(opts(gh))
  assert.equal(r.verdict, 'none')
  assert.equal(calls.some((c) => c[0] === 'workflow'), false)
})

test('it only ever dispatches Test builds and gate-smoke: never a publish, promote or withdraw', async () => {
  const { gh, calls } = fakeGh({ publishJobs: [publishJob('ios'), publishJob('android')], smokeJobs: GREEN })
  await postRelease(opts(gh))
  const workflows = calls.filter((c) => c[0] === 'workflow').map((c) => [c[1], c[2]])
  assert.deepEqual(workflows, [['run', 'test-builds.yml'], ['run', 'gate-smoke.yml']])
  // Every other call is a read: gh api with a route only, no method, no field, no body.
  const writes = calls.filter((c) => c[0] === 'api' && c.slice(1).some((a) => /^(-X|--method|-f|-F|--field|--raw-field|--input)$/.test(a)))
  assert.deepEqual(writes, [])
  // And nothing it dispatches is a publish, promote or withdraw: ota-publish.yml is only ever listed, never run.
  assert.equal(calls.some((c) => c[0] === 'workflow' && /ota-publish/.test(c[2])), false)
})

test('the changed screens: .tsx screens and components in the app and bifold, never tests', () => {
  assert.deepEqual(
    screensOf([
      'bifold/packages/core/src/modules/rooms/screens/Room.tsx',
      'bifold/packages/core/src/modules/rooms/components/RoomNoteEditor.tsx',
      'bifold/packages/core/src/modules/rooms/__tests__/Room.test.tsx',
      'bifold/packages/core/src/modules/rooms/useRoomPosts.ts',
      'app/src/screens/Home.tsx',
      'bifold/packages/core/src/modules/rooms/components/roomsStatusText.ts',
      'e2e/lib/testids.json',
    ]),
    ['bifold/packages/core/src/modules/rooms/screens/Room.tsx', 'bifold/packages/core/src/modules/rooms/components/RoomNoteEditor.tsx', 'app/src/screens/Home.tsx']
  )
})

test('measured from the newest earlier publish that is an ancestor, else the store build tag', () => {
  const describe = () => 'staging-v0.2.0-276'
  assert.equal(baseOf({ sha: SHA, earlier: ['x'.repeat(40), PREV], isAncestor: (a) => a === PREV, describe }), PREV)
  assert.equal(baseOf({ sha: SHA, earlier: ['x'.repeat(40)], isAncestor: () => false, describe }), 'staging-v0.2.0-276')
  assert.equal(baseOf({ sha: SHA, earlier: [SHA], isAncestor: () => true, describe }), 'staging-v0.2.0-276')
})

test('a publish hands over the changed screens since the previous publish (dry runs are not publishes)', async () => {
  const ranges = []
  const listChanged = (range) => (ranges.push(range), ['bifold/packages/core/src/modules/rooms/components/RoomNoteEditor.tsx', 'bifold/packages/core/src/modules/rooms/useRoomPosts.ts'])
  const r = await postRelease(opts(fakeGh({ publishJobs: [publishJob('ios'), publishJob('android')], smokeJobs: GREEN }).gh, { listChanged, isAncestor: (a) => a === PREV }))
  assert.deepEqual(ranges, [`${PREV}..${SHA}`])
  assert.deepEqual([r.since, r.screens], [PREV, ['bifold/packages/core/src/modules/rooms/components/RoomNoteEditor.tsx']])
})

test('screens it cannot work out are reported unknown, and the smoke still runs', async () => {
  const listChanged = () => { throw new Error('range unreadable') }
  const r = await postRelease(opts(fakeGh({ publishJobs: [publishJob('ios'), publishJob('android')], smokeJobs: GREEN }).gh, { listChanged }))
  assert.deepEqual([r.verdict, r.screens], ['green', []])
})

test('an ambiguous smoke ends the run with an error, so there is no verdict for the brake to act on', async () => {
  const { gh } = fakeGh({ publishJobs: [publishJob('ios'), publishJob('android')], smokeJobs: GREEN })
  const twice = (...args) => {
    const out = gh(...args)
    // A second gate-smoke for the same build, dispatched by someone else in the same minute.
    if (args[1]?.includes('workflows/gate-smoke.yml/runs')) {
      const list = JSON.parse(out)
      if (list.workflow_runs.length) list.workflow_runs.push({ ...list.workflow_runs[0], id: 602 })
      return JSON.stringify(list)
    }
    return out
  }
  await assert.rejects(postRelease(opts(twice)), /more than one run matches \(601, 602\): refusing to pick one/)
})

test('a dispatched run that never finishes is given up on with an error, not waited on forever', async () => {
  const { gh } = fakeGh({ publishJobs: [publishJob('ios')], smokeJobs: GREEN })
  const stuck = (...args) => {
    const out = gh(...args)
    return /actions\/runs\/501$/.test(args[1] ?? '') ? JSON.stringify({ ...JSON.parse(out), status: 'waiting', conclusion: null }) : out
  }
  await assert.rejects(postRelease(opts(stuck, { pollMs: 60000, maxWaitMs: 5 * 60000 })), /test-builds\.yml run 501 still waiting after 5 min: giving up/)
})

test("a job log that isn't readable yet is retried, then read", async () => {
  const { gh } = fakeGh({ publishJobs: [publishJob('ios'), publishJob('android')], smokeJobs: GREEN })
  let failures = 2
  const late = (...args) => {
    if (/actions\/jobs\/11\/logs$/.test(args[1] ?? '') && failures-- > 0) throw new Error('HTTP 404: Not Found')
    return gh(...args)
  }
  const r = await postRelease(opts(late))
  assert.deepEqual([r.verdict, r.bundles.map((b) => b.id)], ['green', [IOS, ANDROID]])
})

test('a job log still unreadable after the retries: the smoke runs, with that platform\'s bundle unknown', async () => {
  const { gh } = fakeGh({ publishJobs: [publishJob('ios'), publishJob('android')], smokeJobs: GREEN })
  const never = (...args) => {
    if (/actions\/jobs\/11\/logs$/.test(args[1] ?? '')) throw new Error('HTTP 404: Not Found')
    return gh(...args)
  }
  const lines = []
  const r = await postRelease({ ...opts(never), log: (l) => lines.push(l) })
  assert.deepEqual([r.verdict, r.bundles.map((b) => b.id)], ['green', [ANDROID]])
  // What was published is still known, so the brake can say a withdraw would be partial.
  assert.deepEqual(r.platforms, ['ios', 'android'])
  assert.ok(lines.some((l) => /log of job 11 is still unreadable after 6 tries: bundle ids unknown/.test(l)))
})
