import assert from 'node:assert/strict'
import { test } from 'node:test'

import { requestOrigin } from './requestOrigin.mjs'

test('a local publisher is sent back to localhost, not the public URL', () => {
  assert.equal(requestOrigin({ host: 'localhost:3080' }), 'http://localhost:3080')
})

test('behind a proxy the forwarded scheme is kept', () => {
  assert.equal(requestOrigin({ host: 'ota.example.org', 'x-forwarded-proto': 'https' }), 'https://ota.example.org')
  assert.equal(requestOrigin({ host: 'ota.example.org', 'x-forwarded-proto': 'https, http' }), 'https://ota.example.org')
  assert.equal(requestOrigin({ host: 'ota.example.org', 'x-forwarded-proto': 'gopher' }), 'http://ota.example.org')
})

test('a missing or malformed Host is refused', () => {
  assert.throws(() => requestOrigin({}), /unusable Host/)
  assert.throws(() => requestOrigin({ host: 'evil.example/path' }), /unusable Host/)
  assert.throws(() => requestOrigin({ host: 'user@evil.example' }), /unusable Host/)
})
