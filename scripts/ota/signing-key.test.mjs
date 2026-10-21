// node --test scripts/ota/
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createPublicKey, generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { fingerprint, selectSigningKey } from './signing-key.mjs'

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return {
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    pub: publicKey.export({ type: 'spki', format: 'pem' }),
  }
}
const store = pair()
const testKey = pair()
// The store public key as the repository variable holds it: one line, literal \n.
const published = store.pub.trim().replace(/\n/g, '\\n')
const both = { signingKeyPem: store.priv, testSigningKeyPem: testKey.priv, publishedPublicKey: published }
const samePublic = (a, b) =>
  createPublicKey(a)
    .export({ type: 'spki', format: 'der' })
    .equals(createPublicKey(b).export({ type: 'spki', format: 'der' }))

test('production and preview sign with the store key', () => {
  for (const channel of ['production', 'preview']) {
    const out = selectSigningKey({ channel, ...both })
    assert.ok(samePublic(out.publicKeyPem, store.pub), channel)
    assert.ok(samePublic(out.privateKeyPem, store.pub), channel)
  }
})

test('device-test signs with the test key, never the store key', () => {
  const out = selectSigningKey({ channel: 'device-test', ...both })
  assert.ok(samePublic(out.privateKeyPem, testKey.pub))
  assert.ok(!samePublic(out.privateKeyPem, store.pub))
  assert.ok(samePublic(out.publicKeyPem, testKey.pub))
})

test('device-test without the test key is refused (no fallback to the store key)', () => {
  assert.throws(
    () => selectSigningKey({ channel: 'device-test', signingKeyPem: store.priv, publishedPublicKey: published }),
    /signs only with OTA_TEST_SIGNING_KEY_PEM, which is not set/
  )
})

test('production or preview with the test key in the store slot is refused', () => {
  for (const channel of ['production', 'preview']) {
    assert.throws(
      () => selectSigningKey({ channel, signingKeyPem: testKey.priv, publishedPublicKey: published }),
      /does not match OTA_PUBLIC_KEY/,
      channel
    )
  }
})

test('production without the store key is refused', () => {
  assert.throws(
    () => selectSigningKey({ channel: 'production', testSigningKeyPem: testKey.priv, publishedPublicKey: published }),
    /OTA_SIGNING_KEY_PEM, which is not set/
  )
})

test('a test key that is the store key is refused', () => {
  assert.throws(
    () => selectSigningKey({ channel: 'device-test', ...both, testSigningKeyPem: store.priv }),
    /same key as OTA_SIGNING_KEY_PEM/
  )
  assert.throws(
    () => selectSigningKey({ channel: 'device-test', testSigningKeyPem: store.priv, publishedPublicKey: published }),
    /is the store key/
  )
})

test('tamper signs with a throwaway key but keeps the test public key, on device-test only', () => {
  const out = selectSigningKey({ channel: 'device-test', ...both, tamper: true })
  assert.ok(samePublic(out.publicKeyPem, testKey.pub))
  assert.ok(!samePublic(out.privateKeyPem, testKey.pub))
  assert.ok(!samePublic(out.privateKeyPem, store.pub))
  assert.throws(() => selectSigningKey({ channel: 'production', ...both, tamper: true }), /only for the device-test/)
})

test('unknown channels and a missing OTA_PUBLIC_KEY are refused', () => {
  assert.throws(() => selectSigningKey({ channel: 'staging', ...both }), /unknown channel/)
  assert.throws(() => selectSigningKey({ channel: 'production', ...both, publishedPublicKey: '' }), /OTA_PUBLIC_KEY/)
})

test('the CLI writes the key files, prints no key material, and exits 1 on a refusal', () => {
  const script = path.join(path.dirname(new URL(import.meta.url).pathname), 'signing-key.mjs')
  const out = mkdtempSync(path.join(tmpdir(), 'ota-key-'))
  const env = {
    ...process.env,
    OTA_SIGNING_KEY_PEM: store.priv,
    OTA_TEST_SIGNING_KEY_PEM: testKey.priv,
    OTA_PUBLIC_KEY: published,
  }
  const ok = spawnSync('node', [script, '--channel', 'device-test', '--out', out], { env, encoding: 'utf8' })
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, new RegExp(`sha256 ${fingerprint(testKey.pub)}`))
  assert.doesNotMatch(ok.stdout + ok.stderr, /BEGIN/)
  assert.equal(statSync(path.join(out, 'ota-private-key.pem')).mode & 0o777, 0o600)
  assert.ok(samePublic(readFileSync(path.join(out, 'ota-public-key.pem'), 'utf8'), testKey.pub))

  const check = mkdtempSync(path.join(tmpdir(), 'ota-key-'))
  const dry = spawnSync('node', [script, '--channel', 'production', '--check', '--out', check], {
    env,
    encoding: 'utf8',
  })
  assert.equal(dry.status, 0, dry.stderr)
  assert.ok(!existsSync(path.join(check, 'ota-private-key.pem')))

  const { OTA_TEST_SIGNING_KEY_PEM, ...noTest } = env
  const refused = spawnSync('node', [script, '--channel', 'device-test', '--check'], { env: noTest, encoding: 'utf8' })
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /REFUSED: device-test signs only with OTA_TEST_SIGNING_KEY_PEM/)
  assert.doesNotMatch(refused.stdout + refused.stderr, /BEGIN/)
})
