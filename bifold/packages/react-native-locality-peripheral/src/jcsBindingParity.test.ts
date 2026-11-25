/**
 * Cross-language parity for the one algorithm that exists four times.
 *
 * The five-value JCS binding is duplicated on purpose — `deviceLocality.ts`
 * (wallet), `witness-server/src/trustTasks/locality.ts` (witness),
 * `LocalityPeripheralModule.kt` (Android) and `LocalityPeripheral.swift`
 * (iOS) — because only the native side ever learns `sensorNonce`, so only
 * the native side can assemble the binding once it arrives. Both native
 * copies hand-write the canonical JSON rather than canonicalizing at
 * runtime, and both carry a comment claiming the key order was "checked
 * against the frozen fixture, not just eyeballed".
 *
 * Nothing checked it. This does.
 *
 * The failure it exists to catch is quiet and expensive: one reordered or
 * renamed key produces a signature the witness rejects with
 * `transcriptSignatureInvalid` and no hint as to why — the same shape as a
 * genuine attack, on a path that only runs on real hardware in a room with
 * two people in it. A source-level assertion is worth having precisely
 * because the runtime one is so awkward to reach.
 *
 * This reads the native sources as text. That is the point: it is asserting
 * something about files no JS test would otherwise touch, and it fails if
 * someone edits the literal in either file without editing the other.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * RFC 8785 orders object keys by their UTF-16 code units, which for these
 * five plain-ASCII names is plain lexicographic order. Written out here as
 * the expected constant rather than computed, so the test states the
 * contract instead of re-deriving it from one of the implementations it is
 * meant to be checking.
 */
const CANONICAL_BINDING_KEYS = ['challenge', 'context', 'sensorDid', 'sensorNonce', 'taskDigestMultibase']

/** Everything except `devicePublicKey`/`signature`, in the order the wire expects. */
const CORE_TRANSCRIPT_KEYS = [
  'method',
  'taskDigestMultibase',
  'challenge',
  'sensorNonce',
  'sensorDid',
  'hardwareAttestation',
]

const SIGNATURE_TRANSCRIPT_KEYS = ['devicePublicKey', 'signature']

const KOTLIN = readFileSync(
  join(__dirname, '..', 'android', 'src', 'main', 'java', 'com', 'localityperipheral', 'LocalityPeripheralModule.kt'),
  'utf8'
)
const SWIFT = readFileSync(join(__dirname, '..', 'ios', 'LocalityPeripheral.swift'), 'utf8')

/**
 * Pull the JSON keys out of a hand-written concatenation in either language.
 * Both build their literal the same way — `"\"key\":..."` in Kotlin,
 * `"\"key\":\(...)"` in Swift — so one escaped-quote pattern covers both.
 * Scoped to the body of the named function so the three literals in each
 * file do not bleed into one another.
 */
function jsonKeysInFunction(source: string, functionName: string): string[] {
  const start = source.indexOf(functionName)
  expect(start).toBeGreaterThan(-1)
  // Up to the next `{"` literal opener after this one, or a generous window —
  // each of these functions is a single `return "{" + ... + "}"` expression.
  const body = source.slice(start, start + 1400)
  const opener = body.indexOf('"{"')
  expect(opener).toBeGreaterThan(-1)
  const closer = body.indexOf('"}"', opener)
  expect(closer).toBeGreaterThan(-1)
  const literal = body.slice(opener, closer)
  return Array.from(literal.matchAll(/\\"([A-Za-z]+)\\":/g)).map((m) => m[1] ?? '')
}

describe('the JCS binding is byte-identical across all four implementations', () => {
  test('the Kotlin copy uses the canonical key order', () => {
    expect(jsonKeysInFunction(KOTLIN, 'private fun jcsBinding')).toEqual(CANONICAL_BINDING_KEYS)
  })

  test('the Swift copy uses the canonical key order', () => {
    expect(jsonKeysInFunction(SWIFT, 'private static func jcsBinding')).toEqual(CANONICAL_BINDING_KEYS)
  })

  test('and the two native copies agree with each other', () => {
    expect(jsonKeysInFunction(SWIFT, 'private static func jcsBinding')).toEqual(
      jsonKeysInFunction(KOTLIN, 'private fun jcsBinding')
    )
  })

  test('the canonical order really is what RFC 8785 produces for these five keys', () => {
    // Guards the constant itself: if someone "fixes" it to the struct order
    // the wallet writes them in, this fails rather than silently blessing it.
    expect([...CANONICAL_BINDING_KEYS].sort()).toEqual(CANONICAL_BINDING_KEYS)
  })
})

describe('the transcript halves are identical across both native implementations', () => {
  test('the core half carries the same fields in the same order', () => {
    expect(jsonKeysInFunction(SWIFT, 'private static func coreTranscriptJson')).toEqual(CORE_TRANSCRIPT_KEYS)
    expect(jsonKeysInFunction(KOTLIN, 'private fun coreTranscriptJson')).toEqual(CORE_TRANSCRIPT_KEYS)
  })

  test('the signature half carries the same fields in the same order', () => {
    expect(jsonKeysInFunction(SWIFT, 'private static func signatureTranscriptJson')).toEqual(SIGNATURE_TRANSCRIPT_KEYS)
    expect(jsonKeysInFunction(KOTLIN, 'private fun signatureTranscriptJson')).toEqual(SIGNATURE_TRANSCRIPT_KEYS)
  })

  test('the two halves do not overlap and together form the whole LocalityTranscript', () => {
    // witness-server merges these two objects into one `LocalityTranscript`;
    // a field appearing in both, or in neither, breaks that merge.
    const overlap = CORE_TRANSCRIPT_KEYS.filter((k) => SIGNATURE_TRANSCRIPT_KEYS.includes(k))
    expect(overlap).toEqual([])
    expect([...CORE_TRANSCRIPT_KEYS, ...SIGNATURE_TRANSCRIPT_KEYS].sort()).toEqual(
      [
        'challenge',
        'devicePublicKey',
        'hardwareAttestation',
        'method',
        'sensorDid',
        'sensorNonce',
        'signature',
        'taskDigestMultibase',
      ].sort()
    )
  })
})

describe('the iOS keychain coordinates match the ones react-native-attestation writes', () => {
  /**
   * The load-bearing coupling described in `LocalityPeripheral.swift`'s own
   * comment: reading a different keychain item would mean signing with a
   * different key than the VRC evidence commits to, and
   * `transcriptKeyMatchesVrcSigner` would report false on every ceremony
   * while everything else looked healthy.
   */
  const ATTESTATION_MM = join(__dirname, '..', '..', 'react-native-attestation', 'ios', 'Attestation.mm')

  test('service name and both account suffixes are the same strings on both sides', () => {
    const attestation = readFileSync(ATTESTATION_MM, 'utf8')
    for (const literal of ['AriesAttestation', '.AttestationKey', '.AppAttestPublicKey']) {
      expect(attestation).toContain(`"${literal}"`)
      expect(SWIFT).toContain(`"${literal}"`)
    }
  })
})
