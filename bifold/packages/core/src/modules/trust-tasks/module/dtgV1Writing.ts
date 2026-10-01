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
import { DTG_REGISTRY_CONTEXT_V1, IDENTITY_VETTING_ENDORSEMENT_TYPE, VETTED_V1_PREDICATE } from '@bifold/trust-tasks'

const VC_CONTEXT_V2 = 'https://www.w3.org/ns/credentials/v2'

/**
 * Which shape a Keyring vetter writes:
 * - `off`: always the endorsement shape, as before 228;
 * - `auto`: per community, the shape that community counts (`chooseStatementShape`);
 * - `force`: always vetted/1 (developer and test use only).
 */
export type DtgV1WritingMode = 'off' | 'auto' | 'force'

/**
 * The mode a release ships with. Changing it is the whole of the release
 * decision (228: 'auto' once the Farm 0.47 gate passes on the candidate,
 * else 'off'); nothing else needs to move.
 */
export const DTG_V1_WRITING_RELEASE_DEFAULT: DtgV1WritingMode = 'auto'

let writingMode: DtgV1WritingMode = DTG_V1_WRITING_RELEASE_DEFAULT

export function setDtgV1WritingMode(mode: DtgV1WritingMode): void {
  writingMode = mode
}

export function getDtgV1WritingMode(): DtgV1WritingMode {
  return writingMode
}

/** Shorthand for tests and developer settings: on is `force`, off is `off`. */
export function setDtgV1WritingEnabled(enabled: boolean): void {
  writingMode = enabled ? 'force' : 'off'
}

/** Whether this phone writes vetted/1 for any community (any mode but `off`). */
export function isDtgV1WritingEnabled(): boolean {
  return writingMode !== 'off'
}

export type StatementShape = 'endorsement' | 'vetted/1'

export interface StatementShapeChoice {
  shape: StatementShape
  /** What decided it: the mode, the community's requirements (A), the vetter's grant (B), or neither. */
  by: 'mode' | 'requirements' | 'grant' | 'default'
  /** Set when A and B were both read and named different shapes; A was followed. */
  disagreement?: { requirements: StatementShape; grant: StatementShape }
}

/**
 * The shape a vetter writes for one community.
 *
 * A (authoritative): the community's published vetting requirements name the
 * statement type it counts (`statementType`): the vetted/1 predicate on a
 * community that has moved (tf manifest/0.2 as recast by #691), the
 * identity-vetting endorsement type on one that has not.
 * B (local): the vetter's own grant from that community: a role VAC is issued
 * by a community on DTG Credentials v1, a CommunityRole endorsement by one that
 * is not.
 * A when it was read; else B; with neither, the endorsement shape (read until
 * LEGACY_DTG_SHAPE_UNTIL). In `off` and `force` the mode decides.
 */
export function chooseStatementShape(input: {
  mode: DtgV1WritingMode
  statementType?: string
  grantShape?: 'endorsement' | 'vac'
}): StatementShapeChoice {
  if (input.mode === 'off') return { shape: 'endorsement', by: 'mode' }
  if (input.mode === 'force') return { shape: 'vetted/1', by: 'mode' }
  const fromRequirements: StatementShape | undefined =
    input.statementType === VETTED_V1_PREDICATE
      ? 'vetted/1'
      : input.statementType === IDENTITY_VETTING_ENDORSEMENT_TYPE
        ? 'endorsement'
        : undefined
  const fromGrant: StatementShape | undefined =
    input.grantShape === 'vac' ? 'vetted/1' : input.grantShape === 'endorsement' ? 'endorsement' : undefined
  if (fromRequirements) {
    return fromGrant && fromGrant !== fromRequirements
      ? {
          shape: fromRequirements,
          by: 'requirements',
          disagreement: { requirements: fromRequirements, grant: fromGrant },
        }
      : { shape: fromRequirements, by: 'requirements' }
  }
  if (fromGrant) return { shape: fromGrant, by: 'grant' }
  return { shape: 'endorsement', by: 'default' }
}

/** The `statementType` a community's manifest publishes for vetting, if any. */
export function publishedStatementType(manifest: unknown): string | undefined {
  const criteria = (manifest as { criteria?: unknown[] } | undefined)?.criteria
  if (!Array.isArray(criteria)) return undefined
  for (const c of criteria) {
    const vetting = (c as { vetting?: { statementType?: unknown } } | undefined)?.vetting
    if (typeof vetting?.statementType === 'string') return vetting.statementType
  }
  return undefined
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
