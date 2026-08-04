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

/** WitnessCredential — a VWC issued by a witness for a witnessed exchange. */
export function isWitnessCredential(input: CredentialTypeInput): boolean {
  return hasCredentialTypeName(input, WITNESS_CREDENTIAL_TYPE)
}

/**
 * A peer-exchanged VRC — DTG family but NOT a witness credential.
 * (VWCs also carry DTGCredential in their type array, so bare isDTGCredential
 * over-matches when looking for the relationship credential itself.)
 */
export function isPeerVrcCredential(input: CredentialTypeInput): boolean {
  return isDTGCredential(input) && !isWitnessCredential(input)
}

/**
 * Any credential belonging to the VRC module's surfaces (Contacts, R-Card
 * management) rather than the generic wallet credential list:
 * DTGCredential, RelationshipCredential, RCardTemplate, RelationshipCard.
 * Used to filter these out of generic credential lists.
 */
export function isVrcModuleCredential(input: CredentialTypeInput): boolean {
  return (
    isDTGCredential(input) ||
    isRelationshipCredential(input) ||
    isRCardTemplate(input) ||
    hasCredentialTypeName(input, RELATIONSHIP_CARD_TYPE)
  )
}
