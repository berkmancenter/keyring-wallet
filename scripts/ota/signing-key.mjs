/**
 * Picks the private key an over-the-air publish signs with, by channel, and
 * proves it is the right one before anything is built (ota-publish.yml).
 *
 *   OTA_SIGNING_KEY_PEM=… OTA_TEST_SIGNING_KEY_PEM=… OTA_PUBLIC_KEY=… \
 *     node scripts/ota/signing-key.mjs --channel <production|preview|device-test> \
 *       --out <dir> [--tamper] [--check]
 *
 * - production and preview sign with OTA_SIGNING_KEY_PEM. Its public half must
 *   be OTA_PUBLIC_KEY, the key compiled into store builds.
 * - device-test signs ONLY with OTA_TEST_SIGNING_KEY_PEM, the quick-install
 *   test app's throwaway key. There is no fallback: without it the run stops.
 *   Its public half must NOT be OTA_PUBLIC_KEY, so a store phone can never
 *   accept a device-test bundle.
 * - When both private keys are present they must differ.
 * - --tamper (device-test only) signs with a fresh key made here and thrown
 *   away, of the test key's own type and size, while the checkout keeps the
 *   test public key: the phone must refuse the bundle. That is the trial's
 *   "tampered bundle is refused" step.
 * - --check validates without writing anything (a dry run).
 *
 * Writes <out>/ota-private-key.pem (mode 600) and <out>/ota-public-key.pem,
 * the public key the checkout's native settings must carry. Prints only
 * SHA-256 fingerprints of public keys, never key material.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

export const CHANNELS = ['production', 'preview', 'device-test']

// A repository variable may hold a PEM on one line with literal "\n" (native-config.mjs writes that form).
const pem = (text) =>
  String(text ?? '')
    .replace(/\\n/g, '\n')
    .trim()

const spki = (key) => createPublicKey(key).export({ type: 'spki', format: 'der' })

export const fingerprint = (publicKey) => createHash('sha256').update(spki(publicKey)).digest('hex').slice(0, 16)

const privateKey = (text, name) => {
  try {
    return createPrivateKey(pem(text))
  } catch {
    throw new Error(`${name} is not a readable private key`)
  }
}

/**
 * @param {{channel: string, signingKeyPem?: string, testSigningKeyPem?: string, publishedPublicKey?: string, tamper?: boolean}} input
 * @returns {{privateKeyPem: string, publicKeyPem: string, role: string}}
 */
export const selectSigningKey = ({ channel, signingKeyPem, testSigningKeyPem, publishedPublicKey, tamper = false }) => {
  if (!CHANNELS.includes(channel)) throw new Error(`unknown channel "${channel}" (one of ${CHANNELS.join(', ')})`)
  if (!pem(publishedPublicKey)) throw new Error('OTA_PUBLIC_KEY is not set: there is no store key to check against')
  const published = spki(pem(publishedPublicKey))
  const store = pem(signingKeyPem) ? privateKey(signingKeyPem, 'OTA_SIGNING_KEY_PEM') : undefined
  const test = pem(testSigningKeyPem) ? privateKey(testSigningKeyPem, 'OTA_TEST_SIGNING_KEY_PEM') : undefined
  if (store && test && spki(store).equals(spki(test))) {
    throw new Error(
      'OTA_TEST_SIGNING_KEY_PEM is the same key as OTA_SIGNING_KEY_PEM; the test key must be its own pair'
    )
  }
  if (tamper && channel !== 'device-test') throw new Error('--tamper is only for the device-test channel')

  if (channel === 'device-test') {
    if (!test) throw new Error('device-test signs only with OTA_TEST_SIGNING_KEY_PEM, which is not set (no fallback)')
    if (spki(test).equals(published)) {
      throw new Error('OTA_TEST_SIGNING_KEY_PEM is the store key (its public half is OTA_PUBLIC_KEY); refusing')
    }
    const publicKeyPem = createPublicKey(test).export({ type: 'spki', format: 'pem' })
    if (!tamper) {
      return { privateKeyPem: test.export({ type: 'pkcs8', format: 'pem' }), publicKeyPem, role: 'test key' }
    }
    // The same type and size as the test key, so the phone's refusal can only mean
    // "signed by a key this app does not carry", not "a signature of an odd shape".
    if (test.asymmetricKeyType !== 'rsa') throw new Error('OTA_TEST_SIGNING_KEY_PEM must be an RSA key')
    const { modulusLength, publicExponent } = test.asymmetricKeyDetails
    const throwaway = generateKeyPairSync('rsa', { modulusLength, publicExponent: Number(publicExponent) }).privateKey
    return {
      privateKeyPem: throwaway.export({ type: 'pkcs8', format: 'pem' }),
      publicKeyPem,
      role: 'a throwaway key (tamper: the phone must refuse this bundle)',
    }
  }

  if (!store) throw new Error(`${channel} signs with OTA_SIGNING_KEY_PEM, which is not set`)
  if (!spki(store).equals(published)) {
    throw new Error(`OTA_SIGNING_KEY_PEM does not match OTA_PUBLIC_KEY; refusing to sign ${channel} with another key`)
  }
  return {
    privateKeyPem: store.export({ type: 'pkcs8', format: 'pem' }),
    publicKeyPem: createPublicKey(store).export({ type: 'spki', format: 'pem' }),
    role: 'store key',
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
if (isMain) {
  const { values } = parseArgs({
    options: {
      channel: { type: 'string' },
      out: { type: 'string' },
      tamper: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
    },
  })
  try {
    const selected = selectSigningKey({
      channel: values.channel,
      signingKeyPem: process.env.OTA_SIGNING_KEY_PEM,
      testSigningKeyPem: process.env.OTA_TEST_SIGNING_KEY_PEM,
      publishedPublicKey: process.env.OTA_PUBLIC_KEY,
      tamper: values.tamper,
    })
    const fp = fingerprint(selected.publicKeyPem)
    if (!values.check) {
      if (!values.out) throw new Error('--out <dir> is required unless --check')
      mkdirSync(values.out, { recursive: true })
      writeFileSync(path.join(values.out, 'ota-private-key.pem'), selected.privateKeyPem, { mode: 0o600 })
      writeFileSync(path.join(values.out, 'ota-public-key.pem'), selected.publicKeyPem)
    }
    console.log(
      `signing-key: channel ${values.channel} signs with the ${selected.role}; public key sha256 ${fp}${
        values.check ? ' (check only, nothing written)' : ''
      }`
    )
  } catch (error) {
    console.error(`signing-key: REFUSED: ${error.message}`)
    process.exit(1)
  }
}
