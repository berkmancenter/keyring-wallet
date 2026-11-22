import { DidDocument, JsonTransformer, type AgentContext, type DidResolutionResult } from '@credo-ts/core'

import { parseWebsDid } from '../modules/sedi/webs/identifier'
import { getArtifact, WEBS_LIMITS, type WebsFetch } from '../modules/sedi/webs/resolve'

/**
 * `did:webs` resolution: fetch the identifier's published did.json and hand it to Credo (in the forms Credo reads; see
 * `websDocument`), so a scanned bare did:webs (a community such as the SEDI VTC) is classified by its services the way
 * a did:webvh is (trust-tasks/module/classifyDid), and the join can encrypt to it and check its answer.
 *
 * It claims method `webs` only, so no other method's resolution changes.
 *
 * NOT KEL-verified: keri.cesr is not replayed here, so the keys are "what the host publishes over HTTPS", the same
 * trust as a did:web, which Credo already resolves unverified. The verifying path is sedi/webs/resolve.ts
 * `resolveWebs` (KEL replay, document checked against the replayed keys), behind the state-verified approvers switch.
 * The fetch guards are that file's own (`getArtifact`): HTTPS only, no redirect off the identifier's origin, a 64 KiB
 * cap and a 10 s timeout. The document's `id` must be the DID asked for; anything else, its did:web twin included, is
 * refused.
 */
export class WebsDidResolver {
  public readonly supportedMethods = ['webs']
  public readonly allowsCaching = true
  public readonly allowsLocalDidRecord = false

  public constructor(private readonly fetchFn: WebsFetch = (url, init) => fetch(url, init) as never) {}

  public async resolve(_agentContext: AgentContext, did: string): Promise<DidResolutionResult> {
    const parsed = parseWebsDid(did)
    if (!parsed.ok) return failed('invalidDid', parsed.detail)
    const id = parsed.value
    const got = await getArtifact(this.fetchFn, id, 'did.json', WEBS_LIMITS.didJsonBytes, WEBS_LIMITS.timeoutMs)
    if (!got.ok) return failed(got.status === 404 ? 'notFound' : 'unreachable', got.detail)
    let json: unknown
    try {
      json = JSON.parse(new TextDecoder().decode(got.bytes))
    } catch {
      return failed('invalidDidDocument', 'did.json is not JSON')
    }
    if (!json || typeof json !== 'object' || Array.isArray(json))
      return failed('invalidDidDocument', 'did.json is not an object')
    const named = (json as { id?: unknown }).id
    // Only a document naming this did:webs. Its did:web twin is refused: upstream (vti-didcomm-js 0.16.1 did-webs.js
    // `fromDidWeb`) takes the twin only with a designated-aliases attestation, which is read from the KEL, not here.
    if (named !== id.did) return failed('invalidDidDocument', `did.json names ${String(named)}, not ${id.did}`)
    const doc = json as Doc
    try {
      return {
        didDocument: JsonTransformer.fromJSON(websDocument(id.did, doc), DidDocument),
        didResolutionMetadata: { contentType: 'application/did+json' },
        didDocumentMetadata: {},
      }
    } catch (e) {
      return failed('invalidDidDocument', `did.json is not a DID document: ${(e as Error)?.message ?? String(e)}`)
    }
  }
}

function failed(error: string, message: string): DidResolutionResult {
  return { didDocument: null, didResolutionMetadata: { error, message }, didDocumentMetadata: {} }
}

type Doc = Record<string, unknown> & { service?: unknown }

/**
 * A did:webs host names a JWK method `JsonWebKey` (the current DID spec registry name); Credo reads the same JWK only
 * under `JsonWebKey2020` ("Unsupported key did from verification method type 'JsonWebKey'"), in authcrypting the join
 * to the community, in unpacking its answer, and in checking its proofs. The key itself is unchanged.
 */
const readable = (vm: unknown): unknown =>
  vm && typeof vm === 'object' && (vm as { type?: unknown }).type === 'JsonWebKey'
    ? { ...(vm as object), type: 'JsonWebKey2020' }
    : vm

const RELATIONSHIPS = [
  'authentication',
  'assertionMethod',
  'keyAgreement',
  'capabilityInvocation',
  'capabilityDelegation',
]

/**
 * The published document in the forms Credo reads: its subject the DID asked for; each service's type a string
 * (did:webs hosts, the SEDI VTC among them, write a list of one, and Credo's DidDocumentService takes a string, so
 * each keeps its first type, which is what classifyDid and the transports read); each `JsonWebKey` method, listed or
 * embedded in a relationship, `JsonWebKey2020`; each relative reference (`#key`) made absolute against the subject, as
 * upstream's `intoDocument` does. Nothing else is changed, and nothing is verified (see the class).
 */
/** A relative reference (`#key`, or a bare fragment) against the subject, as upstream's `intoDocument` does. */
const absolute = (value: unknown, did: string): unknown =>
  typeof value !== 'string'
    ? value
    : value.startsWith('#')
      ? did + value
      : value.includes(':')
        ? value
        : `${did}#${value}`

const withId = (entry: unknown, did: string): unknown =>
  entry && typeof entry === 'object' && 'id' in entry
    ? { ...(entry as object), id: absolute((entry as { id: unknown }).id, did) }
    : entry

export function websDocument(did: string, doc: Doc): Record<string, unknown> {
  const out: Record<string, unknown> = { ...doc, id: did }
  if (Array.isArray(doc.service)) {
    out.service = doc.service
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .map((s) => withId(Array.isArray(s.type) ? { ...s, type: s.type[0] } : s, did) as Record<string, unknown>)
      .filter((s) => typeof s.type === 'string')
  }
  if (Array.isArray(doc.verificationMethod))
    out.verificationMethod = doc.verificationMethod.map((vm) => readable(withId(vm, did)))
  for (const name of RELATIONSHIPS) {
    const list = doc[name]
    if (Array.isArray(list))
      out[name] = list.map((entry) => (typeof entry === 'string' ? absolute(entry, did) : readable(withId(entry, did))))
  }
  return out
}
