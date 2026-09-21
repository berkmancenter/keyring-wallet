/**
 * vtiStatusList — W3C Bitstring Status List v1.0 revocation checks, client side.
 *
 * An applicant has to know whether the vetter who signed its statement still
 * holds a live grant. The grant's validity *window* is cheap and already
 * checked (`vtiVetting.accepted`); the *status* is a round trip to whatever
 * URL the credential nominates, and it is the half the community actually
 * weighs — a statement from a revoked vetter is discounted at intake with no
 * warning to the applicant.
 *
 * The algorithm mirrors the service side rather than inventing one:
 * `vtc-service/src/recognition/verify.rs` (`HttpStatusListFetcher`) and
 * `vta-vault/src/status.rs` (`HttpStatusListResolver`). In particular the
 * ordering — guard the URL, fetch without following redirects under a body
 * cap, verify the list's own proof and bind its issuer, and only then read a
 * bit — is theirs. A list credential is issuer-supplied and therefore
 * attacker-influenceable; reading bytes before checking who signed them is the
 * fail-open hole that lets anyone serving the URL forge a revocation of a good
 * credential, or hide a real one.
 *
 * Where we deliberately differ: the vault's resolver falls back to a stored
 * tag when the round trip fails, so an outage does not block a presentation
 * while a *forged* list is still rejected. A phone has no such fallback and no
 * business refusing a legitimate applicant because it was offline, so the
 * result here is a tri-state — `ok`, `revoked`, or `unknown` with the reason —
 * and the caller decides. Nothing silently reads as "fine".
 *
 * @module trust-tasks/module/vtiStatusList
 */

import type { Agent } from '@credo-ts/core'
import { verifyDocumentProof } from '@bifold/trust-tasks'
import { ungzip } from 'pako'

/**
 * The W3C minimum list size, which is also what the issuers here allocate
 * (`DEFAULT_BITSTRING_SIZE` in `vta-vault`, and the fetcher's fallback in
 * `vtc-service`). 131,072 bits is 16 KiB uncompressed.
 */
export const DEFAULT_BITSTRING_SIZE = 131_072

/** Refuse to buffer more than this from an issuer-supplied URL. */
const MAX_STATUS_LIST_BODY = 2 * 1024 * 1024

/** How long to wait on the round trip before calling it unknown. */
const FETCH_TIMEOUT_MS = 10_000

/**
 * The outcome of a status check.
 *
 * `none` and `ok` are different facts and are kept apart: `none` means the
 * credential never carried a status block, so its issuer made an implicit
 * "we do not revoke" claim, while `ok` means a list was fetched, verified and
 * read. A caller that shows the applicant "not revoked when checked on …"
 * may only say that for `ok`.
 */
export type CredentialStatusResult =
  | { state: 'ok'; checkedAt: string; index: number; purpose: string }
  | { state: 'revoked'; checkedAt: string; index: number; purpose: string }
  | { state: 'none'; checkedAt: string }
  | { state: 'unknown'; checkedAt: string; reason: string }

/** A parsed `credentialStatus` entry. */
export interface StatusEntry {
  url: string
  index: number
  purpose: string
}

const now = () => new Date().toISOString()

const unknown = (reason: string): CredentialStatusResult => ({ state: 'unknown', checkedAt: now(), reason })

/**
 * Reject a status-list URL before dialling it.
 *
 * Mirrors `vta_sdk::http::guard_public_url`: HTTPS only, no embedded
 * userinfo, and no IP-literal host in a loopback, private, link-local or
 * cloud-metadata range. The threat is smaller on a phone than on a daemon —
 * there is no internal network to proxy into — but the credential still gets
 * to name a host, and a wallet that will dial anything a stranger's credential
 * names is a wallet that can be pointed at a LAN.
 *
 * `allowInsecureLocal` exists for the development fixture, where the community
 * is served over plain HTTP on a private address. It is off unless a caller
 * asks, and a build that never asks cannot be talked into it.
 */
export function guardStatusListUrl(raw: string, allowInsecureLocal = false): string | undefined {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return `not a URL`
  }
  if (url.username || url.password) return 'URL carries userinfo'

  const host = url.hostname.replace(/^\[|\]$/g, '')
  const isLoopbackName = host === 'localhost' || host.endsWith('.localhost')
  // IPv4 literal, or the IPv6 forms that matter (loopback, link-local, unique-local).
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  let nonPublicLiteral = isLoopbackName
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    nonPublicLiteral =
      a === 127 || // loopback
      a === 10 || // private
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 169 && b === 254) || // link-local, and 169.254.169.254 metadata
      (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
  } else if (host.includes(':')) {
    const h = host.toLowerCase()
    nonPublicLiteral = h === '::1' || h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')
  }

  if (url.protocol === 'https:') {
    return nonPublicLiteral && !allowInsecureLocal ? 'HTTPS URL targets a non-public address' : undefined
  }
  if (url.protocol === 'http:') {
    if (!allowInsecureLocal) return 'URL is not HTTPS'
    return nonPublicLiteral ? undefined : 'plain HTTP is only allowed to a local address'
  }
  return `unsupported scheme ${url.protocol}`
}

/**
 * Pull the status entry out of a credential.
 *
 * `credentialStatus` may be a single object or an array; when several are
 * present the one matching `purpose` wins, which is how a credential carries
 * revocation and suspension side by side.
 */
export function statusEntryOf(
  credential: Record<string, unknown>,
  purpose = 'revocation'
): StatusEntry | undefined | 'malformed' {
  const raw = credential.credentialStatus
  if (raw === undefined || raw === null) return undefined
  const entries = (Array.isArray(raw) ? raw : [raw]).filter(
    (e): e is Record<string, unknown> => !!e && typeof e === 'object'
  )
  if (entries.length === 0) return 'malformed'

  const match =
    entries.find((e) => String(e.statusPurpose ?? 'revocation') === purpose) ??
    (entries.length === 1 ? entries[0] : undefined)
  if (!match) return undefined

  const url = typeof match.statusListCredential === 'string' ? match.statusListCredential : ''
  const indexRaw = match.statusListIndex
  const index = typeof indexRaw === 'number' ? indexRaw : Number.parseInt(String(indexRaw ?? ''), 10)
  if (!url || !Number.isInteger(index) || index < 0) return 'malformed'
  return { url, index, purpose: String(match.statusPurpose ?? 'revocation') }
}

/**
 * Decode a multibase `encodedList` into its bytes.
 *
 * The wire form is a multibase string — the `u` prefix is base64url without
 * padding — wrapping a GZIP stream. Issuers here always write `u`, but a bare
 * base64url string is accepted too rather than failing a check over a missing
 * prefix character.
 */
export function decodeEncodedList(encoded: string): Uint8Array | string {
  if (!encoded) return 'empty encodedList'
  const body = encoded.startsWith('u') ? encoded.slice(1) : encoded
  let gz: Uint8Array
  try {
    const b64 = body.replace(/-/g, '+').replace(/_/g, '/')
    const bin = globalThis.atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))
    gz = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch (e) {
    return `encodedList is not base64url: ${String(e)}`
  }
  try {
    return ungzip(gz)
  } catch (e) {
    return `encodedList is not a GZIP stream: ${String(e)}`
  }
}

/**
 * Read one bit out of a decoded bitstring.
 *
 * Bit order is most-significant-first within each byte: index 0 is `0x80` of
 * byte 0, index 7 is `0x01` of byte 0, index 8 is `0x80` of byte 1. This is
 * what the W3C encoding prescribes and what StatusList2021 before it used.
 * Settled against the issuer rather than the prose: affinidi-status-list 0.1.5,
 * which vtc-service builds with, sets and reads bits `7 - (index % 8)` — "MSB
 * first per spec" — and a live community's list, which carries decoy bits, is
 * read correctly by this function (`__tests__/proofSet.test.ts`).
 */
export function bitAt(bits: Uint8Array, index: number): boolean | string {
  const byte = index >>> 3
  if (byte >= bits.length) return `index ${index} is past the end of a ${bits.length * 8}-bit list`
  return (bits[byte] & (0x80 >>> (index & 7))) !== 0
}

/**
 * Fetch, verify and read the status of one credential.
 *
 * `expectedIssuer` is the DID that issued the credential being checked. The
 * list credential must be signed by that same DID: a list signed by anyone
 * else is rejected rather than read, which is what stops a third party who can
 * serve the URL from forging or masking a revocation.
 */
export async function checkCredentialStatus(
  agent: Agent,
  credential: Record<string, unknown>,
  expectedIssuer: string,
  options: { purpose?: string; allowInsecureLocal?: boolean; fetchImpl?: typeof fetch } = {}
): Promise<CredentialStatusResult> {
  const entry = statusEntryOf(credential, options.purpose ?? 'revocation')
  if (entry === undefined) return { state: 'none', checkedAt: now() }
  if (entry === 'malformed') return unknown('credentialStatus is present but unreadable')
  return checkStatusEntry(agent, entry, expectedIssuer, options)
}

/**
 * The same check against an entry held on its own.
 *
 * A grant is checked once when it arrives and again before the statement it
 * backs is submitted, and the second check happens long after the credential
 * itself has been handed to the community store. Keeping the entry — a URL, an
 * index and a purpose — is enough to ask again, and is a great deal less to
 * hold on to than the credential.
 */
export async function checkStatusEntry(
  agent: Agent,
  entry: StatusEntry,
  expectedIssuer: string,
  options: { allowInsecureLocal?: boolean; fetchImpl?: typeof fetch } = {}
): Promise<CredentialStatusResult> {
  const rejection = guardStatusListUrl(entry.url, options.allowInsecureLocal)
  if (rejection) return unknown(`status list URL rejected: ${rejection}`)

  const doFetch = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let body: unknown
  try {
    const response = await doFetch(entry.url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      // A 3xx to an internal host would walk straight past the guard above.
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) return unknown(`status list fetch returned ${response.status}`)
    const text = await response.text()
    if (text.length > MAX_STATUS_LIST_BODY) return unknown('status list body exceeds the cap')
    body = JSON.parse(text)
  } catch (e) {
    return unknown(`status list fetch failed: ${String(e)}`)
  } finally {
    clearTimeout(timer)
  }

  if (!body || typeof body !== 'object') return unknown('status list is not a JSON object')
  const list = body as Record<string, unknown>

  const listIssuer = typeof list.issuer === 'string' ? list.issuer : String((list.issuer as { id?: string })?.id ?? '')
  if (!listIssuer) return unknown('status list has no issuer')
  if (listIssuer !== expectedIssuer) {
    return unknown(`status list issuer ${listIssuer} is not the credential's issuer ${expectedIssuer}`)
  }
  if (!(await verifyDocumentProof(agent, list, listIssuer))) {
    return unknown('status list signature did not verify')
  }

  const subject = (list.credentialSubject ?? {}) as Record<string, unknown>
  const subjectPurpose = String(subject.statusPurpose ?? 'revocation')
  if (subjectPurpose !== entry.purpose) {
    return unknown(`status list is for ${subjectPurpose}, the credential's entry is for ${entry.purpose}`)
  }

  const bits = decodeEncodedList(String(subject.encodedList ?? ''))
  if (typeof bits === 'string') return unknown(bits)

  const capacity = bits.length * 8
  if (entry.index >= capacity) {
    return unknown(`index ${entry.index} exceeds the list's ${capacity} bits`)
  }
  const bit = bitAt(bits, entry.index)
  if (typeof bit === 'string') return unknown(bit)

  const checkedAt = now()
  return bit
    ? { state: 'revoked', checkedAt, index: entry.index, purpose: entry.purpose }
    : { state: 'ok', checkedAt, index: entry.index, purpose: entry.purpose }
}
