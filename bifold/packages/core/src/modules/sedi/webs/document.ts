/**
 * The keys a did:webs DID document must carry, derived from verified key state, and the check that a published
 * did.json carries exactly those. The published document is a cache: it is compared against what the KEL implies,
 * never trusted on its own (did:webs specification § Read (Resolve); affinidi-did-webs `document.rs` and
 * `resolver.rs` at affinidi-tdk-rs 22aba093, whose semantic comparison this follows in a narrower form).
 *
 * Narrower than the specification, on purpose (see ./README.md): only a single-threshold key state (kt 1) is
 * expressed, no services, no designated key roles, no key agreement. A published document that carries any of those is
 * refused, never partly accepted.
 *
 * @module sedi/webs/document
 */
import { p256 } from '@noble/curves/nist.js'

import { KEYS } from '../cesr/codes'
import { b64Encode, keyCode, rawOf } from '../cesr/qb64'

import { didWebTwin, type WebsDid } from './identifier'

export type Jwk = { kty: 'EC'; crv: 'P-256'; x: string; y: string } | { kty: 'OKP'; crv: 'Ed25519'; x: string }

/** Base64url with no padding (RFC 7515 §2): b64Encode writes whole quadlets, so the tail is cut to the true length. */
const b64url = (bytes: Uint8Array) => b64Encode(bytes).slice(0, Math.ceil((bytes.length * 4) / 3))

/**
 * A verification key as a public JWK. P-256 as DBI §5.1 has it: `kty` EC, `crv` P-256, uncompressed x and y (the CESR
 * form is the 33-byte compressed point). Undefined for a code this package cannot express.
 */
export function jwkOf(keyQb64: string): Jwk | undefined {
  const code = keyCode(keyQb64)
  if (!code) return undefined
  const raw = rawOf(keyQb64, code.length)
  if (KEYS[code].curve === 'ed25519') return { kty: 'OKP', crv: 'Ed25519', x: b64url(raw) }
  try {
    const xy = p256.Point.fromBytes(raw).toBytes(false)
    return { kty: 'EC', crv: 'P-256', x: b64url(xy.slice(1, 33)), y: b64url(xy.slice(33, 65)) }
  } catch {
    return undefined
  }
}

const RELATIONSHIPS = ['authentication', 'assertionMethod'] as const
const REFUSED_MEMBERS = ['keyAgreement', 'capabilityInvocation', 'capabilityDelegation', 'keyRoles']
const ALLOWED_MEMBERS = new Set([
  '@context',
  'id',
  'controller',
  'verificationMethod',
  'service',
  'alsoKnownAs',
  ...RELATIONSHIPS,
])

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A relative or absolute reference to a verification method of `subjects`, as its fragment, or undefined. */
function fragmentOf(ref: unknown, subjects: string[]): string | undefined {
  if (typeof ref !== 'string') return undefined
  if (ref.startsWith('#')) return ref.slice(1)
  for (const s of subjects) if (ref.startsWith(s + '#')) return ref.slice(s.length + 1)
  return undefined
}

const sameDid = (a: unknown, subjects: string[]) =>
  typeof a === 'string' && subjects.some((s) => s.toLowerCase() === a.toLowerCase())

/**
 * Check a published did.json against the verified current keys. It must name this DID (or its did:web twin, the form
 * did.json is published in) as its subject, carry one JsonWebKey method per current key and no other, with each
 * method's JWK equal to the key's own and its kid the key's qb64, and reference nothing else from the relationships it
 * lists. `alsoKnownAs` may list did:keri only for this AID; any other alias is returned as `unverifiedAliases` (this
 * package does not verify designated-alias attestations) and nothing relies on it.
 */
export function checkDocument(
  doc: unknown,
  id: WebsDid,
  keys: string[]
):
  | { ok: true; unverifiedAliases: string[] }
  | { ok: false; reason: 'didDocMismatch' | 'aliasMismatch'; detail: string } {
  const mismatch = (detail: string) => ({ ok: false as const, reason: 'didDocMismatch' as const, detail })
  if (!isObj(doc)) return mismatch('did.json is not a JSON object')
  const subjects = [id.did, didWebTwin(id)]
  for (const k of Object.keys(doc)) {
    if (REFUSED_MEMBERS.includes(k)) return mismatch(`did.json carries ${k}, which Keyring does not verify yet`)
    if (!ALLOWED_MEMBERS.has(k)) return mismatch(`did.json carries an unexpected member ${k}`)
  }
  if (!sameDid(doc.id, subjects)) return mismatch(`did.json names ${String(doc.id)}, not this DID`)
  if (doc.controller !== undefined && !sameDid(doc.controller, subjects))
    return mismatch('did.json names another controller')
  if (doc.service !== undefined && !(Array.isArray(doc.service) && doc.service.length === 0))
    return mismatch('did.json lists services, which Keyring does not verify yet')

  const methods = doc.verificationMethod
  if (!Array.isArray(methods)) return mismatch('did.json has no verificationMethod list')
  const expected = new Map(keys.map((k) => [k, jwkOf(k)]))
  const seen = new Set<string>()
  for (const m of methods) {
    if (!isObj(m) || m.type !== 'JsonWebKey' || !isObj(m.publicKeyJwk))
      return mismatch('a verification method that is not a JsonWebKey')
    const frag = fragmentOf(m.id, subjects)
    if (frag === undefined || !expected.has(frag))
      return mismatch(`a verification method ${String(m.id)} for a key the KEL does not hold`)
    if (seen.has(frag)) return mismatch(`verification method ${frag} listed twice`)
    if (m.controller !== undefined && !sameDid(m.controller, subjects))
      return mismatch(`method ${frag} names another controller`)
    const want = expected.get(frag)
    const got = m.publicKeyJwk
    if (!want) return mismatch(`key ${frag} cannot be expressed as a JWK here`)
    const fields = Object.keys(want) as (keyof typeof want)[]
    if (got.kid !== undefined && got.kid !== frag) return mismatch(`method ${frag} has kid ${String(got.kid)}`)
    if (fields.some((f) => got[f] !== want[f])) return mismatch(`method ${frag}'s key is not the KEL's key`)
    const extra = Object.keys(got).filter((f) => f !== 'kid' && !fields.includes(f as keyof typeof want))
    if (extra.length) return mismatch(`method ${frag}'s JWK carries ${extra.join(', ')}`)
    seen.add(frag)
  }
  const missing = keys.filter((k) => !seen.has(k))
  if (missing.length) return mismatch(`did.json lacks the current key ${missing[0]}`)

  for (const rel of RELATIONSHIPS) {
    const refs = doc[rel]
    if (refs === undefined) continue
    if (!Array.isArray(refs)) return mismatch(`${rel} is not a list`)
    for (const r of refs) {
      const frag = fragmentOf(r, subjects)
      if (frag === undefined || !seen.has(frag)) return mismatch(`${rel} references ${String(r)}, not a current key`)
    }
  }

  const unverifiedAliases: string[] = []
  const aliases = doc.alsoKnownAs
  if (aliases !== undefined) {
    if (!Array.isArray(aliases) || aliases.some((a) => typeof a !== 'string'))
      return mismatch('alsoKnownAs is not a list of strings')
    for (const a of aliases as string[]) {
      if (a.startsWith('did:keri:')) {
        if (a !== `did:keri:${id.aid}`)
          return { ok: false, reason: 'aliasMismatch', detail: `alsoKnownAs names ${a}, another AID` }
        continue
      }
      if (sameDid(a, subjects)) continue
      unverifiedAliases.push(a)
    }
  }
  return { ok: true, unverifiedAliases }
}

/**
 * The did.json a host publishes for verified key state, in the did:web form (subject = the did:web twin), as the
 * reference implementation publishes it. Used by the fixture generator and the tests; resolution never uses it.
 */
export function publishedDocument(id: WebsDid, keys: string[]): Record<string, unknown> {
  const subject = didWebTwin(id)
  return {
    id: subject,
    verificationMethod: keys.map((k) => ({
      id: `#${k}`,
      type: 'JsonWebKey',
      controller: subject,
      publicKeyJwk: { kid: k, ...jwkOf(k) },
    })),
    service: [],
    alsoKnownAs: [id.did, `did:keri:${id.aid}`],
  }
}
