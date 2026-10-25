// node --test scripts/ota/
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { checkPromote, publishedAt, ringOf } from './promote.mjs'

// 01a16998-e09d-…: published 2026-10-23T16:37Z (its UUIDv7 time).
const ID = '01a16998-e09d-7e22-8440-98fab0992afd'
const PUBLISHED = publishedAt(ID)
const HOUR = 3600000
const bundle = (over) => ({
  id: ID,
  channel: 'production',
  platform: 'ios',
  enabled: true,
  rolloutCohortCount: 0,
  targetCohorts: ['ring0'],
  ...over,
})
const target = (over) => ({
  channel: 'production',
  platform: 'ios',
  bundleId: ID,
  to: 'ring2',
  now: PUBLISHED + 25 * HOUR,
  ...over,
})

test('the publish time comes from the UUIDv7 id', () => {
  assert.equal(new Date(PUBLISHED).toISOString().slice(0, 13), '2026-10-23T16')
})

test('ringOf names the three target lists and nothing else', () => {
  assert.equal(ringOf(['ring0']), 'ring0')
  assert.equal(ringOf(['ring1', 'ring0']), 'ring1')
  assert.equal(ringOf(['ring0', 'ring1', 'ring2']), 'ring2')
  assert.equal(ringOf(['ring2']), null)
  assert.equal(ringOf(null), null)
})

test('a ring-0 bundle soaked 24 h may go to ring 2, and to ring 1', () => {
  assert.equal(checkPromote(bundle(), target()).ok, true)
  assert.equal(checkPromote(bundle(), target({ to: 'ring1' })).ok, true)
})

test('a ring-1 bundle may go to ring 2, never back to ring 1', () => {
  assert.equal(checkPromote(bundle({ targetCohorts: ['ring0', 'ring1'] }), target()).ok, true)
  assert.match(checkPromote(bundle({ targetCohorts: ['ring0', 'ring1'] }), target({ to: 'ring1' })).reason, /at ring1/)
})

test('a bundle soaked under 24 h is refused', () => {
  assert.match(checkPromote(bundle(), target({ now: PUBLISHED + 23 * HOUR })).reason, /soaks 24 h/)
})

test('disabled, percentage-rollout, off-ring and already-wide bundles are refused', () => {
  assert.match(checkPromote(bundle({ enabled: false }), target()).reason, /is disabled/)
  assert.match(checkPromote(bundle({ rolloutCohortCount: 1000 }), target()).reason, /percentage rollout/)
  assert.match(checkPromote(bundle({ targetCohorts: ['ring2'] }), target()).reason, /not a ring/)
  assert.match(checkPromote(bundle({ targetCohorts: ['ring0', 'ring1', 'ring2'] }), target()).reason, /at ring2/)
})

test('wrong channel, platform, id, or destination is refused', () => {
  assert.match(checkPromote(bundle(), target({ channel: 'device-test' })).reason, /not promoted here/)
  assert.match(checkPromote(bundle({ channel: 'preview' }), target()).reason, /preview bundle, not production/)
  assert.match(checkPromote(bundle({ platform: 'android' }), target()).reason, /android bundle, not ios/)
  assert.match(checkPromote(null, target()).reason, /has no bundle/)
  assert.match(checkPromote(bundle(), target({ to: 'ring0' })).reason, /ring1 or ring2/)
})
