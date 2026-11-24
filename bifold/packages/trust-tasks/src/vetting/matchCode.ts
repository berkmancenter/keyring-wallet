/**
 * The match code two people read to each other at the start of a vetting
 * session — a port of `vta-sdk::vetting::match_code` (VTI-Eucalyptus-RC-0),
 * byte for byte.
 *
 * Derived from the `vetting/session/0.1` document's `id` under its own domain
 * tag, so a vetting session and a personhood challenge can never read out the
 * same eight characters. Crockford base32, so nothing can be misheard into
 * another valid code. What it proves: the person in front of the vetter is
 * driving the client that received *this* session, and so controls the join
 * DID the card is signed by. Nothing checks it server-side — `challenge`
 * binds the card cryptographically; reading it aloud binds the two humans.
 */

import { sha256 } from '@noble/hashes/sha2.js'

/** Domain separation, as `vetting/session/0.1` defines it (NUL-terminated). */
const DOMAIN_TAG = 'vetting-session-match/v1\0'

/** Crockford base32 — no I, L, O or U. */
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** First 40 bits of the digest → eight Crockford characters, a dash after four. */
export function matchCodeFromDigest(digest: Uint8Array): string {
  let bits = 0n
  for (const byte of digest.subarray(0, 5)) bits = (bits << 8n) | BigInt(byte)
  let out = ''
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += '-'
    const shift = BigInt(35 - 5 * i)
    out += CROCKFORD[Number((bits >> shift) & 0x1fn)]
  }
  return out
}

/** The `XXXX-XXXX` match code for a `vetting/session` document id. */
export function vettingMatchCode(sessionDocumentId: string): string {
  const encoder = new TextEncoder()
  const input = new Uint8Array([...encoder.encode(DOMAIN_TAG), ...encoder.encode(sessionDocumentId)])
  return matchCodeFromDigest(sha256(input))
}
