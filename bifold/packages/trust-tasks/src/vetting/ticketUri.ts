/**
 * The `vetting-ticket:` link a vetter shows as a QR or pastes — a port of
 * `vta-sdk::vetting::ticket_uri` (VTI-Eucalyptus-RC-0) with the same rules,
 * so a link the reference client emits is one Keyring reads, and vice versa.
 *
 *   vetting-ticket:?v=1&community=<did>&vetter=<did>&ticket=<id>&secret=<b64url>
 *   vetting-ticket:?v=1&community=<did>&vetter=<did>&code=XXXX-XXXX
 *
 * Every value is percent-encoded outside RFC 3986's unreserved set (a DID's
 * `:` travels as `%3A`). A ticket is scanned (`ticket` + `secret`) or spoken
 * (`code`), never both; a fragment is refused; a repeated member is refused;
 * an unknown member is ignored so a later version can add one.
 */

export const TICKET_URI_SCHEME = 'vetting-ticket'
export const TICKET_URI_VERSION = '1'

/** The scanned form: a ticket id and its 32-byte secret (43 base64url chars). */
export interface QrTicket {
  ticketId: string
  secret: string
}
/** The spoken form: `XXXX-XXXX` in Crockford base32. */
export interface ShortCodeTicket {
  code: string
}
export type TicketPresentation = { qr: QrTicket } | { code: ShortCodeTicket }

export interface TicketUri {
  /** The community the vetter vets for. */
  community: string
  /** The vetter's DID — the addressee of the request. */
  vetter: string
  presentation: TicketPresentation
}

export class TicketUriError extends Error {
  constructor(
    readonly kind: 'malformed' | 'unsupportedVersion',
    message: string
  ) {
    super(message)
    this.name = 'TicketUriError'
  }
}
const malformed = (why: string) => new TicketUriError('malformed', `ticket URI: ${why}`)

// The schemas' patterns for the members, as the SDK's newtypes check them.
const DID = /^did:/
const CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/
const SECRET = /^[A-Za-z0-9_-]{43}$/
const TICKET_ID = /^[A-Za-z0-9._~:@+-]{1,128}$/

const UNRESERVED = /[A-Za-z0-9\-._~]/
function pctEncode(value: string): string {
  let out = ''
  for (const byte of new TextEncoder().encode(value)) {
    const ch = String.fromCharCode(byte)
    out += byte < 0x80 && UNRESERVED.test(ch) ? ch : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}
function pctDecode(value: string): string {
  if (!/^(?:[^%]|%[0-9A-Fa-f]{2})*$/.test(value)) throw malformed('bad percent-encoding')
  return decodeURIComponent(value)
}

/** Render a ticket as a URI; the inverse of `parseTicketUri`. */
export function encodeTicketUri(uri: TicketUri): string {
  let out = `${TICKET_URI_SCHEME}:?v=${TICKET_URI_VERSION}&community=${pctEncode(uri.community)}&vetter=${pctEncode(uri.vetter)}`
  if ('qr' in uri.presentation) {
    out += `&ticket=${pctEncode(uri.presentation.qr.ticketId)}&secret=${pctEncode(uri.presentation.qr.secret)}`
  } else {
    out += `&code=${pctEncode(uri.presentation.code.code)}`
  }
  return out
}

export function isTicketUri(input: string): boolean {
  return new RegExp(`^${TICKET_URI_SCHEME}:`, 'i').test(input.trim())
}

/** Parse a ticket URI, refusing anything the reference reader refuses. */
export function parseTicketUri(input: string): TicketUri {
  const trimmed = input.trim()
  const colon = trimmed.indexOf(':')
  if (colon < 0) throw malformed('no scheme')
  if (trimmed.slice(0, colon).toLowerCase() !== TICKET_URI_SCHEME) throw malformed('not a vetting-ticket URI')
  const rest = trimmed.slice(colon + 1)
  if (!rest.startsWith('?')) throw malformed('no query')
  const query = rest.slice(1)
  if (query.includes('#')) throw malformed('a ticket URI carries no fragment')

  const members: Partial<Record<'v' | 'community' | 'vetter' | 'ticket' | 'secret' | 'code', string>> = {}
  for (const pair of query.split('&')) {
    if (pair === '') continue
    const eq = pair.indexOf('=')
    if (eq < 0) throw malformed('a member has no value')
    const name = pair.slice(0, eq)
    const value = pair.slice(eq + 1)
    if (!['v', 'community', 'vetter', 'ticket', 'secret', 'code'].includes(name)) continue
    const key = name as keyof typeof members
    if (members[key] !== undefined) throw malformed('a member is repeated')
    members[key] = pctDecode(value)
  }

  if (members.v === undefined) throw malformed('no version')
  if (members.v !== TICKET_URI_VERSION) {
    throw new TicketUriError('unsupportedVersion', `ticket URI: version ${members.v.slice(0, 16)} is not supported`)
  }
  const community = members.community
  const vetter = members.vetter
  if (!community) throw malformed('no community')
  if (!vetter) throw malformed('no vetter')
  if (!DID.test(community)) throw malformed('community: not a DID')
  if (!DID.test(vetter)) throw malformed('vetter: not a DID')

  const { ticket, secret, code } = members
  let presentation: TicketPresentation
  if (ticket !== undefined && secret !== undefined && code === undefined) {
    if (!TICKET_ID.test(ticket)) throw malformed('ticket: breaks its pattern')
    if (!SECRET.test(secret)) throw malformed('secret: breaks its pattern')
    presentation = { qr: { ticketId: ticket, secret } }
  } else if (ticket === undefined && secret === undefined && code !== undefined) {
    if (!CODE.test(code)) throw malformed('code: breaks its pattern')
    presentation = { code: { code } }
  } else if (ticket === undefined && secret === undefined && code === undefined) {
    throw malformed('no ticket')
  } else if (code === undefined) {
    throw malformed('a scanned ticket needs both ticket and secret')
  } else {
    throw malformed('a ticket is scanned or spoken, not both')
  }
  return { community, vetter, presentation }
}
