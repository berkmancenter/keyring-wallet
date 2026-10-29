// node --test scripts/ota/
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { checkSmoke, proveStrict } from './strict-proof.mjs'

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

const fakeApi = (routes) => (route) => {
  const hit = Object.entries(routes).find(([prefix]) => route.startsWith(prefix))
  if (!hit) throw new Error(`unexpected route ${route}`)
  if (hit[1] instanceof Error) throw hit[1]
  return hit[1]
}
const R = 'owner/repo'
const ROUTES = {
  [`repos/${R}/actions/workflows/test-builds.yml/runs`]: { workflow_runs: [build()] },
  [`repos/${R}/actions/workflows/gate-smoke.yml/runs`]: {
    workflow_runs: [{ id: 201, display_title: 'Gate smoke · Test builds 101', conclusion: 'success' }, { id: 299, display_title: 'Gate smoke · Test builds 999', conclusion: 'success' }],
  },
  [`repos/${R}/actions/runs/201/jobs`]: { jobs: [job('iOS'), job('Android')] },
}

test('proveStrict: the smoke met, reading only the smokes that name the build; no commit status is asked for', () => {
  const asked = []
  const api = fakeApi(ROUTES)
  const conditions = proveStrict({ sha: SHA, repo: R, api: (route) => (asked.push(route), api(route)) })
  assert.deepEqual(conditions.map((c) => [c.name, c.met]), [['launch smoke', true]])
  // The attested statuses are gone (10-29 pipeline): a status is never read, so none can stand in for the smoke.
  assert.equal(asked.some((r) => r.includes('/statuses')), false)
  assert.equal(asked.some((r) => r.includes('/runs/299/')), false)
})

test('proveStrict: the smoke may be on any page of the gate-smoke list', () => {
  const smokeList = `repos/${R}/actions/workflows/gate-smoke.yml/runs`
  const pages = (route) =>
    route.startsWith(smokeList)
      ? [{ workflow_runs: [{ id: 299, display_title: 'Gate smoke · Test builds 999', conclusion: 'success' }] }, ROUTES[smokeList]]
      : [fakeApi(ROUTES)(route)]
  const conditions = proveStrict({ sha: SHA, repo: R, api: fakeApi(ROUTES), pages })
  assert.equal(conditions[0].met, true)
  // The first page alone would not have found it.
  const firstOnly = proveStrict({ sha: SHA, repo: R, api: fakeApi(ROUTES), pages: (route) => [pages(route)[0]] })
  assert.equal(firstOnly[0].met, false)
})

test('proveStrict: a read that fails is a condition not met, never a pass', () => {
  const noRuns = proveStrict({ sha: SHA, repo: R, api: fakeApi({ ...ROUTES, [`repos/${R}/actions/workflows/test-builds.yml/runs`]: new Error('HTTP 404') }) })
  assert.deepEqual(noRuns.map((c) => [c.name, c.met]), [['launch smoke', false]])
  assert.match(noRuns[0].detail, /could not read: HTTP 404/)
  const noJobs = proveStrict({ sha: SHA, repo: R, api: fakeApi({ ...ROUTES, [`repos/${R}/actions/runs/201/jobs`]: new Error('HTTP 502') }) })
  assert.equal(noJobs[0].met, false)
})

test('proveStrict: a short sha or no repository proves nothing', () => {
  assert.deepEqual(proveStrict({ sha: SHA.slice(0, 8), repo: R, api: fakeApi(ROUTES) }).map((c) => c.met), [false])
  assert.deepEqual(proveStrict({ sha: SHA, repo: '', api: fakeApi(ROUTES) }).map((c) => c.met), [false])
})
