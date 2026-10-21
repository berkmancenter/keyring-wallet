// node --test scripts/ota/
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { diffFingerprints } from './fingerprint-report.mjs'

const fp = (iosSources, androidSources = []) => ({
  ios: { hash: 'i', sources: iosSources },
  android: { hash: 'a', sources: androidSources },
})
const dir = (filePath, hash) => ({ type: 'dir', filePath, hash })

test('identical fingerprints have no differing source', () => {
  const a = fp([dir('node_modules/x', '1'), { type: 'contents', id: 'package:react-native', hash: '2' }])
  assert.deepEqual(diffFingerprints(a, structuredClone(a)), [])
})

test('a changed hash and a source on one side only are both reported, per platform', () => {
  const a = fp([dir('node_modules/x', '1'), dir('node_modules/only-a', '9')], [dir('android/app', '5')])
  const b = fp([dir('node_modules/x', '2')], [dir('android/app', '5')])
  assert.deepEqual(diffFingerprints(a, b), [
    { platform: 'ios', id: 'node_modules/x', a: '1', b: '2' },
    { platform: 'ios', id: 'node_modules/only-a', a: '9', b: 'absent' },
  ])
})

test('sources sharing an id are each compared, not collapsed into one', () => {
  const a = fp([
    { type: 'dir', hash: 'a' },
    { type: 'dir', hash: 'b' },
    { type: 'dir', hash: 'c' },
  ])
  const b = fp([
    { type: 'dir', hash: 'a' },
    { type: 'dir', hash: 'X' },
    { type: 'dir', hash: 'c' },
  ])
  assert.deepEqual(diffFingerprints(a, b), [{ platform: 'ios', id: 'dir#2', a: 'b', b: 'X' }])
})
