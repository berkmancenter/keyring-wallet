/**
 * Whether an Android-attested signing key needs its owner every time: the hardware evidence's leaf certificate
 * carries Android's key description, which says how the key may be used. A key that needs no authentication (tag 503,
 * noAuthRequired) or names no hardware-enforced user authentication (tag 504, userAuthType) signs for any app holding
 * it, unlocked or not, so a card it signed earns no hardware shield. Read here, in the verifier both platforms share:
 * the iOS native verifier does not read Android key descriptions at all.
 *
 * Only the leaf the native verifier validated is read, and only after it passed (verify.ts): the same certificate
 * bytes, bound by public key to the leaf native reports, so a second certificate can never stand in for it.
 *
 * @module hardware-signing/keyDescription
 */

import { Buffer } from 'buffer'

/** Android's key description extension. */
const KEY_DESCRIPTION_OID = '1.3.6.1.4.1.11129.2.1.17'
const NO_AUTH_REQUIRED = 503
const USER_AUTH_TYPE = 504
/** attestationSecurityLevel: 0 Software, 1 TrustedEnvironment, 2 StrongBox. */
const HARDWARE_LEVELS = new Set([1, 2])

interface Der {
  /** Class and constructed bits of the first identifier byte. */
  cls: number
  constructed: boolean
  tag: number
  start: number
  end: number
  /** The whole element, header included. */
  from: number
}

function readDer(bytes: Uint8Array, offset: number, limit: number): Der {
  let at = offset
  if (at >= limit) throw new Error('truncated DER')
  const first = bytes[at++]
  let tag = first & 0x1f
  if (tag === 0x1f) {
    tag = 0
    for (let n = 0; ; n++) {
      if (at >= limit || n > 4) throw new Error('bad DER tag')
      const b = bytes[at++]
      tag = tag * 128 + (b & 0x7f)
      if (!(b & 0x80)) break
    }
  }
  if (at >= limit) throw new Error('truncated DER')
  let length = bytes[at++]
  if (length & 0x80) {
    const count = length & 0x7f
    if (count === 0 || count > 4 || at + count > limit) throw new Error('bad DER length')
    length = 0
    for (let i = 0; i < count; i++) length = length * 256 + bytes[at + i]
    at += count
  }
  if (at + length > limit) throw new Error('DER length past the end')
  return { cls: first & 0xc0, constructed: !!(first & 0x20), tag, start: at, end: at + length, from: offset }
}

function children(bytes: Uint8Array, parent: Der): Der[] {
  const out: Der[] = []
  for (let at = parent.start; at < parent.end; ) {
    const child = readDer(bytes, at, parent.end)
    out.push(child)
    at = child.end
  }
  return out
}

function oidText(bytes: Uint8Array, element: Der): string {
  const body = bytes.subarray(element.start, element.end)
  const parts = [Math.floor(body[0] / 40), body[0] % 40]
  let value = 0
  for (let i = 1; i < body.length; i++) {
    value = value * 128 + (body[i] & 0x7f)
    if (!(body[i] & 0x80)) {
      parts.push(value)
      value = 0
    }
  }
  return parts.join('.')
}

function integerValue(bytes: Uint8Array, element: Der): number {
  let value = 0
  for (let i = element.start; i < element.end; i++) value = value * 256 + bytes[i]
  return value
}

const UNIVERSAL = 0x00
const CONTEXT = 0x80
const INTEGER = 0x02
const ENUMERATED = 0x0a

export interface LeafFacts {
  /** The leaf's SubjectPublicKeyInfo, DER (the form Android's native verifier reports). */
  spki: Uint8Array
  /** The key itself, the SPKI's BIT STRING content (the form iOS's native verifier reports for an EC key). */
  rawKey: Uint8Array
  keyDescription?: {
    securityLevel: number
    software: Map<number, Der>
    hardware: Map<number, Der>
    bytes: Uint8Array
  }
}

function authorizationList(bytes: Uint8Array, list: Der): Map<number, Der> {
  const entries = new Map<number, Der>()
  for (const entry of children(bytes, list)) {
    if (entry.cls !== CONTEXT) throw new Error('authorization list entry is not context-tagged')
    const [inner] = children(bytes, entry)
    if (inner) entries.set(entry.tag, inner)
  }
  return entries
}

/** The leaf certificate's public key and Android key description, or undefined when it cannot be read. */
export function readLeaf(pem: string): LeafFacts | undefined {
  try {
    const bytes = new Uint8Array(Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64'))
    const certificate = readDer(bytes, 0, bytes.length)
    const [tbs] = children(bytes, certificate)
    const fields = children(bytes, tbs)
    // [0] version (optional), serialNumber, signature, issuer, validity, subject, subjectPublicKeyInfo, [1]/[2]/[3].
    const universal = fields.filter((field) => field.cls === UNIVERSAL)
    const spkiElement = universal[5]
    if (!spkiElement || spkiElement.tag !== 0x10) return undefined
    const [, bitString] = children(bytes, spkiElement)
    if (!bitString || bitString.tag !== 0x03) return undefined
    const facts: LeafFacts = {
      spki: bytes.slice(spkiElement.from, spkiElement.end),
      rawKey: bytes.slice(bitString.start + 1, bitString.end),
    }
    const extensionsWrapper = fields.find((field) => field.cls === CONTEXT && field.tag === 3)
    if (!extensionsWrapper) return facts
    const [extensions] = children(bytes, extensionsWrapper)
    for (const extension of children(bytes, extensions)) {
      const parts = children(bytes, extension)
      if (oidText(bytes, parts[0]) !== KEY_DESCRIPTION_OID) continue
      const value = parts[parts.length - 1]
      const description = readDer(bytes, value.start, value.end)
      const items = children(bytes, description)
      if (items.length < 8 || items[6].tag !== 0x10 || items[7].tag !== 0x10) return undefined
      facts.keyDescription = {
        securityLevel: integerValue(bytes, items[1]),
        software: authorizationList(bytes, items[6]),
        hardware: authorizationList(bytes, items[7]),
        bytes,
      }
    }
    return facts
  } catch {
    return undefined
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

/**
 * Whether the leaf at `leafPem` is the one whose public key the native verifier reported (`leafPublicKeyBase64`,
 * an SPKI on Android, the raw key on iOS).
 */
export function isLeafNativeChecked(leaf: LeafFacts, leafPublicKeyBase64: string | undefined): boolean {
  if (!leafPublicKeyBase64) return false
  const reported = new Uint8Array(Buffer.from(leafPublicKeyBase64, 'base64'))
  return reported.length > 0 && (sameBytes(reported, leaf.spki) || sameBytes(reported, leaf.rawKey))
}

/**
 * Why the key cannot earn a hardware shield, or undefined when it requires its owner's authentication, enforced in
 * secure hardware: a TEE or StrongBox attestation whose hardware-enforced list names a user authentication type and
 * that says nowhere that no authentication is needed. Anything unreadable fails closed.
 */
export function userAuthenticationRefusal(leaf: LeafFacts | undefined): string | undefined {
  const description = leaf?.keyDescription
  if (!description) return 'the key description could not be read'
  if (!HARDWARE_LEVELS.has(description.securityLevel)) return 'the key is not attested in secure hardware'
  if (description.software.has(NO_AUTH_REQUIRED) || description.hardware.has(NO_AUTH_REQUIRED)) {
    return 'the key needs no user authentication'
  }
  // INTEGER on paper; ENUMERATED accepted too, as devices have been seen to encode the security level that way. What
  // the rule needs is a non-zero auth type, inside a chain native has already validated.
  const authType = description.hardware.get(USER_AUTH_TYPE)
  if (
    !authType ||
    (authType.tag !== INTEGER && authType.tag !== ENUMERATED) ||
    integerValue(description.bytes, authType) === 0
  ) {
    return 'the key names no user authentication enforced in secure hardware'
  }
  return undefined
}
