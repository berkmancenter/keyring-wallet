/**
 * The enrolment offer — how a device learns which agent to link to, and where
 * to hand over its key, from one scan or one pasted link.
 *
 * An admin's page (the lab stand-in for a console upstream does not have yet)
 * shows the offer as a QR and as the same text to copy. The phone scans or
 * pastes it, mints a temporary manager key, submits that key to `url` with a
 * proof it holds it, and both screens show the same enrolment code before the
 * admin grants. The shape is deliberately small: a QR carries it comfortably.
 *
 *   keyring://vta/enrol?o=<base64url(JSON offer)>
 *
 * Platform-neutral on purpose — the page and the phone must derive the same
 * code from the same inputs, byte for byte.
 */

import { sha256 } from '@noble/hashes/sha2.js'

import { matchCodeFromDigest } from '../vetting/matchCode'

export const ENROLMENT_LINK_PREFIX = 'keyring://vta/enrol?o='

/** Domain separation for the code both screens show; never shared with the vetting match code. */
const ENROLMENT_CODE_TAG = 'keyring-vta-enrol/v1'

export interface EnrolmentOffer {
  v: 1
  t: 'vta-enrol'
  /** The agent the phone is being linked to. */
  vta: string
  /** A human name for the agent's host, shown before the person agrees. */
  label: string
  /** Where the phone submits its key; also the audience of its proof. */
  url: string
  /** Single-use nonce, base64url. */
  n: string
  /** Unix seconds after which the offer is refused. */
  exp: number
}

export class EnrolmentOfferError extends Error {
  constructor(
    message: string,
    public readonly reason: 'notAnOffer' | 'malformed' | 'expired'
  ) {
    super(message)
    this.name = 'EnrolmentOfferError'
  }
}

export function isEnrolmentLink(text: string): boolean {
  return text.trim().startsWith(ENROLMENT_LINK_PREFIX)
}

export function encodeEnrolmentLink(offer: EnrolmentOffer): string {
  const ordered = {
    v: offer.v,
    t: offer.t,
    vta: offer.vta,
    label: offer.label,
    url: offer.url,
    n: offer.n,
    exp: offer.exp,
  }
  return ENROLMENT_LINK_PREFIX + base64UrlEncode(new TextEncoder().encode(JSON.stringify(ordered)))
}

/**
 * Parse and check an enrolment link. `nowSeconds` is injectable for tests; an
 * expired offer is refused here so a stale QR fails before anything is minted.
 */
export function parseEnrolmentLink(text: string, nowSeconds = Math.floor(Date.now() / 1000)): EnrolmentOffer {
  const trimmed = text.trim()
  if (!isEnrolmentLink(trimmed)) throw new EnrolmentOfferError('not an enrolment link', 'notAnOffer')
  let parsed: unknown
  try {
    const encoded = decodeURIComponent(trimmed.slice(ENROLMENT_LINK_PREFIX.length).split('&')[0])
    parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded)))
  } catch {
    throw new EnrolmentOfferError('the enrolment link could not be read', 'malformed')
  }
  const o = parsed as Partial<EnrolmentOffer>
  const fields =
    o &&
    o.v === 1 &&
    o.t === 'vta-enrol' &&
    typeof o.vta === 'string' &&
    o.vta.startsWith('did:') &&
    typeof o.label === 'string' &&
    typeof o.url === 'string' &&
    /^https?:\/\//.test(o.url) &&
    typeof o.n === 'string' &&
    o.n.length >= 16 &&
    typeof o.exp === 'number'
  if (!fields) throw new EnrolmentOfferError('the enrolment link is missing a field', 'malformed')
  if (nowSeconds > (o.exp as number)) throw new EnrolmentOfferError('the enrolment link has expired', 'expired')
  return o as EnrolmentOffer
}

/** The `XXXX-XXXX` code both screens show for this offer and this device key. */
export function enrolmentCode(nonce: string, did: string): string {
  return matchCodeFromDigest(sha256(new TextEncoder().encode(`${ENROLMENT_CODE_TAG}|${nonce}|${did}`)))
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function base64UrlEncode(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i] << 16
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63]
  }
  return out
}

export function base64UrlDecode(text: string): Uint8Array {
  const clean = text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of clean) {
    const value = B64.indexOf(char)
    if (value < 0) throw new Error(`invalid base64url character: ${char}`)
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}
