/**
 * G33 Stage 1: the verifier always recomputes the signed content hash.
 *
 * The native module is mocked. The natives' own gate is proven by
 * `ContentBindingTest.kt` (JUnit); the iOS native path only on a device.
 */

import crypto from 'crypto'

const mockVerifyHardwareEvidence = jest.fn()
jest.mock('@bifold/react-native-attestation', () => ({
  verifyHardwareEvidence: (...args: unknown[]) => mockVerifyHardwareEvidence(...args),
}))

import {
  CONTENT_BINDING_MISMATCH,
  checkEmbeddedContentHash,
  contentHashBase64,
} from '../../src/hardware-signing/binding'
import { HardwareSignatureVerifier, verifySignedPayload } from '../../src/hardware-signing/verify'
import type { HardwareAttestationEvidence, SignedPayloadAttestation } from '../../src/hardware-signing/types'
import { verifyVrcHardwareEvidence } from '../../src/modules/vrc/services/BiometricSignatureVerifier'

const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }

const evidenceWith = (signedContentHash?: string): HardwareAttestationEvidence => ({
  id: 'urn:uuid:e',
  type: ['BiometricAttestation', 'HardwareKeyAttestation'],
  created: '2025-01-23T12:00:00.000Z',
  biometricMethod: { type: 'FaceID', authenticatorType: 'platform', userVerification: 'required' },
  hardwareBinding: {
    keyStorage: 'SecureEnclave',
    platform: 'ios',
    keyType: 'EC-P256',
    algorithm: 'ECDSA-SHA256',
    publicKey: 'cHVia2V5',
  },
  attestation: { format: 'apple-appattest-v1', certificateChain: ['c1', 'c2'] },
  signature: { value: 'c2ln', algorithm: 'ECDSA-SHA256', ...(signedContentHash ? { signedContentHash } : {}) },
})

const nativeOk = {
  valid: true,
  certificateChainValid: true,
  publicKeyMatchesLeafCert: true,
  signatureValid: true,
}

const credX = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiableCredential'],
  issuer: 'did:peer:x',
  credentialSubject: { id: 'did:peer:s' },
}
const credY = { ...credX, credentialSubject: { id: 'did:peer:other' } }

// The signer's bytes, as extractSignedContent rebuilds them (no evidence, no proof).
const signedBytes = (c: object) => JSON.stringify(c)

describe('contentHashBase64', () => {
  it.each(['', 'abc', 'é€😀 {"a":1}', 'x'.repeat(1000)])('equals node SHA-256 for %j', (s) => {
    expect(contentHashBase64(s)).toBe(crypto.createHash('sha256').update(s, 'utf8').digest('base64'))
  })
})

describe('checkEmbeddedContentHash', () => {
  it('accepts an absent or empty embedded hash and a matching one', () => {
    expect(checkEmbeddedContentHash(evidenceWith(), 'c')).toEqual({ ok: true })
    expect(checkEmbeddedContentHash(evidenceWith(contentHashBase64('c')), 'c')).toEqual({ ok: true })
  })
  it('rejects a differing one with the stable prefix', () => {
    const r = checkEmbeddedContentHash(evidenceWith(contentHashBase64('other')), 'c')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error.startsWith(CONTENT_BINDING_MISMATCH)).toBe(true)
  })
})

describe('HardwareSignatureVerifier content binding (G33 Stage 1)', () => {
  const verifier = new HardwareSignatureVerifier(silent)
  beforeEach(() => mockVerifyHardwareEvidence.mockReset())

  it('U1: genuine evidence verifies and native receives the computed hash', async () => {
    mockVerifyHardwareEvidence.mockResolvedValue(nativeOk)
    const content = signedBytes(credX)
    const result = await verifier.verifyEvidence(evidenceWith(contentHashBase64(content)), content)
    expect(result.valid).toBe(true)
    expect(mockVerifyHardwareEvidence.mock.calls[0][5]).toBe(contentHashBase64(content))
  })

  it('U2: a body tampered after signing is a contentBindingMismatch and native is not called', async () => {
    const original = signedBytes(credX)
    const tampered = signedBytes({ ...credX, issuer: 'did:peer:attacker' })
    const result = await verifier.verifyEvidence(evidenceWith(contentHashBase64(original)), tampered)
    expect(result.valid).toBe(false)
    expect(result.details.signatureValid).toBe(false)
    expect(result.error).toMatch(new RegExp(`^${CONTENT_BINDING_MISMATCH}`))
    expect(mockVerifyHardwareEvidence).not.toHaveBeenCalled()
  })

  it('U3: an embedded hash swapped for the hash of other content is a mismatch', async () => {
    const result = await verifier.verifyEvidence(evidenceWith(contentHashBase64('something else')), signedBytes(credX))
    expect(result.valid).toBe(false)
    expect(result.error).toContain(CONTENT_BINDING_MISMATCH)
    expect(mockVerifyHardwareEvidence).not.toHaveBeenCalled()
  })

  it('U4: an absent embedded hash still gets the computed hash', async () => {
    mockVerifyHardwareEvidence.mockResolvedValue(nativeOk)
    const content = signedBytes(credX)
    await verifier.verifyEvidence(evidenceWith(), content)
    expect(mockVerifyHardwareEvidence.mock.calls[0][5]).toBe(contentHashBase64(content))
  })

  it('U5: empty or missing signedContent is invalid without calling native', async () => {
    for (const content of ['', undefined as unknown as string]) {
      const result = await verifier.verifyEvidence(evidenceWith(), content)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('signedContent is required')
    }
    expect(mockVerifyHardwareEvidence).not.toHaveBeenCalled()
  })

  it('U6: verifySignedPayload rejects a payload other than the one signed', async () => {
    const attestation = {
      payload: 'a different challenge',
      payloadHash: contentHashBase64('the challenge that was signed'),
      signedAt: new Date().toISOString(),
      evidence: evidenceWith(contentHashBase64('the challenge that was signed')),
    } as unknown as SignedPayloadAttestation
    const result = await verifySignedPayload(attestation, silent)
    expect(result.valid).toBe(false)
    expect(result.error).toContain(CONTENT_BINDING_MISMATCH)
    expect(mockVerifyHardwareEvidence).not.toHaveBeenCalled()
  })

  it('U7: evidence from credential X attached to credential Y is a mismatch', async () => {
    const evidenceOfX = evidenceWith(contentHashBase64(signedBytes(credX)))
    const result = await verifyVrcHardwareEvidence({ ...credY, evidence: [evidenceOfX] } as never)
    expect(result?.valid).toBe(false)
    expect(result?.error).toContain(CONTENT_BINDING_MISMATCH)
    expect(mockVerifyHardwareEvidence).not.toHaveBeenCalled()
  })

  it('U7b: the same evidence on its own credential verifies', async () => {
    mockVerifyHardwareEvidence.mockResolvedValue(nativeOk)
    const evidenceOfX = evidenceWith(contentHashBase64(signedBytes(credX)))
    const result = await verifyVrcHardwareEvidence({ ...credX, evidence: [evidenceOfX] } as never)
    expect(result?.valid).toBe(true)
  })

  it('U8: reordered top-level keys fail under the legacy (insertion-order) scheme', async () => {
    const evidenceOfX = evidenceWith(contentHashBase64(signedBytes(credX)))
    const reordered = {
      credentialSubject: credX.credentialSubject,
      issuer: credX.issuer,
      type: credX.type,
      '@context': credX['@context'],
    }
    const result = await verifyVrcHardwareEvidence({ ...reordered, evidence: [evidenceOfX] } as never)
    expect(result?.valid).toBe(false)
    expect(result?.error).toContain(CONTENT_BINDING_MISMATCH)
  })

  it('maps a native contentBindingMismatch error to signatureValid: false', async () => {
    mockVerifyHardwareEvidence.mockResolvedValue({
      ...nativeOk,
      valid: false,
      errors: [`${CONTENT_BINDING_MISMATCH}: supplied content hash does not equal SHA-256 of the signed content`],
    })
    const result = await verifier.verifyEvidence(evidenceWith(), signedBytes(credX))
    expect(result.valid).toBe(false)
    expect(result.details.signatureValid).toBe(false)
    expect(result.error).toContain(CONTENT_BINDING_MISMATCH)
  })
})
