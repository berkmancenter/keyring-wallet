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
 *
 * VSC migration (docs/plans/vsc-migration-plan.md §1, §6 V3): WD 0.4.0
 * collapses `WitnessCredential`/`EndorsementCredential` into one
 * `StatementCredential` type whose meaning lives in `credentialSubject.predicate`,
 * not the type array. "Is this a witness credential?" therefore stops being
 * answerable from a type array alone — it needs the full credential JSON, so
 * `credentialSubject.predicate` can be checked against `@bifold/dtg-vocab`'s
 * accept-list. `isWitnessCredential`/`isPeerVrcCredential` below read both
 * shapes (dual-read, plan §7 — deleted one release after V4 ships to the
 * last channel; TODO once that date is known).
 *
 * Known limitation: a predicate is only checked when the input is a full
 * credential-shaped object. Two call sites in `vrc-manager.ts` used to pass a
 * bare `type` array where a full credential was already in scope — fixed to
 * pass the credential object instead (AL's review, finding A14), so as of
 * this migration there are no known call sites still passing a bare type
 * array where predicate-aware detection would matter. If one is added later,
 * it silently falls back to type-string-only detection — document it here.
 */

import {
  DTG_PREDICATE_WITNESSED,
  PredicateHandlingConfig,
  configure,
  loadAcceptList,
  loadSchemaStore,
} from '@bifold/dtg-vocab'

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
 *
 * Defined as `@bifold/dtg-vocab`'s `DTG_PREDICATE_WITNESSED` (byte-identical)
 * so the registry mirror is the single source of truth, while the name main
 * already exports — and tests against — keeps working.
 */
export const WITNESSED_V1_PREDICATE = DTG_PREDICATE_WITNESSED

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

/**
 * The bare name of a type element: the part after the last `#` or `/` of an
 * IRI, or the element itself when it is already a bare name.
 */
function typeNameOf(type: string): string {
  const cut = Math.max(type.lastIndexOf('#'), type.lastIndexOf('/'))
  return cut >= 0 ? type.slice(cut + 1) : type
}

/**
 * Whether the credential NAMES this type, matched as a whole name rather than
 * as a substring: `WitnessCredential` matches, and so does the expanded IRI
 * form `https://…#WitnessCredential`, but `NotAWitnessCredentialReally` does
 * not.
 *
 * `hasCredentialTypeName` above matches substrings, which is right for the
 * display registry's tolerant "what kind of thing is this, roughly?" questions
 * and wrong for deciding that a credential IS of a type — a decision a peer
 * can otherwise steer by naming its credential something that merely contains
 * the word. Use this one wherever the answer grants something.
 */
export function namesCredentialType(input: CredentialTypeInput, typeName: string): boolean {
  return getCredentialTypeList(input).some((t) => t === typeName || typeNameOf(t) === typeName)
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
 * Lazily configured accept-list from `@bifold/dtg-vocab` — loaded once, not
 * per call. `configure()`/`loadAcceptList()` do file I/O; caching keeps this
 * module's predicates cheap to call from render paths.
 */
let acceptListConfig: PredicateHandlingConfig | undefined
function getAcceptListConfig(): PredicateHandlingConfig {
  // loadSchemaStore(): without it, witnessContext's named schema is never
  // loaded and verify() unconditionally rejects every witnessed credential
  // (see loadSchemaStore's own doc comment — found 2026-09-29).
  if (!acceptListConfig) acceptListConfig = configure(loadAcceptList(), loadSchemaStore())
  return acceptListConfig
}

/**
 * The `predicate` of a credential's (first) subject, from its JSON or from a
 * Credo credential instance (whose subject keeps members other than `id` in
 * `claims`). Undefined when the input is not a credential object.
 *
 * The `claims` fallback is main's and is kept deliberately: a Credo credential
 * *instance* keeps subject members other than `id` under `claims`, so reading
 * only `subject.predicate` misses every instance-shaped credential. This
 * replaces the migration's `readPredicate`, which lacked it.
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
/**
 * True if `input` is a `StatementCredential` whose `credentialSubject.predicate`
 * is `dtg:witnessed` in `@bifold/dtg-vocab`'s configured accept-list — the new
 * VSC shape of a VWC (plan §1, §3 D1/D2). Requires a full credential object;
 * see the file header's "known limitation" note.
 *
 * Reads the predicate with `subjectPredicateOf`, so a Credo credential
 * instance (predicate under `claims`) is recognized as well as raw JSON.
 */
export function isWitnessStatement(input: CredentialTypeInput): boolean {
  // Named, not merely contained: `hasCredentialTypeName` would accept a type
  // like "NotAStatementCredentialReally". namesCredentialType matches the whole
  // name or an IRI's last segment, so expanded JSON-LD still matches while a
  // lookalike does not (trust-tasks/__tests__/witnessedV1 has the case).
  if (!namesCredentialType(input, STATEMENT_CREDENTIAL_TYPE)) return false
  const predicate = subjectPredicateOf(input)
  if (!predicate) return false
  return predicate === DTG_PREDICATE_WITNESSED && predicate in getAcceptListConfig().profiles
}

/**
 * Main's name for `isWitnessStatement`, kept so its callers and
 * `trust-tasks/__tests__/witnessedV1.test.ts` keep working. One behavioural
 * difference, inherited deliberately from the migration: the predicate must
 * also be in the accept-list, so an unrecognized `dtg/vsc/...` predicate no
 * longer counts as witnessed.
 */
export const isWitnessedStatement = isWitnessStatement

/**
 * True if `input` is a `StatementCredential` whose `credentialSubject.predicate`
 * matches ANY profile in `@bifold/dtg-vocab`'s configured accept-list —
 * `dtg:witnessed`, `dtg:endorses`, or any predicate a future accept-list
 * update adds. Exported as a general-purpose positive check; `isPeerVrcCredential`
 * below does not need it directly (see its own comment) but other call sites
 * may want to recognize a VSC statement without caring which profile matched.
 */
export function isStatementCredential(input: CredentialTypeInput): boolean {
  // Named, not merely contained, for the same reason as `isWitnessStatement`.
  if (!namesCredentialType(input, STATEMENT_CREDENTIAL_TYPE)) return false
  const predicate = subjectPredicateOf(input)
  return predicate !== undefined && predicate in getAcceptListConfig().profiles
}

/**
 * WitnessCredential — a VWC issued by a witness for a witnessed exchange.
 * Dual-read (plan §7): the legacy WD02 type-string form, OR the new VSC
 * `dtg:witnessed` predicate form. See `isWitnessStatement` for the latter.
 */
export function isWitnessCredential(input: CredentialTypeInput): boolean {
  // Named, not merely contained: this answer decides whether a credential is
  // auto-accepted and whether it can be counted as a witness's, so a peer must
  // not be able to reach it by calling its credential something that happens
  // to contain "WitnessCredential".
  //
  // The second term is the VSC shape, which additionally requires the
  // predicate to be in @bifold/dtg-vocab's accept-list. `isWitnessedStatement`
  // is an alias of it, so naming either here is the same check.
  return namesCredentialType(input, WITNESS_CREDENTIAL_TYPE) || isWitnessStatement(input)
}

/**
 * A peer-exchanged VRC: a RelationshipCredential that is not a witness's.
 *
 * Not "any DTGCredential": a community's cards are DTG credentials too — a
 * membership is ["VerifiableCredential","DTGCredential","MembershipCredential"],
 * a role ["VerifiableCredential","DTGCredential","EndorsementCredential"] — and
 * keyed on DTGCredential each would list its community in Contacts as an
 * unnamed contact (measured on a simulator with the real shapes, 2026-09-26).
 *
 * This also already excludes every StatementCredential (witness, endorsement,
 * or any future predicate) without a separate check: D1 forbids a
 * StatementCredential from carrying any other concrete DTGCredential subtype
 * in its type array, so `isRelationshipCredential` alone is false for one —
 * `isStatementCredential` above was AL's review finding A11's original fix
 * (an explicit `!isStatementCredential` exclusion on an `isDTGCredential`
 * base); reconciled here against an independent, broader upstream fix for
 * the same over-matching class of bug (community cards, 2026-09-26) that
 * subsumes it structurally. See this file's test suite for a case asserting
 * the invariant holds, so a future change to either function is caught if
 * it stops holding.
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
