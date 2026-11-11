/**
 * did:webs identifiers and where their two artifacts live (did:webs specification, § Target system(s) and
 * § Method-specific identifier; the same mapping as affinidi-did-webs `identifier.rs`, read at affinidi-tdk-rs
 * 22aba093): `did:webs:<host>[%3A<port>]:<path…>:<AID>` is published at
 * `https://<host>[:<port>]/<path…>/<AID>/did.json` and `…/keri.cesr`.
 *
 * @module sedi/webs/identifier
 */

export interface WebsDid {
  /** The DID without query or fragment. */
  did: string
  /** host[:port], the port already decoded from %3A. */
  host: string
  path: string[]
  aid: string
}

export type ParsedWebsDid = { ok: true; value: WebsDid } | { ok: false; detail: string }

// An AID here is a qb64 primitive: Base64url characters only. A label that is not one is refused rather than escaped,
// so no URL is ever built from characters that could change its meaning.
const AID = /^[A-Za-z0-9_-]{44,}$/
const LABEL = /^[A-Za-z0-9._~%-]+$/

export function parseWebsDid(did: string): ParsedWebsDid {
  if (typeof did !== 'string' || !did.startsWith('did:webs:')) return { ok: false, detail: 'not a did:webs identifier' }
  const rest = did.slice('did:webs:'.length).split('#')[0].split('?')[0]
  const labels = rest.split(':')
  if (labels.length < 2) return { ok: false, detail: 'a did:webs identifier needs a host and a trailing AID' }
  if (labels.some((l) => l === '' || !LABEL.test(l))) return { ok: false, detail: 'an empty or unexpected label' }
  const aid = labels[labels.length - 1]
  if (!AID.test(aid)) return { ok: false, detail: 'the last label is not an AID' }
  const host = labels[0].replace(/%3A/gi, ':')
  if (host.startsWith(':') || /[%/@]/.test(host)) return { ok: false, detail: 'no usable host' }
  const path = labels.slice(1, -1)
  if (path.some((p) => p === '.' || p === '..')) return { ok: false, detail: 'a dot path segment' }
  return { ok: true, value: { did: `did:webs:${rest}`, host, path, aid } }
}

/** The HTTPS URL of one of the two artifacts. There is no http form: did:webs is always fetched over TLS. */
export function artifactUrl(id: WebsDid, artifact: 'did.json' | 'keri.cesr'): string {
  return ['https://' + id.host, ...id.path, id.aid, artifact].join('/')
}

/** The origin both artifacts must be served from (a redirect may not leave it). */
export function originOf(id: WebsDid): string {
  return 'https://' + id.host
}

/** The did:web twin of a did:webs identifier, as a published did.json names its subject. */
export function didWebTwin(id: WebsDid): string {
  return 'did:web:' + id.did.slice('did:webs:'.length)
}
