/**
 * What a bare DID is, read from its DID document's services — so a scanned or
 * pasted "did:…" (upstream's VTC landing page, `pnm vta qr`, a plugin QR) can
 * be routed: an agent to link, a community to join, or something that is
 * neither and says so.
 *
 * `classifyDidDocument` is pure: it decides from the services alone and makes
 * no network call, so a screen can be tested against every kind without a
 * resolver. Resolving a DID into a document (with its own timeout, and the
 * `unresolvable` reasons) is a separate step.
 *
 * The services it reads are the ones the VTI stack publishes today, measured
 * on the VTA Farm on 2026-09-23:
 *  - a VTA:        TSPTransport, DIDCommMessaging, **VTARest**
 *  - a community:  TSPTransport, DIDCommMessaging, **VTCRest**, **VTCStatusList**
 *  - a mediator:   TSPTransport, **DIDCommMessaging**, **Authentication**
 *  - a persona:    TSPTransport, DIDCommMessaging (reached, not linked or joined)
 *
 * @module trust-tasks/module/classifyDid
 */

/** What a DID is, as far as Keyring can act on it. */
export type DidKind =
  /** A VTA a phone can link to. `label` is reserved: no upstream field names an agent yet. */
  | { kind: 'agent'; did: string; label?: string }
  /** A community a phone can join. `name` only when the document itself carries one (none does today). */
  | { kind: 'community'; did: string; name?: string }
  /** A mediator: it relays messages; there is nothing to link to or join. */
  | { kind: 'relay'; did: string }
  /** Resolves, but is none of the above — a person, a key, a persona. */
  | { kind: 'other'; did: string }
  /** Advertises both an agent and a community: the person says which they mean. Never guessed. */
  | { kind: 'ambiguous'; did: string }
  /**
   * Could not be read. `invalid`: not a DID this wallet can resolve.
   * `notFound`: its host answered that there is no such DID. `offline`: the
   * host could not be reached in time.
   */
  | { kind: 'unresolvable'; did: string; reason: 'offline' | 'notFound' | 'invalid' }

/** The shape `classifyDidDocument` reads: a DID document's id and services. */
export interface ClassifiableDidDocument {
  id?: string
  service?: ReadonlyArray<{ type?: string | ReadonlyArray<string> } | undefined> | null
}

/** A service's types, whether the document writes one type or a list. */
const typesOf = (service: { type?: string | ReadonlyArray<string> } | undefined): string[] => {
  const type = service?.type
  if (typeof type === 'string') return [type]
  return Array.isArray(type) ? type.filter((t): t is string => typeof t === 'string') : []
}

/**
 * Classify a resolved DID document by the services it advertises. `did` is the
 * DID it was resolved for; the document's own `id` is used when none is given.
 */
export function classifyDidDocument(doc: ClassifiableDidDocument, did?: string): DidKind {
  const id = did ?? doc.id ?? ''
  const types = new Set((doc.service ?? []).flatMap(typesOf))
  const agent = types.has('VTARest')
  const community = types.has('VTCRest') || types.has('VTCStatusList')
  if (agent && community) return { kind: 'ambiguous', did: id }
  if (agent) return { kind: 'agent', did: id }
  if (community) return { kind: 'community', did: id }
  if (types.has('DIDCommMessaging') && types.has('Authentication')) return { kind: 'relay', did: id }
  return { kind: 'other', did: id }
}

/**
 * A bare DID from what a person scanned or pasted: trimmed, and without a DID
 * URL's path, query or fragment (`did:…#key-0`, `did:…?versionId=…`), since
 * what is classified is the subject, not one of its resources. Undefined when
 * the text is not a DID at all.
 */
export function bareDid(input: string): string | undefined {
  const text = input.trim()
  const match = /^did:[a-z0-9]+:[^\s?#/]+/.exec(text)
  return match ? match[0] : undefined
}
