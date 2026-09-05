/**
 * W3C VC Evidence Types for VRC Hardware Attestation
 *
 * The evidence block itself describes a device key and a signature, not a
 * credential, so its types now live in `src/hardware-signing/types.ts` where a
 * non-VRC caller can reach them without importing the VRC module. They are
 * re-exported here so existing `../types/evidence` imports keep working.
 *
 * Based on W3C VC Data Model 1.1 Section 5.7 Evidence:
 * https://www.w3.org/TR/vc-data-model-1.1/#evidence
 *
 * @module vrc/types/evidence
 */

import type { HardwareAttestationEvidence } from '../../../hardware-signing'

export type {
  AuthenticationMethodType,
  BiometricMethod,
  AuthenticationMethod,
  HardwareBinding,
  AttestationCertificateChain,
  HardwareSignature,
  EvidenceTypeArray,
  HardwareAttestationEvidence,
  BuildEvidenceInput,
} from '../../../hardware-signing'

/**
 * VRC credential structure with evidence
 */
export interface VrcCredentialWithEvidence {
  '@context': string[]
  type: string[]
  issuer: {
    id: string
    name: string
    email?: string
    organization?: string
  }
  issuanceDate: string
  validFrom: string
  credentialSubject: {
    id: string
  }
  /** W3C evidence block containing hardware attestation */
  evidence: HardwareAttestationEvidence[]
}
