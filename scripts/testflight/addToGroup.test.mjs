import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addToGroup, ADD_TRIES } from './addToGroup.mjs'

const notFound = () => Object.assign(new Error('POST … → 404 NOT_FOUND'), { status: 404 })

// An api fake that answers from a script of outcomes: an Error is thrown, anything else returned.
const scripted = (outcomes) => {
  const calls = []
  const api = async (method, path, body) => {
    calls.push({ method, path, body })
    const next = outcomes.length ? outcomes.shift() : outcomes.last
    if (next instanceof Error) throw next
    return next
  }
  return { api, calls }
}

const run = (api, extra = {}) => {
  const sleeps = []
  const promise = addToGroup(api, {
    groupId: 'g1',
    groupName: 'Testers',
    buildId: 'b1',
    sleep: async (ms) => void sleeps.push(ms),
    log: () => {},
    ...extra,
  })
  return { promise, sleeps }
}

test('a 404 and then success: tries once more, after one wait, and posts the build to the group', async () => {
  const { api, calls } = scripted([notFound(), { ok: true }])
  const { promise, sleeps } = run(api)
  assert.deepEqual(await promise, { ok: true })
  assert.equal(calls.length, 2)
  assert.equal(sleeps.length, 1)
  assert.equal(calls[1].path, '/v1/betaGroups/g1/relationships/builds')
  assert.deepEqual(calls[1].body, { data: [{ type: 'builds', id: 'b1' }] })
})

test('an error other than 404 is thrown at once, with no wait', async () => {
  const denied = Object.assign(new Error('403'), { status: 403 })
  const { api, calls } = scripted([denied])
  const { promise, sleeps } = run(api)
  await assert.rejects(promise, denied)
  assert.equal(calls.length, 1)
  assert.equal(sleeps.length, 0)
})

test('a 404 every time: stops after ADD_TRIES attempts and throws the last 404', async () => {
  const outcomes = []
  outcomes.last = notFound()
  const { api, calls } = scripted(outcomes)
  const { promise, sleeps } = run(api)
  await assert.rejects(promise, (e) => e.status === 404)
  assert.equal(calls.length, ADD_TRIES)
  assert.equal(sleeps.length, ADD_TRIES - 1)
})

test('control: a 404-shaped error WITHOUT a status is thrown at once (the wait relies on api setting status)', async () => {
  const bare = new Error('POST … → 404 NOT_FOUND')
  const { api, calls } = scripted([bare, { ok: true }])
  const { promise, sleeps } = run(api)
  await assert.rejects(promise, bare)
  assert.equal(calls.length, 1)
  assert.equal(sleeps.length, 0)
})
