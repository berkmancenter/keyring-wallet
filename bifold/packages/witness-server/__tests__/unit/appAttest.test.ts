/**
 * appAttest.ts tests — the iOS assertion path for locality transcripts.
 *
 * These fixtures are BUILT here with the same algorithm the module verifies,
 * so what they prove is internal consistency plus rejection of each specific
 * tampering below. They cannot prove agreement with Apple; only a capture
 * from a real device can, and the `describe.skip` at the bottom is where that
 * goes. See the module header.
 *
 * Every "wrong" case is asserted explicitly rather than relying on the happy
 * path passing, because every one of them fails *silently* — @noble/curves
 * returns false rather than throwing for a mis-derived nonce, exactly the
 * failure mode that cost a day on the Android path (locality-plan/2026-08-21-bam.md).
 */
import { createHash, randomBytes } from 'crypto'
import { p256 } from '@noble/curves/nist.js'

import {
  AUTHENTICATOR_DATA_MIN_BYTES,
  looksLikeAppAttestAssertion,
  parseAppAttestAssertion,
  parseAuthenticatorData,
  rpIdHashFor,
  verifyAppAttestAssertion,
} from '../../src/trustTasks/appAttest'

const APP_ID = 'ABCDE12345.org.keyring.wallet'
const MESSAGE = new TextEncoder().encode('{"challenge":"abc","context":"keyring-locality-v1"}')

// ------------------------------------------------------------ CBOR encoding
// Only the three forms an assertion uses. Kept here rather than in the module:
// the witness never writes CBOR, only reads it, and a test-only encoder that
// can emit malformed output on purpose is the point.

function cborByteLength(majorType: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(majorType << 5) | length])
  if (length < 0x100) return Buffer.from([(majorType << 5) | 24, length])
  return Buffer.from([(majorType << 5) | 25, length >> 8, length & 0xff])
}

function cborText(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8')
  return Buffer.concat([cborByteLength(3, bytes.length), bytes])
}

function cborBytes(value: Uint8Array): Buffer {
  return Buffer.concat([cborByteLength(2, value.length), Buffer.from(value)])
}

function cborMap(entries: [string, Uint8Array][]): Buffer {
  return Buffer.concat([
    cborByteLength(5, entries.length),
    ...entries.map(([k, v]) => Buffer.concat([cborText(k), cborBytes(v)])),
  ])
}

// ------------------------------------------------------- assertion fixtures

function makeAuthenticatorData(signCount: number, appId = APP_ID): Buffer {
  const data = Buffer.alloc(AUTHENTICATOR_DATA_MIN_BYTES)
  Buffer.from(rpIdHashFor(appId)).copy(data, 0)
  data[32] = 0x00 // flags — App Attest assertions carry no user-presence bits
  data.writeUInt32BE(signCount, 33)
  return data
}

/**
 * The exact three steps `DCAppAttestService` performs: hash the client data,
 * prepend the authenticator data, hash again, sign THAT. Written out here so
 * a future reader can see the algorithm being asserted rather than trusting
 * the module's own copy of it.
 */
function signAssertion(privateKey: Uint8Array, message: Uint8Array, authenticatorData: Buffer): Buffer {
  const clientDataHash = createHash('sha256').update(Buffer.from(message)).digest()
  const nonce = createHash('sha256').update(authenticatorData).update(clientDataHash).digest()
  const signature = p256.sign(createHash('sha256').update(nonce).digest(), privateKey, {
    format: 'der',
    prehash: false,
  })
  return Buffer.from(signature)
}

function makeAssertion(
  privateKey: Uint8Array,
  message: Uint8Array = MESSAGE,
  { signCount = 1, appId = APP_ID }: { signCount?: number; appId?: string } = {}
): Buffer {
  const authenticatorData = makeAuthenticatorData(signCount, appId)
  return cborMap([
    ['signature', signAssertion(privateKey, message, authenticatorData)],
    ['authenticatorData', authenticatorData],
  ])
}

// ------------------------------------------------------------------- sniffing

describe('looksLikeAppAttestAssertion', () => {
  test('recognises a CBOR assertion', () => {
    expect(looksLikeAppAttestAssertion(makeAssertion(randomBytes(32)))).toBe(true)
  })

  test('does NOT claim a DER ECDSA signature — the Android shape must keep its own path', () => {
    const der = p256.sign(createHash('sha256').update('anything').digest(), randomBytes(32), {
      format: 'der',
      prehash: false,
    })
    expect(der[0]).toBe(0x30) // SEQUENCE, the thing that must never look like a map
    expect(looksLikeAppAttestAssertion(der)).toBe(false)
  })

  test('empty input is not an assertion', () => {
    expect(looksLikeAppAttestAssertion(new Uint8Array(0))).toBe(false)
  })
})

// -------------------------------------------------------------------- parsing

describe('parseAppAttestAssertion', () => {
  const privateKey = randomBytes(32)

  test('reads both members', () => {
    const parsed = parseAppAttestAssertion(makeAssertion(privateKey))
    expect(parsed).toBeDefined()
    expect(parsed!.authenticatorData.length).toBe(AUTHENTICATOR_DATA_MIN_BYTES)
    expect(parsed!.signature.length).toBeGreaterThan(8)
  })

  test('key order is not assumed — CBOR maps are unordered and Apple documents members, not ordering', () => {
    const authenticatorData = makeAuthenticatorData(1)
    const signature = signAssertion(privateKey, MESSAGE, authenticatorData)
    const reversed = cborMap([
      ['authenticatorData', authenticatorData],
      ['signature', signature],
    ])
    const parsed = parseAppAttestAssertion(reversed)
    expect(Buffer.from(parsed!.signature).equals(signature)).toBe(true)
  })

  test('an unknown extra member is skipped, not rejected — a future iOS may add one', () => {
    const authenticatorData = makeAuthenticatorData(1)
    const withExtra = cborMap([
      ['signature', signAssertion(privateKey, MESSAGE, authenticatorData)],
      ['somethingNew', Buffer.from([1, 2, 3])],
      ['authenticatorData', authenticatorData],
    ])
    expect(parseAppAttestAssertion(withExtra)).toBeDefined()
  })

  test('a map missing authenticatorData is undefined, not a half-built assertion', () => {
    const partial = cborMap([['signature', Buffer.from([1, 2, 3])]])
    expect(parseAppAttestAssertion(partial)).toBeUndefined()
  })

  test('truncated input returns undefined rather than throwing', () => {
    const full = makeAssertion(privateKey)
    expect(parseAppAttestAssertion(full.subarray(0, full.length - 10))).toBeUndefined()
  })

  test('a byte string that declares more than it carries returns undefined', () => {
    // Map of 1: "signature" => byte string claiming 200 bytes, carrying 2.
    const lying = Buffer.concat([
      cborByteLength(5, 1),
      cborText('signature'),
      Buffer.from([(2 << 5) | 24, 200]),
      Buffer.from([0xaa, 0xbb]),
    ])
    expect(parseAppAttestAssertion(lying)).toBeUndefined()
  })

  test('the indefinite-length form is rejected — this reader is deliberately strict', () => {
    const indefinite = Buffer.concat([Buffer.from([0xbf]), cborText('signature'), cborBytes(Buffer.from([1]))])
    expect(parseAppAttestAssertion(indefinite)).toBeUndefined()
  })

  test('a DER signature handed here by mistake returns undefined rather than throwing', () => {
    const der = p256.sign(createHash('sha256').update('x').digest(), privateKey, { format: 'der', prehash: false })
    expect(parseAppAttestAssertion(der)).toBeUndefined()
  })
})

// --------------------------------------------------------- authenticator data

describe('parseAuthenticatorData', () => {
  test('reads the RP ID hash, flags and big-endian counter', () => {
    const parsed = parseAuthenticatorData(makeAuthenticatorData(258))
    expect(parsed!.signCount).toBe(258) // 0x00000102 — catches a little-endian read
    expect(parsed!.flags).toBe(0)
    expect(Buffer.from(parsed!.rpIdHash).equals(Buffer.from(rpIdHashFor(APP_ID)))).toBe(true)
  })

  test('anything shorter than the fixed 37-byte prefix is undefined', () => {
    expect(parseAuthenticatorData(new Uint8Array(AUTHENTICATOR_DATA_MIN_BYTES - 1))).toBeUndefined()
  })
})

// --------------------------------------------------------------- verification

describe('verifyAppAttestAssertion', () => {
  const privateKey = randomBytes(32)
  const publicKey = p256.getPublicKey(privateKey, false)

  function parse(bytes: Uint8Array) {
    return parseAppAttestAssertion(bytes)!
  }

  test('a genuine assertion over the binding verifies, and reports the counter', () => {
    const verdict = verifyAppAttestAssertion(parse(makeAssertion(privateKey, MESSAGE, { signCount: 7 })), MESSAGE, publicKey)
    expect(verdict).toEqual({ ok: true, signCount: 7 })
  })

  test('a different message fails — this is the replay defence the ceremony leans on', () => {
    const assertion = parse(makeAssertion(privateKey, MESSAGE))
    const otherBinding = new TextEncoder().encode('{"challenge":"different"}')
    expect(verifyAppAttestAssertion(assertion, otherBinding, publicKey)).toEqual({
      ok: false,
      reason: 'assertionSignatureInvalid',
    })
  })

  test('a different key fails', () => {
    const assertion = parse(makeAssertion(privateKey, MESSAGE))
    const strangerKey = p256.getPublicKey(randomBytes(32), false)
    expect(verifyAppAttestAssertion(assertion, MESSAGE, strangerKey)).toEqual({
      ok: false,
      reason: 'assertionSignatureInvalid',
    })
  })

  test('tampering with authenticatorData fails — it is inside the signed nonce, not beside it', () => {
    const assertion = parse(makeAssertion(privateKey, MESSAGE, { signCount: 1 }))
    const bumped = Uint8Array.from(assertion.authenticatorData)
    bumped[36] = 0x09 // rewrite the counter and nothing else
    expect(verifyAppAttestAssertion({ ...assertion, authenticatorData: bumped }, MESSAGE, publicKey)).toEqual({
      ok: false,
      reason: 'assertionSignatureInvalid',
    })
  })

  test('authenticatorData too short is reported as malformed, not as a bad signature', () => {
    const assertion = parse(makeAssertion(privateKey, MESSAGE))
    const stub = { ...assertion, authenticatorData: new Uint8Array(10) }
    expect(verifyAppAttestAssertion(stub, MESSAGE, publicKey)).toEqual({ ok: false, reason: 'malformedAuthenticatorData' })
  })

  describe('appId pinning', () => {
    test('the matching app id passes', () => {
      const assertion = parse(makeAssertion(privateKey, MESSAGE))
      expect(verifyAppAttestAssertion(assertion, MESSAGE, publicKey, { appId: APP_ID })).toMatchObject({ ok: true })
    })

    test('an assertion from a different app is rejected before the signature is even checked', () => {
      const assertion = parse(makeAssertion(privateKey, MESSAGE, { appId: 'ZZZZZ99999.com.someone.else' }))
      expect(verifyAppAttestAssertion(assertion, MESSAGE, publicKey, { appId: APP_ID })).toEqual({
        ok: false,
        reason: 'appIdMismatch',
      })
    })

    test('omitting appId skips the check rather than failing closed — the documented default', () => {
      const assertion = parse(makeAssertion(privateKey, MESSAGE, { appId: 'ZZZZZ99999.com.someone.else' }))
      expect(verifyAppAttestAssertion(assertion, MESSAGE, publicKey)).toMatchObject({ ok: true })
    })
  })

  describe('sign counter', () => {
    test('a counter that advanced passes', () => {
      const assertion = parse(makeAssertion(privateKey, MESSAGE, { signCount: 5 }))
      expect(verifyAppAttestAssertion(assertion, MESSAGE, publicKey, { lastSignCount: 4 })).toEqual({
        ok: true,
        signCount: 5,
      })
    })

    test('a replayed counter is rejected when the caller tracks state', () => {
      const assertion = parse(makeAssertion(privateKey, MESSAGE, { signCount: 5 }))
      expect(verifyAppAttestAssertion(assertion, MESSAGE, publicKey, { lastSignCount: 5 })).toEqual({
        ok: false,
        reason: 'signCountNotAdvanced',
      })
    })
  })
})

/**
 * Fill this in from a real device run and delete the `.skip`. Capture the
 * base64url `signature` and base64 `devicePublicKey` a real iPhone puts on
 * the GATT characteristic, plus the exact binding the witness computed for
 * that session, and paste them as literals — the way
 * `locality.test.ts`'s own `REAL_CAPTURE` block does for Android, which is
 * what caught the two bugs the synthetic fixtures could not.
 *
 * Until this exists, the iOS path is verified against its own understanding
 * of Apple's format and nothing else.
 */
describe.skip('verifyAppAttestAssertion against a real on-device capture', () => {
  test('a genuine iPhone assertion verifies', () => {
    expect(true).toBe(false)
  })
})
