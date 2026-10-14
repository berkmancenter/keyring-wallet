/**
 * Hardware evidence must be checked against the content the verifier holds.
 *
 * A hardware signature is only worth anything if it covers **what the verifier
 * is about to show someone**. The evidence carries its own `signedContentHash`,
 * but that value arrives from whoever presented the evidence, so it cannot be
 * the thing the signature is checked against: a signature that is genuinely
 * valid over some other content would then verify against content it never
 * covered.
 *
 * So the rule these tests pin is simple and absolute: **the verifier hashes the
 * content it holds, and a presented hash that disagrees makes the evidence
 * invalid.** Native is not asked, because there is nothing it could usefully be
 * asked — the question would already be the wrong one.
 *
 * Written before the fix and expected to fail on the code as it stands; kept
 * afterwards so the behaviour cannot quietly return.
 */
// `@noble/hashes`, not node's `crypto`: a guard in this package checks that
// nothing under hardware-signing/ reaches for a Node built-in, because the
// directory has to run on React Native. The first draft of this file used
// `crypto` and that guard caught it.
import { sha256 } from '@noble/hashes/sha2.js'

// `mock`-prefixed because jest hoists the factory above everything else in the
// file; a plainly-named variable is still uninitialised when it runs.
const mockVerifyHardwareEvidence = jest.fn()
jest.mock('@bifold/react-native-attestation', () => ({
  verifyHardwareEvidence: (...args: unknown[]) => mockVerifyHardwareEvidence(...args),
}))

import { HardwareSignatureVerifier } from './verify'
import type { HardwareAttestationEvidence } from './types'

const CONTENT = '{"the":"content the verifier holds and will show"}'
const OTHER = '{"the":"content a signature was really made over"}'

const hashOf = (s: string) => btoa(String.fromCharCode(...sha256(new TextEncoder().encode(s))))

const evidenceWith = (hash: string): HardwareAttestationEvidence =>
  ({
    hardwareBinding: { platform: 'ios', keyStorage: 'secureEnclave', publicKey: 'zPub' },
    attestation: { format: 'apple-appattest-v1', certificateChain: ['cert'] },
    signature: { value: 'zSig', signedContentHash: hash },
  }) as unknown as HardwareAttestationEvidence

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined }

beforeEach(() => {
  jest.clearAllMocks()
  // Native says yes to everything. That is the point: these tests are about
  // what the TypeScript layer refuses to ask it in the first place.
  mockVerifyHardwareEvidence.mockResolvedValue({ valid: true, errors: [] })
})

describe('evidence whose presented hash does not match the content', () => {
  it('is invalid', async () => {
    const verifier = new HardwareSignatureVerifier(quiet)
    const result = await verifier.verifyEvidence(evidenceWith(hashOf(OTHER)), CONTENT)
    expect(result.valid).toBe(false)
  })

  it('is refused without asking native, because the question would be the wrong one', async () => {
    const verifier = new HardwareSignatureVerifier(quiet)
    await verifier.verifyEvidence(evidenceWith(hashOf(OTHER)), CONTENT)
    expect(mockVerifyHardwareEvidence).not.toHaveBeenCalled()
  })
})

describe('evidence whose presented hash matches the content', () => {
  it('is passed to native for the cryptographic check', async () => {
    const verifier = new HardwareSignatureVerifier(quiet)
    const result = await verifier.verifyEvidence(evidenceWith(hashOf(CONTENT)), CONTENT)
    expect(mockVerifyHardwareEvidence).toHaveBeenCalled()
    expect(result.valid).toBe(true)
  })

  it('gives native the hash the verifier computed, never the one it was handed', async () => {
    // Even when the two agree today, the computed value is the one that must
    // travel: taking the presented one would leave the trust in the wrong place
    // and the next change could separate them again.
    const verifier = new HardwareSignatureVerifier(quiet)
    await verifier.verifyEvidence(evidenceWith(hashOf(CONTENT)), CONTENT)
    const args = mockVerifyHardwareEvidence.mock.calls[0]
    expect(args).toEqual(expect.arrayContaining([hashOf(CONTENT)]))
  })
})

describe('evidence presented with no content to check it against', () => {
  it('is invalid rather than trusted', async () => {
    // There is nothing to bind the signature to, so there is no verification to
    // be had — and an empty string must not be treated as content.
    const verifier = new HardwareSignatureVerifier(quiet)
    const result = await verifier.verifyEvidence(evidenceWith(hashOf(CONTENT)), '')
    expect(result.valid).toBe(false)
    expect(mockVerifyHardwareEvidence).not.toHaveBeenCalled()
  })
})
