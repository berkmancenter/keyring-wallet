/**
 * Hardware evidence verification.
 *
 * Thin wrapper around native verification.
 * All actual verification (X.509 chain, ECDSA signatures, public key binding,
 * attestation extension parsing) is done natively by iOS SecTrust / Android
 * CertPathValidator.
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
 *
 * Moved verbatim from `modules/vrc/services/BiometricSignatureVerifier.ts`,
 * which was already Credo-free. That file keeps the VRC-shaped convenience
 * wrapper (`verifyVrcHardwareEvidence`) and re-exports this class.
 *
 * @module hardware-signing/verify
 */

import { verifyHardwareEvidence, type NativeVerificationResult } from '@bifold/react-native-attestation'

import type { HardwareAttestationEvidence, HardwareSigningLogger, SignedPayloadAttestation } from './types'

const LOG_PREFIX = '[HW:Verify]'

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
  private log: HardwareSigningLogger

  constructor(logger?: HardwareSigningLogger) {
    // eslint-disable-next-line no-console
    this.log = logger ?? { info: console.log, warn: console.warn, error: console.error }
  }

  /**
   * Verify hardware attestation evidence via native verification.
   *
   * @param signedContent - the exact string the signature was produced over
   */
  public async verifyEvidence(
    evidence: HardwareAttestationEvidence,
    signedContent?: string
  ): Promise<SignatureVerificationResult> {
    const { platform, keyStorage } = evidence.hardwareBinding
    this.log.info(`${LOG_PREFIX} ▶ Verifying [${platform}/${keyStorage}, ${evidence.attestation.format}]`)

    const startTime = Date.now()
    const verifiedAt = new Date().toISOString()

    try {
      const nativeResult: NativeVerificationResult = await verifyHardwareEvidence(
        evidence.attestation.certificateChain,
        evidence.signature.value,
        signedContent || '',
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
        attestationExtension: nativeResult.attestationSecurityLevel
          ? {
              attestationSecurityLevel: nativeResult.attestationSecurityLevel,
              keymasterSecurityLevel: nativeResult.keymasterSecurityLevel,
              verifiedBootState: nativeResult.verifiedBootState,
              deviceLocked: nativeResult.deviceLocked,
              attestationChallengeBase64: nativeResult.attestationChallengeBase64,
              userAuthType: nativeResult.userAuthType,
              authTimeout: nativeResult.authTimeout,
            }
          : undefined,
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
    const hasAuthMethod = Boolean(evidence.authenticationMethod?.type || evidence.biometricMethod?.type)
    return Boolean(
      evidence.id &&
        Array.isArray(evidence.type) &&
        evidence.type.length > 0 &&
        evidence.created &&
        hasAuthMethod &&
        evidence.hardwareBinding?.publicKey &&
        evidence.signature?.value
    )
  }
}

/**
 * Verify a self-contained {@link SignedPayloadAttestation}.
 *
 * Everything needed is inside the object, so a relying party can check one
 * without holding the original challenge — though it should still confirm that
 * `attestation.payload` is the challenge it issued.
 */
export async function verifySignedPayload(
  attestation: SignedPayloadAttestation,
  logger?: HardwareSigningLogger
): Promise<SignatureVerificationResult> {
  const verifier = new HardwareSignatureVerifier(logger)
  return verifier.verifyEvidence(attestation.evidence, attestation.payload)
}
