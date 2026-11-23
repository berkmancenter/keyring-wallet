import Ajv, { ValidateFunction } from 'ajv'
import type { AcceptList, AcceptListEntry } from './acceptList'

// RFC 3986 absolute-IRI shape: scheme ':' ... — cred-spec's Predicate
// Handling step 1 rejects a MALFORMED predicate (not an absolute IRI)
// distinctly from step 2's UNKNOWN predicate (not in the accept-list).
const ABSOLUTE_IRI = /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/

export interface SchemaStore {
  [schemaUrlBasename: string]: object
}

interface CompiledMember {
  required: boolean
  validate: ValidateFunction | null
  schemaUrl: string | null
}

interface ProfileConfig extends AcceptListEntry {
  members: Record<string, CompiledMember>
}

export interface PredicateHandlingConfig {
  profiles: Record<string, ProfileConfig>
}

/**
 * Configuration time (cred-spec C4: "configure() runs once and may load
 * schemas; verify() runs per credential and never touches the network").
 * `schemaStore` maps a schema URL's last path segment to its JSON Schema —
 * the caller is responsible for having those schemas on hand already; this
 * function never fetches one.
 */
export function configure(acceptList: AcceptList, schemaStore: SchemaStore = {}): PredicateHandlingConfig {
  const ajv = new Ajv({ allErrors: true, strict: false })
  const profiles: Record<string, ProfileConfig> = {}
  for (const [iri, entry] of Object.entries(acceptList)) {
    const members: Record<string, CompiledMember> = {}
    for (const [name, m] of Object.entries(entry.additionalMembers ?? {})) {
      const key = m.schema ? (m.schema.split('/').pop() ?? null) : null
      const schema = key ? schemaStore[key] : undefined
      members[name] = {
        required: m.required,
        validate: schema ? ajv.compile(schema) : null,
        schemaUrl: m.schema ?? null,
      }
    }
    profiles[iri] = { ...entry, members }
  }
  return { profiles }
}

export interface VerifyResult {
  ok: boolean
  reason: string
  checked: string[]
  unchecked: string[]
  ignored?: string[]
}

export interface ReferencedCredential {
  digestMultibase: string
  credential: {
    issuer: string | { id: string }
    credentialSubject?: { id?: string }
  }
}

export interface VerifyOptions {
  /** predicate IRI -> which subjectObjectRelationship reading applies, when the caller can check it */
  relations?: Record<string, 'subjectIsReferencedIssuer' | 'subjectIsReferencedSubject'>
  referenced?: ReferencedCredential[]
}

/**
 * Verification time. Runs cred-spec's Predicate Handling steps 1-3 plus
 * every profile constraint this package can check generically, and reports
 * exactly what was and was not checked — `unchecked` names constraints the
 * accept-list cannot express as a mechanical check today (free-text
 * relationships, declared issuer scope), so a caller never mistakes
 * "verified" for "every profile constraint was enforced."
 */
export function verify(
  config: PredicateHandlingConfig,
  cred: Record<string, unknown>,
  options: VerifyOptions = {}
): VerifyResult {
  const { relations = {}, referenced = [] } = options
  const checked: string[] = []
  const unchecked: string[] = []
  const reject = (reason: string): VerifyResult => ({ ok: false, reason, checked, unchecked })

  const cs = (cred.credentialSubject as Record<string, unknown>) ?? {}
  const predicate = cs.predicate

  // Step 1 — absolute IRI (malformed, not merely unknown)
  if (predicate === undefined) return reject('step 1: no predicate')
  if (typeof predicate !== 'string' || !ABSOLUTE_IRI.test(predicate))
    return reject('step 1: predicate is not an absolute IRI')
  checked.push('absolute IRI')

  // Step 2 — accepted vocabulary (the verifier's own configuration, never derived from the credential)
  const profile = config.profiles[predicate]
  if (!profile) return reject('step 2: predicate not in the accept-list')
  checked.push('in accept-list')

  // Step 3 — the profile's constraints
  const object = cs.object as Record<string, unknown> | undefined
  const kinds = (['id', 'digestMultibase', 'value'] as const).filter((k) => object && k in object)
  if (kinds.length !== 1)
    return reject(`object must carry exactly one of id|digestMultibase|value (has ${kinds.join(',') || 'none'})`)
  if (!profile.objectKind.includes(kinds[0])) return reject(`object kind ${kinds[0]} not permitted`)
  checked.push('objectKind')

  if (profile.taskContextRequired && typeof cred.taskContext !== 'string')
    return reject('taskContext required but absent')
  checked.push('taskContextRequired')

  for (const [name, m] of Object.entries(profile.members)) {
    if (!(name in cs)) {
      if (m.required) return reject(`additional member ${name} required but absent`)
      continue
    }
    if (m.schemaUrl && !m.validate) return reject(`schema for ${name} named but not loaded at configuration time`)
    if (m.validate && !m.validate(cs[name])) {
      return reject(
        `${name} fails its schema: ${(m.validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ')}`
      )
    }
    checked.push(`additional member ${name}`)
  }
  const defined = new Set(['id', 'predicate', 'object', ...Object.keys(profile.members)])
  const ignored = Object.keys(cs).filter((k) => !defined.has(k))
  if (ignored.length) checked.push(`ignored undefined members: ${ignored.join(', ')}`) // PR #47 profile item 5

  // What the accept-list cannot express as a check today.
  const relation = relations[predicate]
  if (profile.subjectObjectRelationship && !relation) {
    unchecked.push('subjectObjectRelationship (free text)')
  } else if (relation) {
    const target = referenced.find((r) => r.digestMultibase === object?.digestMultibase)
    if (!target) return reject('referenced credential not available to check the subject relationship')
    const expected =
      relation === 'subjectIsReferencedIssuer'
        ? typeof target.credential.issuer === 'string'
          ? target.credential.issuer
          : target.credential.issuer?.id
        : target.credential.credentialSubject?.id
    if (cs.id !== expected) return reject(`${relation}: subject ${String(cs.id)} is not ${String(expected)}`)
    checked.push(`subject relationship (${relation})`)
  }
  if (profile.minimumIssuerScope)
    unchecked.push('minimumIssuerScope (no credential property carries a declared scope — cred-spec #46)')

  return { ok: true, reason: 'accepted', checked, unchecked, ignored }
}
