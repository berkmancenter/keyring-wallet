/**
 * The moment a hardware-signed card's certificate chain is checked against.
 *
 * Checking the chain against the current time made every iPhone-signed card fail
 * about three days after signing, on both platforms: an App Attest leaf
 * certificate is valid for roughly 72 hours (docs/VRC_NATIVE_CRYPTO.md), and a
 * card is kept for months. The chain is now checked as it stood when the card
 * was signed.
 *
 * Where that time comes from is the whole of the security here. It is read only
 * from the signed content itself: `validFrom`, or VC 1.1's `issuanceDate`, of
 * the exact string the native verifier hashes and checks the hardware signature
 * over. A date anywhere else (the evidence block's `created`, which is stripped
 * from the signed bytes, or the phone's clock) is never used, so a forged or
 * edited date fails the signature check instead of moving the check's date.
 *
 * What the leaf's window bounds is what Apple attested, not when the signature
 * was made: a device that still holds the key can sign today with a date inside
 * the window. Checking against the current time did not prevent that either.
 *
 * @module hardware-signing/signingTime
 */

import { Buffer } from 'buffer'

/**
 * How long before its App Attest leaf certificate a card may be dated.
 *
 * A card's `validFrom` is set five minutes before it is built (the issuer's
 * clock-skew allowance, `CLOCK_SKEW_ALLOWANCE_MS` in vrc-manager), the
 * biometric prompt comes next, and on a freshly made key the chain is fetched
 * from Apple after the signature. So the leaf's `notBefore` routinely falls
 * minutes after the card's date. An hour covers the allowance, a slow prompt
 * and the attestation retries. It only lets a card predate its own
 * attestation: nothing is accepted after the leaf's `notAfter`.
 */
export const SIGNED_BEFORE_ATTESTATION_TOLERANCE_MS = 60 * 60 * 1000

/** Formats whose leaf validity window is checked. Android leaves carry key parameters, not a window. */
const LEAF_WINDOW_FORMATS: readonly string[] = ['apple-appattest-v1']

/**
 * The signed time a card carries, in milliseconds, or undefined when the signed
 * content names none (a challenge payload, say). Only an ISO 8601 date-time with
 * an explicit zone counts: a zoneless one would read differently on each phone.
 */
export function signedTimeOf(signedContent: string): number | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(signedContent)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const content = parsed as Record<string, unknown>
  const stamp = typeof content.validFrom === 'string' ? content.validFrom : content.issuanceDate
  if (typeof stamp !== 'string') return undefined
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(stamp)) return undefined
  const ms = Date.parse(stamp)
  return Number.isFinite(ms) ? ms : undefined
}

interface Der {
  tag: number
  start: number
  end: number
}

/**
 * One DER element's header. Its tag is the whole first identifier byte (0x30 is a SEQUENCE): enough for an X.509
 * certificate's validity, which uses only single-byte tags. keyDescription.ts has a second reader that also decodes
 * multi-byte (high) tags, which Android's key description uses (503, 504); use that one for anything past validity.
 */
function readDer(bytes: Uint8Array, offset: number, limit: number): Der {
  if (offset + 2 > limit) throw new Error('truncated DER')
  const tag = bytes[offset]
  let length = bytes[offset + 1]
  let start = offset + 2
  if (length & 0x80) {
    const count = length & 0x7f
    if (count === 0 || count > 4 || start + count > limit) throw new Error('unsupported DER length')
    length = 0
    for (let i = 0; i < count; i++) length = length * 256 + bytes[start + i]
    start += count
  }
  if (start + length > limit) throw new Error('DER length past the end')
  return { tag, start, end: start + length }
}

const UTC_TIME = 0x17
const GENERALIZED_TIME = 0x18

function derTime(bytes: Uint8Array, element: Der): number {
  const text = Buffer.from(bytes.subarray(element.start, element.end)).toString('ascii')
  // RFC 5280 4.1.2.5: UTCTime YYMMDDHHMMSSZ (YY < 50 is 20YY), GeneralizedTime YYYYMMDDHHMMSSZ.
  const match =
    element.tag === UTC_TIME
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
      : element.tag === GENERALIZED_TIME
        ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
        : null
  if (!match) throw new Error('unsupported certificate time')
  const year = element.tag === UTC_TIME ? (Number(match[1]) < 50 ? 2000 : 1900) + Number(match[1]) : Number(match[1])
  const [month, day, hour, minute, second] = match.slice(2).map(Number)
  return Date.UTC(year, month - 1, day, hour, minute, second)
}

/** A certificate's validity window, read from its PEM, or undefined when it cannot be read. */
export function certificateValidity(pem: string): { notBefore: number; notAfter: number } | undefined {
  try {
    const bytes = new Uint8Array(Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64'))
    const certificate = readDer(bytes, 0, bytes.length)
    const tbs = readDer(bytes, certificate.start, certificate.end)
    if (certificate.tag !== 0x30 || tbs.tag !== 0x30) return undefined
    // tbsCertificate: [0] version (optional), serialNumber, signature, issuer, validity.
    let element = readDer(bytes, tbs.start, tbs.end)
    if (element.tag === 0xa0) element = readDer(bytes, element.end, tbs.end)
    for (let skip = 0; skip < 3; skip++) element = readDer(bytes, element.end, tbs.end)
    if (element.tag !== 0x30) return undefined
    const notBefore = readDer(bytes, element.start, element.end)
    const notAfter = readDer(bytes, notBefore.end, element.end)
    return { notBefore: derTime(bytes, notBefore), notAfter: derTime(bytes, notAfter) }
  } catch {
    return undefined
  }
}

/**
 * When to check the chain: `{ ok: true, verifyAtMs }`, where 0 means "now" (the
 * content names no signed time), or `{ ok: false, error }` when the card's
 * signed time falls outside what its App Attest leaf certified.
 *
 * App Attest: the signed time T must lie in [notBefore − tolerance, notAfter],
 * and the chain is checked at max(T, notBefore). Android key attestation: the
 * chain is checked at T (the leaf's own window is not a validity statement).
 * A leaf that cannot be read leaves the check at the current time, as before.
 */
export function chainVerificationTime(
  signedContent: string,
  certificateChain: readonly string[],
  format: string
): { ok: true; verifyAtMs: number } | { ok: false; error: string } {
  const signedAt = signedTimeOf(signedContent)
  if (signedAt === undefined) return { ok: true, verifyAtMs: 0 }
  if (!LEAF_WINDOW_FORMATS.includes(format)) return { ok: true, verifyAtMs: signedAt }

  const leaf = certificateChain.length > 0 ? certificateValidity(certificateChain[0]) : undefined
  if (!leaf) return { ok: true, verifyAtMs: 0 }
  if (signedAt > leaf.notAfter) {
    return {
      ok: false,
      error: `Signed time ${new Date(signedAt).toISOString()} is after the attestation certificate expired (${new Date(leaf.notAfter).toISOString()})`,
    }
  }
  if (signedAt < leaf.notBefore - SIGNED_BEFORE_ATTESTATION_TOLERANCE_MS) {
    return {
      ok: false,
      error: `Signed time ${new Date(signedAt).toISOString()} is more than an hour before the attestation certificate (${new Date(leaf.notBefore).toISOString()})`,
    }
  }
  return { ok: true, verifyAtMs: Math.max(signedAt, leaf.notBefore) }
}
