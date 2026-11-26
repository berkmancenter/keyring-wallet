/**
 * Recognising a TSP frame on a multiplexed mediator socket, and the two
 * spellings it arrives in — what a transport needs before it holds any key.
 *
 * A VTI mediator carries TSP and DIDComm on one socket. A client *sends* a
 * TSP message as a binary frame (raw qb2 bytes); the mediator sniffs the
 * leading byte, stores the message base64url-encoded for the recipient, and
 * a recipient on a DIDComm-mode socket receives it as a **text** frame of
 * that base64url — the qb64 spelling of the same bytes. The classifier is
 * key-blind and sees the leading count code only.
 *
 * Two framings, because Rev 3 widened the `-E` count: under Rev 2 it covered
 * the envelope header alone and was always the three-byte short form,
 * leading byte `0xF8`, text `-E…`. Rev 3's count covers the ciphertext, so a
 * message past 4095 quadlets (~12 KB) takes the six-byte long form, leading
 * byte `0xFB`, text `--E…`. A classifier that knows only the first drops every
 * large Rev 3 message on the floor, silently (`tsp_rev3_subtask.md` §3.3) —
 * which is why both are matched here and the boundary is asserted in tests.
 *
 * Neither prefix is ambiguous against DIDComm, which is JSON (`{`) or a
 * compact JWS (`ey…`).
 *
 * @module trust-tasks/tsp/frame
 */

import { sha256 } from '@noble/hashes/sha2.js'

/** First byte of a TSP message framed with a short `-E` count code. */
export const TSP_MAGIC_BYTE = 0xf8
/** First byte of a TSP message framed with a long `-E` count code (Rev 3
 *  only, for messages past ~12 KB). */
export const TSP_MAGIC_BYTE_LONG = 0xfb

/** The largest quadlet count the short `-E` form can carry; one past it is
 *  long-framed. */
export const SHORT_COUNT_MAX_QUADLETS = 4095

const TSP_TEXT_PREFIXES = ['--E', '-E']

/** Does this text frame (base64url of qb2) look like a TSP message? A
 *  pre-classifier for routing, not a validator. */
export function isTspFrameText(text: unknown): text is string {
  return typeof text === 'string' && TSP_TEXT_PREFIXES.some((p) => text.startsWith(p))
}

/** The binary-domain twin of {@link isTspFrameText}. */
export function isTspFrameBytes(bytes: Uint8Array | undefined): boolean {
  const first = bytes?.[0]
  return first === TSP_MAGIC_BYTE || first === TSP_MAGIC_BYTE_LONG
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const B64_INDEX: Record<string, number> = Object.fromEntries(Array.from(B64, (c, i) => [c, i]))

/** base64url without padding — the qb64 text form the mediator delivers. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + B64[n & 63]
  }
  if (i + 1 === bytes.length) {
    const n = bytes[i] << 16
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63]
  } else if (i + 2 === bytes.length) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63]
  }
  return out
}

/** Decode base64url (padding optional). Throws on a character outside the alphabet. */
export function fromBase64Url(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '')
  const out: number[] = []
  let acc = 0
  let bits = 0
  for (const c of clean) {
    const v = B64_INDEX[c]
    if (v === undefined) throw new Error('tsp: not base64url')
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((acc >>> bits) & 0xff)
    }
  }
  return Uint8Array.from(out)
}

/** The mediator's queue id for a delivered TSP frame: SHA-256 (hex) of the
 *  text exactly as delivered. It is what a `messages-received` acknowledges. */
export function tspFrameQueueId(text: string): string {
  return Array.from(sha256(new TextEncoder().encode(text)), (b) => b.toString(16).padStart(2, '0')).join('')
}
