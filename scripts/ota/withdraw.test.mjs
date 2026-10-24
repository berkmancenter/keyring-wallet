// node --test scripts/ota/
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { checkWithdraw } from './withdraw.mjs'

const bundle = (over) => ({ id: 'a', channel: 'production', platform: 'ios', enabled: true, ...over })
const target = (over) => ({ channel: 'production', platform: 'ios', bundleId: 'a', ...over })

test('an enabled bundle on its channel and platform may be withdrawn', () => {
  assert.equal(checkWithdraw(bundle(), target()).ok, true)
  assert.equal(checkWithdraw(bundle({ channel: 'preview' }), target({ channel: 'preview' })).ok, true)
})

test('device-test and unknown channels are refused, whatever the bundle', () => {
  assert.equal(checkWithdraw(bundle({ channel: 'device-test' }), target({ channel: 'device-test' })).ok, false)
  assert.equal(checkWithdraw(bundle({ channel: 'spike' }), target({ channel: 'spike' })).ok, false)
})

test('a bundle the server does not have is refused', () => {
  assert.match(checkWithdraw(null, target()).reason, /has no bundle a/)
  assert.match(checkWithdraw(bundle({ id: 'b' }), target()).reason, /has no bundle a/)
})

test('a bundle on another channel is refused', () => {
  assert.match(checkWithdraw(bundle({ channel: 'preview' }), target()).reason, /preview bundle, not production/)
})

test('a bundle for the other platform is refused', () => {
  assert.match(checkWithdraw(bundle({ platform: 'android' }), target()).reason, /android bundle, not ios/)
})

test('an already disabled bundle is refused', () => {
  assert.match(checkWithdraw(bundle({ enabled: false }), target()).reason, /already disabled/)
})
