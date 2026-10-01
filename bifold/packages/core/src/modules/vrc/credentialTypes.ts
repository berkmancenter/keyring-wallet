/**
 * Canonical credential type detection for the VRC module.
 *
 * This is the single source of truth for "what kind of credential is this?".
 * Screens, hooks, utils, and the display registry must import these predicates
 * instead of re-implementing type-string matching inline — adding a new
 * credential kind (or an RCE v4 shape) then means touching exactly one file.
 *
 * Inputs are deliberately tolerant: a predicate accepts a credential JSON
 * object (its `type` property is read), an array of type strings, or a single
 * type string (some AnonCreds call sites only hold a serialized type value).
 * Matching is substring-based per element, mirroring the long-standing
 * behavior of the display registry's original helpers.
 */

export const VERIFIABLE_CREDENTIAL_TYPE = 'VerifiableCredential'
export const DTG_CREDENTIAL_TYPE = 'DTGCredential'
export const RELATIONSHIP_CREDENTIAL_TYPE = 'RelationshipCredential'
export const RELATIONSHIP_CARD_TYPE = 'RelationshipCard'
export const RCARD_TEMPLATE_TYPE = 'RCardTemplate'
export const WITNESS_CREDENTIAL_TYPE = 'WitnessCredential'
export const STATEMENT_CREDENTIAL_TYPE = 'StatementCredential'
/**
 * The registry predicate a DTG Credentials v1 witness credential states
 * (VTI 0.47.0 / #1859, tf witness/session/submit as recast by #691): the VWC
 * is a `StatementCredential` under it, and no longer carries the
 * `WitnessCredential` type.
 */
export const WITNESSED_V1_PREDICATE = 'https://registry.trustoverip.org/dtg/vsc/witnessed/1'

/** A credential JSON, a `type` array, or a single type string. */
export type CredentialTypeInput = unknown

/**
 * Normalize any supported input to a list of type strings.
 * Returns [] for anything unrecognizable — predicates then return false.
 */
export function getCredentialTypeList(input: CredentialTypeInput): string[] {
  if (!input) return []
  if (typeof input === 'string') return [input]
  if (Array.isArray(input)) return input.filter((t): t is string => typeof t === 'string')
  if (typeof input === 'object') {
    const typeValue = (input as { type?: unknown }).type
    if (!typeValue) return []
    if (typeof typeValue === 'string') return [typeValue]
    if (Array.isArray(typeValue)) return typeValue.filter((t): t is string => typeof t === 'string')
  }
  return []
}

/** Substring match per type element (e.g. matches serialized type-array strings too). */
export function hasCredentialTypeName(input: CredentialTypeInput, typeName: string): boolean {
  return getCredentialTypeList(input).some((t) => t.includes(typeName))
}

/** DTGCredential — the base type of the DTG/VRC credential family. */
export function isDTGCredential(input: CredentialTypeInput): boolean {
  return hasCredentialTypeName(input, DTG_CREDENTIAL_TYPE)
}

/** RelationshipCredential — a peer VRC (shown in Contacts, not the wallet list). */
export function isRelationshipCredential(input: CredentialTypeInput): boolean {
  return hasCredentialTypeName(input, RELATIONSHIP_CREDENTIAL_TYPE)
}

/**
 * RelationshipCard (RCard) — an exchanged contact-info credential.
 * Excludes the self-issued RCardTemplate.
 */
export function isRCard(input: CredentialTypeInput): boolean {
  return hasCredentialTypeName(input, RELATIONSHIP_CARD_TYPE) && !hasCredentialTypeName(input, RCARD_TEMPLATE_TYPE)
}

/** RCardTemplate — the local, self-issued business-card template (internal use only). */
export function isRCardTemplate(input: CredentialTypeInput): boolean {
  return hasCredentialTypeName(input, RCARD_TEMPLATE_TYPE)
}

/**
 * The `predicate` of a credential's (first) subject, from its JSON or from a
 * Credo credential instance (whose subject keeps members other than `id` in
 * `claims`). Undefined when the input is not a credential object.
 */
function subjectPredicateOf(input: CredentialTypeInput): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const subjects = (input as { credentialSubject?: unknown }).credentialSubject
  const subject = (Array.isArray(subjects) ? subjects[0] : subjects) as
    | { predicate?: unknown; claims?: { predicate?: unknown } }
    | undefined
  const predicate = subject?.predicate ?? subject?.claims?.predicate
  return typeof predicate === 'string' ? predicate : undefined
}

/**
 * A DTG Credentials v1 witness credential: a `StatementCredential` (matched
 * exactly — a vetting statement is one too) stating the witnessed/1
 * predicate. Needs the credential itself: a bare type list cannot say.
 */
export function isWitnessedStatement(input: CredentialTypeInput): boolean {
  return (
    getCredentialTypeList(input).includes(STATEMENT_CREDENTIAL_TYPE) &&
    subjectPredicateOf(input) === WITNESSED_V1_PREDICATE
  )
}

/**
 * A VWC issued by a witness for a witnessed exchange, in either shape: the
 * `WitnessCredential` type, or a witnessed/1 statement (`isWitnessedStatement`,
 * which needs the credential, not just its types).
 */
export function isWitnessCredential(input: CredentialTypeInput): boolean {
  return hasCredentialTypeName(input, WITNESS_CREDENTIAL_TYPE) || isWitnessedStatement(input)
}

/**
 * A peer-exchanged VRC: a RelationshipCredential that is not a witness's.
 *
 * Not "any DTGCredential": a community's cards are DTG credentials too — a
 * membership is ["VerifiableCredential","DTGCredential","MembershipCredential"],
 * a role ["VerifiableCredential","DTGCredential","EndorsementCredential"] — and
 * keyed on DTGCredential each would list its community in Contacts as an
 * unnamed contact (measured on a simulator with the real shapes, 2026-09-26).
 */
export function isPeerVrcCredential(input: CredentialTypeInput): boolean {
  return isRelationshipCredential(input) && !isWitnessCredential(input)
}

/**
 * Any credential belonging to the VRC module's surfaces (Contacts, R-Card
 * management) rather than the generic wallet credential list: the
 * relationship family — RelationshipCredential, WitnessCredential,
 * RCardTemplate, RelationshipCard. Used to filter these out of generic
 * credential lists.
 *
 * Keyed on the family, not on DTGCredential: a community's membership and
 * role cards are DTG credentials that belong IN the Wallet (agent-kept cards,
 * 226), and keyed on DTGCredential they were hidden with the VRCs.
 */
export function isVrcModuleCredential(input: CredentialTypeInput): boolean {
  return (
    isRelationshipCredential(input) ||
    isWitnessCredential(input) ||
    isRCardTemplate(input) ||
    hasCredentialTypeName(input, RELATIONSHIP_CARD_TYPE)
  )
}
