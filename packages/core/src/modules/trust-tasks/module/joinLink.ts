/**
 * joinLink — a community's join code in the link forms other wallets read, taken to Join.
 *
 * A community's page can show its join code as one web link that three readers each take their own part of (first
 * seen at one community's site, IN-702):
 *
 *   https://<host>/?iuv=1&_oobid=<id>
 *
 * - `iuv=1` makes it an interaction URL (W3C VCALM, Working Draft of 13 October 2026, §3.7): asked for JSON it
 *   answers a `protocols` list whose `didcomm` entry is an out-of-band invitation link. The same link also comes
 *   with a `web+interaction:` prefix, which a phone hands to the wallet registered for that scheme.
 * - `_oobid` is DIDComm's short link: asked for JSON it answers an out-of-band 2.0 invitation.
 * - `didcomm://?_oob=<base64url>` carries that invitation inline.
 *
 * The invitation is from the community's DID, its goal code is the join task (`vtc/join-requests/submit`), and the
 * community's signed join manifest may be attached.
 *
 * Only a join is acted on. The goal code decides, and nothing else in the answer does: a join code opens Join for the
 * community it is from, exactly as that community's scanned DID does, and is never handed to the contact path. Any
 * other goal code is left to whatever read the link before this module existed. The community's name is never taken
 * from the link: Join shows what the community publishes.
 *
 * Reading a link by reference tells its host that someone scanned it. So a link is fetched only from the routing a
 * scan, a paste or an opened link runs (`routeKeyringAgentLink`), never in the background, and without cookies. The
 * one further step a VCALM answer may ask for stays on the first link's own origin, so the host that was scanned
 * cannot send the phone to ask somewhere else. One thing is not limited here: the platform follows a redirect the
 * host answers with, as it does for every link the app fetches.
 *
 * @module trust-tasks/module/joinLink
 */

import type { Agent } from '@credo-ts/core'
import { JsonEncoder } from '@credo-ts/core'

import { TRUST_TASK_V2_ENVELOPE_TYPE, verifyDocumentProof } from '@bifold/trust-tasks'

import { readManifest, type VtiManifest } from './joinManifest'
import { isJoinSubmitType, manifestWireOfResponse } from './joinWire'

/** The prefix a phone uses to hand an interaction URL to the wallet registered for it (VCALM §3.7.3). */
export const WEB_INTERACTION_PREFIX = 'web+interaction:'

const OOB_V2_INVITATION = 'https://didcomm.org/out-of-band/2.0/invitation'

/**
 * How long a link's host is waited for, and how much it may answer (a join answer with its manifest is about 4 KB).
 * The size is a bound only for an answer that declares its length (`content-length`): that one is refused before any
 * of it is read. An answer that declares none is read whole and measured afterwards, so it is bounded by the time
 * alone.
 */
const FETCH_MS = 10_000
const MAX_ANSWER_CHARS = 512_000

/**
 * How old an attached manifest may be, and how far ahead of this phone's clock. A community signs it as the link is
 * read; an older one, though truly signed, may no longer be what the community asks.
 */
const MANIFEST_MAX_AGE_MS = 10 * 60_000
const MANIFEST_MAX_AHEAD_MS = 5 * 60_000

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A link's query, by name. Read by hand: React Native's URLSearchParams is only partly there. */
function queryOf(link: string): Record<string, string> {
  const start = link.indexOf('?')
  if (start < 0) return {}
  const hash = link.indexOf('#', start)
  const out: Record<string, string> = {}
  for (const pair of link.slice(start + 1, hash < 0 ? undefined : hash).split('&')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    try {
      out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1))
    } catch {
      // a member that cannot be decoded is not read
    }
  }
  return out
}

/**
 * How a link may carry a join code, from its text alone:
 * - `inline`: the invitation is in the link (`_oob`), and it is a join. Nothing is fetched.
 * - `fetch`: the link has to be asked. `passOn` says what a link that turns out not to be a join is: an `https` link
 *   another reader took before (`true`: handed on to it, untouched), or one only this module reads (`false`).
 */
export type JoinLinkShape = { via: 'inline'; invitation: Json } | { via: 'fetch'; url: string; passOn: boolean }

/** A link under the `web+interaction:` prefix: ours to answer, whatever follows. */
export const isWebInteractionLink = (text: string): boolean =>
  text.trim().toLowerCase().startsWith(WEB_INTERACTION_PREFIX)

/**
 * Whether `text` may carry a join code, and how. Undefined for everything else, an inline invitation with any other
 * goal code included: those stay with the reader they always had.
 */
export function joinLinkShape(text: string): JoinLinkShape | undefined {
  const trimmed = text.trim()
  const prefixed = isWebInteractionLink(trimmed)
  const link = prefixed ? trimmed.slice(WEB_INTERACTION_PREFIX.length) : trimmed
  const query = queryOf(link)
  if (query._oob) {
    let invitation: unknown
    try {
      invitation = JsonEncoder.fromBase64Url(query._oob)
    } catch {
      invitation = undefined
    }
    if (isObject(invitation) && isJoinInvitation(invitation)) return { via: 'inline', invitation }
  }
  if (!/^https:\/\/[^/?#\s]/i.test(link)) return undefined
  if (prefixed) return { via: 'fetch', url: link, passOn: false }
  if (query._oobid || query.iuv === '1') return { via: 'fetch', url: link, passOn: true }
  return undefined
}

/** An out-of-band 2.0 invitation whose goal code is the join task. The one test that makes a link a join code. */
function isJoinInvitation(json: Json): boolean {
  return json.type === OOB_V2_INVITATION && isObject(json.body) && isJoinSubmitType(json.body.goal_code)
}

/** What a link's answer is, for joining. */
export type JoinLinkRead =
  /** A join code for `communityDid`. `manifest` is the attached manifest document, as sent: not yet checked. */
  | { kind: 'join'; communityDid: string; manifest?: Json }
  /** A join code past its `expires_time`. */
  | { kind: 'expired' }
  /** A join code, from something Keyring joins nothing at (not a did:webvh or did:webs). */
  | { kind: 'unusable' }
  /** Read, and not a join code. */
  | { kind: 'notJoin' }
  /** Not read: no answer, not JSON, too large. */
  | { kind: 'unreadable' }

/** An invitation document as a join code, or why it is not one. Reads nothing but the document. */
export function readJoinInvitation(
  json: unknown,
  now: number = Date.now()
): Exclude<JoinLinkRead, { kind: 'unreadable' }> {
  if (!isObject(json) || !isJoinInvitation(json)) return { kind: 'notJoin' }
  // In seconds (DIDComm v2). One that is not a number says nothing, as an absent one does.
  if (typeof json.expires_time === 'number' && json.expires_time * 1000 < now) return { kind: 'expired' }
  const from = typeof json.from === 'string' ? json.from.trim() : ''
  if (!/^did:(webvh|webs):[^\s#?]+$/.test(from)) return { kind: 'unusable' }
  const manifest = attachedManifestDocument(json.attachments)
  return { kind: 'join', communityDid: from, ...(manifest ? { manifest } : {}) }
}

/** The first attached document that is a join manifest answer, bare or in a Trust Task envelope. */
function attachedManifestDocument(attachments: unknown): Json | undefined {
  if (!Array.isArray(attachments)) return undefined
  for (const attachment of attachments) {
    const carried = isObject(attachment) && isObject(attachment.data) ? attachment.data.json : undefined
    if (!isObject(carried)) continue
    const document = carried.type === TRUST_TASK_V2_ENVELOPE_TYPE ? carried.body : carried
    if (isObject(document) && manifestWireOfResponse(document.type)) return document
  }
  return undefined
}

/**
 * One GET of `url` for JSON, with no cookies, bounded in time, and in size as far as the answer declares it (see
 * `MAX_ANSWER_CHARS`). Undefined for anything but a JSON answer.
 */
async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), FETCH_MS)
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal: abort.signal,
    })
    if (!response.ok) return undefined
    if (!/^application\/([a-z0-9.+-]+\+)?json/i.test(response.headers.get('content-type') ?? '')) return undefined
    // Refused on what it declares, before the body is read: reading first would hold all of it in memory.
    const declared = Number(response.headers.get('content-length') ?? '')
    if (declared > MAX_ANSWER_CHARS) return undefined
    const text = await response.text()
    if (text.length > MAX_ANSWER_CHARS) return undefined
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** A web link's scheme, host and port, lower-cased: what two links must share to be on one origin. */
const originOf = (link: string): string | undefined => /^https:\/\/[^/?#\s]+/i.exec(link)?.[0].toLowerCase()

/** A VCALM answer's `didcomm` entry: the invitation's link (§3.7.4). */
function didcommProtocolOf(json: unknown): string | undefined {
  const protocols = isObject(json) ? json.protocols : undefined
  const link = isObject(protocols) ? protocols.didcomm : undefined
  return typeof link === 'string' ? link : undefined
}

/**
 * Read a link for a join code. An inline one is read as it stands. A fetched one is asked once; when its answer is a
 * VCALM `protocols` list and not the invitation itself, the `didcomm` entry is followed once more, and never further.
 *
 * That entry is whatever the first host wrote. It is asked only when it is on the first link's own origin: left free,
 * a scanned link could make the phone ask any address its host named, one inside the person's own network included.
 * An entry that carries the invitation inline asks nobody, and is read wherever it points.
 */
export async function readJoinLink(
  shape: JoinLinkShape,
  deps: { fetch?: typeof fetch; now?: number } = {}
): Promise<JoinLinkRead> {
  const now = deps.now ?? Date.now()
  if (shape.via === 'inline') return readJoinInvitation(shape.invitation, now)
  const fetchImpl = deps.fetch ?? fetch
  const answer = await fetchJson(shape.url, fetchImpl)
  if (answer === undefined) return { kind: 'unreadable' }
  const read = readJoinInvitation(answer, now)
  if (read.kind !== 'notJoin') return read
  const next = didcommProtocolOf(answer)
  const nextShape = next && next !== shape.url ? joinLinkShape(next) : undefined
  if (!nextShape) return read
  if (nextShape.via === 'inline') return readJoinInvitation(nextShape.invitation, now)
  if (originOf(nextShape.url) !== originOf(shape.url)) return read
  const second = await fetchJson(nextShape.url, fetchImpl)
  return second === undefined ? { kind: 'unreadable' } : readJoinInvitation(second, now)
}

/**
 * The manifest attached to a join code, when it is the community's own and current. Undefined otherwise, and then
 * Join reads the manifest from the community as it always has: nothing is lost but the saved read.
 *
 * A link's host is anyone, so the attachment is believed for one reason only: its proof verifies under the
 * community's DID. It must also be a manifest answer at a version this wallet reads, issued by that community, about
 * that community, and signed within the last few minutes.
 */
export async function attachedManifest(
  agent: Agent,
  communityDid: string,
  document: Json | undefined,
  now: number = Date.now()
): Promise<VtiManifest | undefined> {
  if (!document) return undefined
  const wire = manifestWireOfResponse(document.type)
  const payload = document.payload
  if (!wire || !isObject(payload) || !Array.isArray(payload.criteria)) return undefined
  if (document.issuer !== communityDid || payload.communityDid !== communityDid) return undefined
  const issuedAt = typeof document.issuedAt === 'string' ? Date.parse(document.issuedAt) : NaN
  if (!(issuedAt >= now - MANIFEST_MAX_AGE_MS && issuedAt <= now + MANIFEST_MAX_AHEAD_MS)) return undefined
  try {
    if (!(await verifyDocumentProof(agent, document, communityDid))) return undefined
    return readManifest(payload, wire)
  } catch {
    // A proof that could not be checked, or a manifest that cannot be shown as it stands: Join's own read decides.
    return undefined
  }
}
