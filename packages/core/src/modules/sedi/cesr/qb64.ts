/**
 * Base64url and qb64 primitives, with no Node built-ins (Hermes-safe).
 *
 * @module sedi/cesr/qb64
 */
import { KEYS } from './codes'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const INDEX: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]))

/** The integer a run of Base64url characters encodes (CESR sizes, counts and indices). */
export function b64Int(text: string): number {
  let n = 0
  for (const c of text) {
    const v = INDEX[c]
    if (v === undefined) throw new RangeError(`not a Base64url character: ${c}`)
    n = n * 64 + v
  }
  return n
}

/** Decode Base64url text whose length is a multiple of 4. */
export function b64Decode(text: string): Uint8Array {
  if (text.length % 4 !== 0) throw new RangeError('Base64url text is not a whole number of quadlets')
  const out = new Uint8Array((text.length / 4) * 3)
  for (let i = 0, o = 0; i < text.length; i += 4, o += 3) {
    const n = (b64Int(text[i]) << 18) | (b64Int(text[i + 1]) << 12) | (b64Int(text[i + 2]) << 6) | b64Int(text[i + 3])
    out[o] = (n >> 16) & 255
    out[o + 1] = (n >> 8) & 255
    out[o + 2] = n & 255
  }
  return out
}

/** Encode bytes as Base64url (no padding characters; a 32-byte digest with its lead byte gives 44 characters). */
export function b64Encode(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]
  }
  return s
}

/**
 * The raw bytes of a qb64 primitive whose code is `codeSize` characters: the code's bits are zeroed and the lead bytes
 * they occupy (1 for a 1-character code, 2 for 2, 3 for 4) are dropped.
 */
export function rawOf(qb64: string, codeSize: number): Uint8Array {
  const lead = Math.ceil((codeSize * 6) / 8)
  return b64Decode('A'.repeat(codeSize) + qb64.slice(codeSize)).slice(lead)
}

/** A verification key's code, or undefined when this reader does not support it. */
export function keyCode(qb64: string): string | undefined {
  const four = qb64.slice(0, 4)
  if (KEYS[four] && qb64.length === KEYS[four].fs) return four
  const one = qb64[0]
  if (KEYS[one] && qb64.length === KEYS[one].fs) return one
  return undefined
}
