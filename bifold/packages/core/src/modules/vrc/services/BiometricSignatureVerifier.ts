/**
 * BiometricSignatureVerifier
 *
 * Thin wrapper around native verification.
 * All actual verification (X.509 chain, ECDSA signatures, public key binding,
 * attestation extension parsing) is done natively by iOS SecTrust / Android CertPathValidator.
 *
 * VERIFICATION PERFORMED NATIVELY:
 * 1. Full X.509 certificate chain validation (signatures, expiry, constraints)
 * 2. Public key extraction from leaf cert → comparison with evidence public key
 * 3. ECDSA-SHA256 signature verification (or iOS App Attest assertion verification)
 * 4. Android: Attestation extension parsing (security level, verified boot, biometric enforcement)
 * 5. Android: Google CRL revocation checking
 *
 * VERIFICATION LEVELS:
 * - cryptographic: Native verification passed (chain + signature + pubkey match)
 * - none: Verification failed
 *
 * PLATFORM ASYMMETRIES:
 * - Public key encoding: iOS uses raw 65-byte EC point, Android uses SPKI-wrapped.
 *   Native verifyHardwareEvidence normalizes both formats.
 * - Signature format: iOS sends CBOR App Attest assertions, Android sends DER ECDSA.
 *   Both are labeled 'ECDSA-SHA256' in evidence but handled differently by native code.
 */

import type { HardwareAttestationEvidence } from '../types/evidence'
import { verifyHardwareEvidence, type NativeVerificationResult } from '@bifold/react-native-attestation'

const LOG_PREFIX = '[VRC:Verify]'

export type VerificationLevel = 'cryptographic' | 'none'

export interface SignatureVerificationResult {
  valid: boolean
  details: {
    certificateChainValid: boolean
    publicKeyMatchesCert: boolean
    signatureValid: boolean
    verificationLevel: VerificationLevel
    cryptoLibraryAvailable: boolean
  }
  error?: string
  verifiedAt: string
  platform?: 'ios' | 'android'
  securityLevel?: string
  // Android attestation extension data
  attestationExtension?: {
    attestationSecurityLevel?: string
    keymasterSecurityLevel?: string
    verifiedBootState?: string
    deviceLocked?: boolean
    attestationChallengeBase64?: string
    userAuthType?: string
    authTimeout?: number
  }
  revocationChecked?: boolean
}

export class HardwareSignatureVerifier {
  private log: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void }

  constructor(logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void }) {
    this.log = logger ?? { info: console.log, warn: console.warn, error: console.error }
  }

  /**
   * Verify VRC hardware attestation evidence via native verification.
   */
  public async verifyEvidence(
    evidence: HardwareAttestationEvidence,
    vrcContent?: string
  ): Promise<SignatureVerificationResult> {
    const { platform, keyStorage } = evidence.hardwareBinding
    this.log.info(`${LOG_PREFIX} ▶ Verifying [${platform}/${keyStorage}, ${evidence.attestation.format}]`)

    const startTime = Date.now()
    const verifiedAt = new Date().toISOString()

    try {
      const nativeResult: NativeVerificationResult = await verifyHardwareEvidence(
        evidence.attestation.certificateChain,
        evidence.signature.value,
        vrcContent || '',
        evidence.hardwareBinding.publicKey,
        evidence.attestation.format,
        evidence.signature.signedContentHash
      )

      const elapsed = Date.now() - startTime
      const level: VerificationLevel = nativeResult.valid ? 'cryptographic' : 'none'

      if (nativeResult.valid) {
        this.log.info(`${LOG_PREFIX} ✓ Native verification passed [${level}] (${elapsed}ms)`)
      } else {
        this.log.warn(`${LOG_PREFIX} ✗ Native verification failed: ${nativeResult.errors?.join(', ')} (${elapsed}ms)`)
      }

      return {
        valid: nativeResult.valid,
        details: {
          certificateChainValid: nativeResult.certificateChainValid,
          publicKeyMatchesCert: nativeResult.publicKeyMatchesLeafCert,
          signatureValid: nativeResult.signatureValid,
          verificationLevel: level,
          cryptoLibraryAvailable: true, // Always true — native crypto is always available
        },
        error: nativeResult.valid ? undefined : nativeResult.errors?.join('; '),
        verifiedAt,
        platform,
        securityLevel: keyStorage,
        attestationExtension: nativeResult.attestationSecurityLevel ? {
          attestationSecurityLevel: nativeResult.attestationSecurityLevel,
          keymasterSecurityLevel: nativeResult.keymasterSecurityLevel,
          verifiedBootState: nativeResult.verifiedBootState,
          deviceLocked: nativeResult.deviceLocked,
          attestationChallengeBase64: nativeResult.attestationChallengeBase64,
          userAuthType: nativeResult.userAuthType,
          authTimeout: nativeResult.authTimeout,
        } : undefined,
        revocationChecked: nativeResult.revocationChecked,
      }
    } catch (error) {
      const elapsed = Date.now() - startTime
      const errorMsg = error instanceof Error ? error.message : String(error)
      this.log.error(`${LOG_PREFIX} ✗ Native verification error: ${errorMsg} (${elapsed}ms)`)

      return {
        valid: false,
        details: {
          certificateChainValid: false,
          publicKeyMatchesCert: false,
          signatureValid: false,
          verificationLevel: 'none',
          cryptoLibraryAvailable: true,
        },
        error: `Native verification error: ${errorMsg}`,
        verifiedAt,
        platform,
        securityLevel: keyStorage,
      }
    }
  }

  /** Quick format validation for evidence structure */
  public hasValidEvidenceFormat(evidence: HardwareAttestationEvidence): boolean {
    return Boolean(
      evidence.id &&
      Array.isArray(evidence.type) && evidence.type.length > 0 &&
      evidence.created &&
      evidence.biometricMethod?.type &&
      evidence.hardwareBinding?.publicKey &&
      evidence.signature?.value
    )
  }
}

/**
 * Extract the VRC content that was signed (removes evidence and proof blocks).
 *
 * Credo's W3C credential storage normalizes JSON-LD keys, stripping the '@'
 * prefix from '@context' → 'context'. We must restore it so the content hash
 * matches what was originally signed.
 */
function extractSignedContent(credential: Record<string, unknown>): string {
  const { evidence: _evidence, proof: _proof, ...contentWithoutEvidenceAndProof } = credential

  // Restore '@context' if Credo's toJSON() stripped the '@' prefix.
  // Rebuild the object with '@context' first to preserve the key order that
  // was present at signing time (JSON.stringify uses insertion order).
  let normalized: Record<string, unknown>
  if ('context' in contentWithoutEvidenceAndProof && !('@context' in contentWithoutEvidenceAndProof)) {
    const { context: ctxValue, ...rest } = contentWithoutEvidenceAndProof
    normalized = { '@context': ctxValue, ...rest }
  } else {
    normalized = contentWithoutEvidenceAndProof
  }

  const content = JSON.stringify(normalized)
  return content
}

/**
 * Verify hardware attestation evidence from a VRC credential.
 * @param credential - VRC with evidence array
 * @returns Verification result or null if no hardware evidence found
 */
export async function verifyVrcHardwareEvidence(
  credential: { evidence?: HardwareAttestationEvidence[] } & Record<string, unknown>
): Promise<SignatureVerificationResult | null> {
  try {
    if (!credential.evidence?.length) return null

    const hardwareEvidence = credential.evidence.find(e => e.type.includes('BiometricAttestation'))
    if (!hardwareEvidence) return null

    const signedContent = extractSignedContent(credential)
    const verifier = new HardwareSignatureVerifier()
    return verifier.verifyEvidence(hardwareEvidence, signedContent)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.warn(`${LOG_PREFIX} Verification error: ${errorMsg}`)

    return {
      valid: false,
      details: {
        certificateChainValid: false,
        publicKeyMatchesCert: false,
        signatureValid: false,
        verificationLevel: 'none',
        cryptoLibraryAvailable: true,
      },
      error: `Verification error: ${errorMsg}`,
      verifiedAt: new Date().toISOString(),
    }
  }
}
