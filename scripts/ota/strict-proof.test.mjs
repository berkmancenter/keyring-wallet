// node --test scripts/ota/
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { checkSmoke, checkStatuses, proveStrict } from './strict-proof.mjs'

const SHA = '67be5abe14670f99a26a35d7041bba39a437c1fe'
const OTHER = '94c5a7756a0126c11f08beea99c6dc4d2361e9c0'
const build = (over) => ({ id: 101, head_sha: SHA, event: 'workflow_dispatch', conclusion: 'success', ...over })
const job = (platform, over) => ({
  name: platform === 'iOS' ? `iOS smoke (macos-26) · ${SHA.slice(0, 8)}` : `Android smoke (ubuntu-latest, KVM) · ${SHA.slice(0, 8)}`,
  conclusion: 'success',
  ...over,
})
const smoke = (over) => ({
  id: 201,
  display_title: 'Gate smoke · Test builds 101',
  conclusion: 'success',
  jobs: [job('iOS'), job('Android')],
  ...over,
})
const status = (context, over) => ({ context, state: 'success', target_url: 'https://example.invalid/evidence', ...over })
const STATUSES = [status('ota-strict/targeted-tests'), status('ota-strict/sim-check')]

test('the smoke: a green iOS and Android job of a green dispatched or pushed build of the commit', () => {
  assert.equal(checkSmoke(SHA, [build()], [smoke()]).met, true)
  assert.equal(checkSmoke(SHA, [build({ event: 'push' })], [smoke()]).met, true)
  // The automatic smoke after a push build of main titles itself "<sha> (Test builds <id>)".
  assert.equal(checkSmoke(SHA, [build()], [smoke({ display_title: `Gate smoke · ${SHA} (Test builds 101)` })]).met, true)
})

test('the smoke: a pull request build, another commit, or a red build does not count', () => {
  assert.match(checkSmoke(SHA, [build({ event: 'pull_request' })], [smoke()]).detail, /no green Test builds run built from 67be5abe/)
  assert.equal(checkSmoke(SHA, [build({ head_sha: OTHER })], [smoke()]).met, false)
  assert.equal(checkSmoke(SHA, [build({ conclusion: 'failure' })], [smoke()]).met, false)
  assert.equal(checkSmoke(SHA, [], [smoke()]).met, false)
})

test('the smoke: both platforms, green, of that build and that commit', () => {
  const ios = checkSmoke(SHA, [build()], [smoke({ jobs: [job('iOS'), job('Android', { conclusion: 'skipped' })] })])
  assert.deepEqual([ios.met, /no green Android smoke of Test builds 101/.test(ios.detail)], [false, true])
  assert.equal(checkSmoke(SHA, [build()], [smoke({ jobs: [job('iOS', { conclusion: 'failure' }), job('Android')] })]).met, false)
  // Another build's smoke, a red smoke run, or a job naming another commit's artifacts.
  assert.equal(checkSmoke(SHA, [build()], [smoke({ display_title: 'Gate smoke · Test builds 1010' })]).met, false)
  assert.equal(checkSmoke(SHA, [build()], [smoke({ conclusion: 'failure' })]).met, false)
  const other = smoke({ jobs: [job('iOS', { name: `iOS smoke (macos-26) · ${OTHER.slice(0, 8)}` }), job('Android')] })
  assert.equal(checkSmoke(SHA, [build()], [other]).met, false)
})

test('the smoke: one platform per run is enough when both are covered', () => {
  const ios = smoke({ id: 201, jobs: [job('iOS'), job('Android', { conclusion: 'skipped' })] })
  const android = smoke({ id: 202, jobs: [job('iOS', { conclusion: 'skipped' }), job('Android')] })
  const r = checkSmoke(SHA, [build()], [ios, android])
  assert.deepEqual([r.met, r.detail], [true, 'iOS in gate-smoke run 201, Android in gate-smoke run 202'])
})

test('the attested checks: the newest status of each context, success, with its evidence', () => {
  assert.deepEqual(checkStatuses(STATUSES).map((c) => c.met), [true, true])
  assert.match(checkStatuses([STATUSES[0]])[1].detail, /no ota-strict\/sim-check status/)
  assert.match(checkStatuses([status('ota-strict/targeted-tests', { state: 'pending' }), STATUSES[1]])[0].detail, /is pending/)
  assert.match(checkStatuses([status('ota-strict/targeted-tests', { target_url: null }), STATUSES[1]])[0].detail, /names no evidence/)
  // Newest first: a later failure overrides an earlier success, and a later success an earlier failure.
  assert.equal(checkStatuses([status('ota-strict/sim-check', { state: 'failure' }), ...STATUSES])[1].met, false)
  assert.equal(checkStatuses([...STATUSES, status('ota-strict/sim-check', { state: 'failure' })])[1].met, true)
  // A context that is only similar does not count.
  assert.equal(checkStatuses([status('ota-strict/sim-check-2'), STATUSES[0]])[1].met, false)
})

const fakeApi = (routes) => (route) => {
  const hit = Object.entries(routes).find(([prefix]) => route.startsWith(prefix))
  if (!hit) throw new Error(`unexpected route ${route}`)
  if (hit[1] instanceof Error) throw hit[1]
  return hit[1]
}
const R = 'owner/repo'
const ROUTES = {
  [`repos/${R}/commits/${SHA}/statuses`]: STATUSES,
  [`repos/${R}/actions/workflows/test-builds.yml/runs`]: { workflow_runs: [build()] },
  [`repos/${R}/actions/workflows/gate-smoke.yml/runs`]: {
    workflow_runs: [{ id: 201, display_title: 'Gate smoke · Test builds 101', conclusion: 'success' }, { id: 299, display_title: 'Gate smoke · Test builds 999', conclusion: 'success' }],
  },
  [`repos/${R}/actions/runs/201/jobs`]: { jobs: [job('iOS'), job('Android')] },
}

test('proveStrict: every condition met, reading only the smokes that name the build', () => {
  const asked = []
  const api = fakeApi(ROUTES)
  const conditions = proveStrict({ sha: SHA, repo: R, api: (route) => (asked.push(route), api(route)) })
  assert.deepEqual(conditions.map((c) => [c.name, c.met]), [['launch smoke', true], ['targeted tests', true], ['sim check', true]])
  assert.equal(asked.some((r) => r.includes('/runs/299/')), false)
})

test('proveStrict: a read that fails is a condition not met, never a pass', () => {
  const down = proveStrict({ sha: SHA, repo: R, api: fakeApi({ ...ROUTES, [`repos/${R}/commits/${SHA}/statuses`]: new Error('HTTP 502') }) })
  assert.deepEqual(down.map((c) => [c.name, c.met]), [['launch smoke', true], ['attested checks', false]])
  assert.match(down[1].detail, /could not read: HTTP 502/)
  const noRuns = proveStrict({ sha: SHA, repo: R, api: fakeApi({ ...ROUTES, [`repos/${R}/actions/workflows/test-builds.yml/runs`]: new Error('HTTP 404') }) })
  assert.equal(noRuns[0].met, false)
})

test('proveStrict: a short sha or no repository proves nothing', () => {
  assert.deepEqual(proveStrict({ sha: SHA.slice(0, 8), repo: R, api: fakeApi(ROUTES) }).map((c) => c.met), [false])
  assert.deepEqual(proveStrict({ sha: SHA, repo: '', api: fakeApi(ROUTES) }).map((c) => c.met), [false])
})
