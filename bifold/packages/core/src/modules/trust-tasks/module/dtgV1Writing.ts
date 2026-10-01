/**
 * Writing DTG Credentials v1 (228): what Keyring ISSUES in the new shape, behind
 * a flag that is OFF. Reading both shapes is always on; writing flips only when
 * the communities a Keyring vetter serves have moved (upstream cut over with no
 * dual acceptance: an openvtc applicant on VTI 0.47 / openvtc e165bd55 refuses
 * the old shape, and one before it refuses the new).
 *
 * The vetted/1 statement follows what an openvtc applicant requires (vta-sdk
 * 0.58 `verify_statement`, dtg-credentials 0.12.0), which is stricter than
 * Keyring's own reader:
 * - `@context` exactly [VCDM 2.0, registry v1], in that order (`check_context`);
 * - `type` exactly [VerifiableCredential, DTGCredential, StatementCredential]:
 *   one concrete DTG subtype;
 * - `issuerScope` `directed` (the profile's minimum; Keyring declares no wider);
 * - `id`, `taskContext` and `taskDigestMultibase` (all MUST, tf vetting/session
 *   0.1 as recast by #691);
 * - `credentialSubject.object.value` carries ONLY the registry vetted/1 members
 *   (`deny_unknown_fields`): no `type`, nothing else;
 * - one Data Integrity proof for `assertionMethod` by the issuer (the default
 *   of `signDocumentProof`).
 */
import { DTG_REGISTRY_CONTEXT_V1, VETTED_V1_PREDICATE } from '@bifold/trust-tasks'

const VC_CONTEXT_V2 = 'https://www.w3.org/ns/credentials/v2'

let dtgV1WritingEnabled = false

/** Write DTG Credentials v1 shapes (vetted/1 statements). OFF unless set. */
export function setDtgV1WritingEnabled(enabled: boolean): void {
  dtgV1WritingEnabled = enabled
}

export function isDtgV1WritingEnabled(): boolean {
  return dtgV1WritingEnabled
}

/** The registry vetted/1 `object.value`: these members and no others. */
export interface VettedV1Attestation {
  community: string
  method: string
  documentClasses: string[]
  claimsVerified: string[]
  livenessConfirmed: boolean
  identityCommitment: string
  cardDigestMultibase: string
  declaredRelationship: string
  attestationTextDigest?: string
}

/** An unsigned vetted/1 statement, to sign with `signDocumentProof` (assertionMethod). */
export function vettedV1Statement(input: {
  id: string
  issuer: string
  subject: string
  validFrom: string
  validUntil: string
  taskContext: string
  taskDigestMultibase: string
  attestation: VettedV1Attestation
}): Record<string, unknown> {
  const a = input.attestation
  // Only the registry's members, so an optional one left undefined is not
  // written at all (`deny_unknown_fields` reads present members only).
  const value: Record<string, unknown> = {
    community: a.community,
    method: a.method,
    documentClasses: a.documentClasses,
    claimsVerified: a.claimsVerified,
    livenessConfirmed: a.livenessConfirmed,
    identityCommitment: a.identityCommitment,
    cardDigestMultibase: a.cardDigestMultibase,
    declaredRelationship: a.declaredRelationship,
    ...(a.attestationTextDigest ? { attestationTextDigest: a.attestationTextDigest } : {}),
  }
  return {
    '@context': [VC_CONTEXT_V2, DTG_REGISTRY_CONTEXT_V1],
    type: ['VerifiableCredential', 'DTGCredential', 'StatementCredential'],
    id: input.id,
    issuer: input.issuer,
    issuerScope: 'directed',
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    taskContext: input.taskContext,
    taskDigestMultibase: input.taskDigestMultibase,
    credentialSubject: {
      id: input.subject,
      predicate: VETTED_V1_PREDICATE,
      object: { value },
    },
  }
}
