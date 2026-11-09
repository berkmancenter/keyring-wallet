// node --test scripts/ota/
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { checkPromote, checkPromoteAll, parseBundles, publishedAt, ringOf, soakHoursOf } from './promote.mjs'

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

test('a ring-0 bundle may go to ring 2, and to ring 1', () => {
  assert.equal(checkPromote(bundle(), target()).ok, true)
  assert.equal(checkPromote(bundle(), target({ to: 'ring1' })).ok, true)
})

test('the soak defaults to 24 h; a soak of 0, set on purpose, promotes at once', () => {
  assert.match(checkPromote(bundle(), target({ now: PUBLISHED + 23 * HOUR })).reason, /soaks 24 h/)
  assert.equal(checkPromote(bundle(), target({ soakHours: 0, now: PUBLISHED + 60000 })).ok, true)
})

test('a ring-1 bundle may go to ring 2, never back to ring 1', () => {
  assert.equal(checkPromote(bundle({ targetCohorts: ['ring0', 'ring1'] }), target()).ok, true)
  assert.match(checkPromote(bundle({ targetCohorts: ['ring0', 'ring1'] }), target({ to: 'ring1' })).reason, /at ring1/)
})

test('a soak, when set, must have passed since publish', () => {
  assert.match(checkPromote(bundle(), target({ soakHours: 24, now: PUBLISHED + 23 * HOUR })).reason, /soaks 24 h/)
  assert.equal(checkPromote(bundle(), target({ soakHours: 24, now: PUBLISHED + 25 * HOUR })).ok, true)
  assert.match(checkPromote(bundle(), target({ soakHours: NaN })).reason, /number of hours/)
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

test('the soak arrives raw: unset or empty is 24 h, "0" is 0, anything else is read as a number', () => {
  assert.equal(soakHoursOf(undefined), 24)
  assert.equal(soakHoursOf(''), 24)
  assert.equal(soakHoursOf('0'), 0)
  assert.equal(soakHoursOf('12'), 12)
  assert.ok(Number.isNaN(soakHoursOf('abc')))
})

test('--bundles names each platform once, in either order', () => {
  assert.deepEqual(parseBundles('ios:a,android:b'), [
    { platform: 'ios', bundleId: 'a' },
    { platform: 'android', bundleId: 'b' },
  ])
  assert.deepEqual(parseBundles(' android:b , ios:a '), [
    { platform: 'android', bundleId: 'b' },
    { platform: 'ios', bundleId: 'a' },
  ])
  assert.throws(() => parseBundles('ios:a,ios:b'), /platform twice/)
  assert.throws(() => parseBundles('web:a'), /ios:<id>,android:<id>/)
  assert.throws(() => parseBundles('ios'), /ios:<id>,android:<id>/)
  assert.throws(() => parseBundles('ios:a:b'), /ios:<id>,android:<id>/)
  assert.throws(() => parseBundles(''), /names no bundle/)
})

test('two bundles are widened only if both pass, and a failure names its platform', () => {
  const ios = bundle()
  const android = bundle({ id: ID, platform: 'android' })
  const targets = [
    { platform: 'ios', bundleId: ID },
    { platform: 'android', bundleId: ID },
  ]
  const common = { channel: 'production', to: 'ring2', soakHours: 0, now: PUBLISHED + HOUR }
  assert.equal(checkPromoteAll([ios, android], targets, common).ok, true)

  const oneDisabled = checkPromoteAll([ios, { ...android, enabled: false }], targets, common)
  assert.equal(oneDisabled.ok, false)
  assert.deepEqual(
    oneDisabled.results.map((r) => [r.platform, r.ok]),
    [
      ['ios', true],
      ['android', false],
    ],
  )
  assert.match(oneDisabled.results[1].reason, /is disabled/)

  const swapped = checkPromoteAll([android, ios], targets, common)
  assert.equal(swapped.ok, false)
  assert.match(swapped.results[0].reason, /android bundle, not ios/)
})
