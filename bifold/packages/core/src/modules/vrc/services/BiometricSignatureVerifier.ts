/**
 * BiometricSignatureVerifier — the VRC-shaped view of hardware evidence
 * verification.
 *
 * The verifier itself was always Credo-free and now lives in
 * `src/hardware-signing/verify.ts`, where a relying party can use it without
 * pulling in an agent framework. It is re-exported here so every existing
 * import path keeps working.
 *
 * What stays VRC-specific, and therefore stays here, is
 * `verifyVrcHardwareEvidence`: finding the hardware evidence inside a
 * credential's `evidence` array and reconstructing the exact content that was
 * signed by stripping the `evidence`/`proof` blocks and undoing Credo's
 * JSON-LD key normalisation.
 */

import type { HardwareAttestationEvidence } from '../types/evidence'
import { HardwareSignatureVerifier } from '../../../hardware-signing'
import type { SignatureVerificationResult, VerificationLevel } from '../../../hardware-signing'

export { HardwareSignatureVerifier }
export type { SignatureVerificationResult, VerificationLevel }

const LOG_PREFIX = '[VRC:Verify]'

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

    const hardwareEvidence = credential.evidence.find(
      (e) =>
        (e.type as readonly string[]).includes('BiometricAttestation') ||
        (e.type as readonly string[]).includes('DeviceAuthentication')
    )
    if (!hardwareEvidence) return null

    const signedContent = extractSignedContent(credential)
    const verifier = new HardwareSignatureVerifier()
    return verifier.verifyEvidence(hardwareEvidence, signedContent)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    // eslint-disable-next-line no-console
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
