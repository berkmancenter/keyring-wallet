/**
 * A vetting statement in either of its two shapes, and the body each carries.
 *
 * - **endorsement** (before DTG Credentials v1): an `EndorsementCredential`
 *   whose `credentialSubject.endorsement` has `type` identity-vetting/0.1 and
 *   the attestation's members beside it, under the firstperson DTG context.
 * - **vetted/1** (DTG Credentials v1, VTI 0.47.0 / #1859 on): a
 *   `StatementCredential` whose `credentialSubject.predicate` is the registry's
 *   vetted/1 IRI and whose attestation is `credentialSubject.object.value`,
 *   with no `type` member, under the registry's v1 context
 *   (trust-tasks-tf vetting/session/0.1 as recast by #691; registry
 *   predicates/vetted/1).
 *
 * The task's version does not change between the two (tf #691 recast the specs
 * in place), so a statement is told apart by its own shape, never by the task
 * that carried it. Both bodies name the same members (community, method,
 * documentClasses, claimsVerified, livenessConfirmed, identityCommitment,
 * cardDigestMultibase, declaredRelationship).
 */

export const IDENTITY_VETTING_ENDORSEMENT_TYPE = 'https://firstperson.network/endorsements/identity-vetting/0.1'
export const VETTED_V1_PREDICATE = 'https://registry.trustoverip.org/dtg/vsc/vetted/1'

/** The firstperson DTG context the endorsement shape is issued under. */
export const FIRSTPERSON_DTG_CONTEXT = 'https://firstperson.network/credentials/dtg/v1'
/** The registry's frozen DTG Credentials v1 context the vetted/1 shape is issued under. */
export const DTG_REGISTRY_CONTEXT_V1 = 'https://registry.trustoverip.org/dtg/context/v1'

/**
 * Until this day a card in the shape from before DTG Credentials v1 is still
 * read. After it, such a card is refused like any other that is not
 * conformant.
 *
 * The cred-spec (Base Structure, body.md:191) says a verifier MUST reject a
 * credential without `issuerScope`, and no card of the old shape has one: it
 * predates the member. Upstream cut over without dual acceptance (VTI #1859,
 * dtg-credentials 0.12.0), but a community moves only when its operator
 * upgrades it, so for a while one phone meets communities on both sides of the
 * cut. Reading both keeps those people working; the date ends it. The date is
 * the whole of the policy, so moving it is a code change.
 */
export const LEGACY_DTG_SHAPE_UNTIL = '2027-01-01'

/** Whether a card in the shape from before DTG Credentials v1 is still read at `now` (ms). */
export function legacyDtgShapeReadable(now: number): boolean {
  return now < Date.parse(`${LEGACY_DTG_SHAPE_UNTIL}T00:00:00Z`)
}

/**
 * The scopes the cred-spec allows (Base Structure), and the narrowest a
 * vetted/1 statement may declare: `directed` (dtg-credentials 0.12.0 refuses
 * `pairwise` for it, as the registry profile's minimum).
 */
export const ISSUER_SCOPES = ['pairwise', 'directed', 'public'] as const
export type IssuerScope = (typeof ISSUER_SCOPES)[number]

export type VettingStatementShape = 'endorsement' | 'vetted/1'

export interface VettingStatementBody {
  shape: VettingStatementShape
  /** The attestation: `endorsement` (with its `type`) or `object.value`. */
  body: Record<string, unknown>
}

const typesOf = (credential: Record<string, unknown>): string[] =>
  ([] as unknown[]).concat(credential.type ?? []).map(String)

const asObject = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined

/**
 * The statement's attestation, if `credential` is a vetting statement in
 * either shape; undefined for anything else (a role grant, a membership, a
 * statement under another predicate). Says nothing about whether it verifies.
 */
export function vettingStatementBody(credential: Record<string, unknown>): VettingStatementBody | undefined {
  const subject = asObject(credential.credentialSubject)
  if (!subject) return undefined
  const endorsement = asObject(subject.endorsement)
  if (endorsement?.type === IDENTITY_VETTING_ENDORSEMENT_TYPE) return { shape: 'endorsement', body: endorsement }
  if (typesOf(credential).includes('StatementCredential') && subject.predicate === VETTED_V1_PREDICATE) {
    const value = asObject(asObject(subject.object)?.value)
    if (value) return { shape: 'vetted/1', body: value }
  }
  return undefined
}

/**
 * Why a vetting statement's shape is not one this reader accepts, or
 * undefined when it is: the type triple and context its shape requires, the
 * members every statement needs (`id`, `taskContext`, a parseable
 * `validUntil`), and per shape what that shape adds. `vetted/1` must declare
 * `issuerScope` `directed` or `public` and carry `taskDigestMultibase`
 * (tf vetting/session/0.1, both MUST); the endorsement shape is read only
 * until `LEGACY_DTG_SHAPE_UNTIL`.
 */
export function vettingStatementShapeProblem(
  credential: Record<string, unknown>,
  now: number
): 'notAStatement' | 'malformed' | 'legacyShapeRetired' | undefined {
  const read = vettingStatementBody(credential)
  if (!read) return 'notAStatement'
  const types = typesOf(credential)
  const contexts = ([] as unknown[]).concat(credential['@context'] ?? [])
  const common =
    !!credential.id &&
    !!credential.taskContext &&
    Number.isFinite(Date.parse(String(credential.validUntil ?? ''))) &&
    types.includes('VerifiableCredential') &&
    types.includes('DTGCredential')
  if (!common) return 'malformed'
  if (read.shape === 'endorsement') {
    if (!types.includes('EndorsementCredential') || !contexts.includes(FIRSTPERSON_DTG_CONTEXT)) return 'malformed'
    return legacyDtgShapeReadable(now) ? undefined : 'legacyShapeRetired'
  }
  const scope = credential.issuerScope
  if (
    !types.includes('StatementCredential') ||
    !contexts.includes(DTG_REGISTRY_CONTEXT_V1) ||
    (scope !== 'directed' && scope !== 'public') ||
    typeof credential.taskDigestMultibase !== 'string' ||
    !credential.taskDigestMultibase
  )
    return 'malformed'
  return undefined
}
