// node --test scripts/ota/
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assertFingerprint, parseRecorded } from './check-fingerprint.mjs'

const H1 = '0dfd029716f42c47ede761ce7bc2b4404bc9fde9'
const H2 = '173efdbac8cb6f5aa87c4acd91980b7f1f249e53'
const fp = (hash, sources) => ({ ios: { hash, sources } })
const dir = (filePath, hash) => ({ type: 'dir', filePath, hash })

test('the recorded hash is read from the tag message, per platform', () => {
  const message = `Staging build 245\n\nOTA fingerprint ios: ${H1}\nOTA fingerprint android: ${H2}\n`
  assert.equal(parseRecorded(message, 'ios'), H1)
  assert.equal(parseRecorded(message, 'android'), H2)
  assert.equal(parseRecorded('Staging build 244', 'ios'), undefined)
})

test('a bundle built for the recorded fingerprint passes', () => {
  assert.equal(assertFingerprint({ platform: 'ios', actual: fp(H1, []), expected: H1 }), H1)
})

test('a different fingerprint is refused, naming the differing sources', () => {
  const recorded = fp(H1, [dir('node_modules/react-native-permissions', 'aa'), dir('node_modules/x', '11')])
  const actual = fp(H2, [dir('node_modules/react-native-permissions', 'bb'), dir('node_modules/x', '11')])
  assert.throws(
    () => assertFingerprint({ platform: 'ios', actual, expected: H1, recorded }),
    (err) =>
      /ios fingerprint 173efdba.* is not the target build's 0dfd0297/.test(err.message) &&
      /node_modules\/react-native-permissions: aa vs bb/.test(err.message) &&
      !/node_modules\/x:/.test(err.message)
  )
})

test('a different fingerprint is refused even when the sources cannot be named', () => {
  assert.throws(
    () => assertFingerprint({ platform: 'ios', actual: fp(H2, []), expected: H1 }),
    /Refusing \(the target build recorded no source list/
  )
})

test('no recorded fingerprint at all is refused (fail closed)', () => {
  for (const expected of [undefined, '', 'not-a-hash']) {
    assert.throws(
      () => assertFingerprint({ platform: 'ios', actual: fp(H1, []), expected }),
      /no recorded ios fingerprint to publish against/
    )
  }
})
