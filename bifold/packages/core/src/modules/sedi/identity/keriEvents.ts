/**
 * Building the KERI events a phone signs for its own identifiers: the inception of a transferable AID (the phone's
 * holder code) and, later, interaction events that anchor what it issues. They are written in exactly the form this
 * package's own reader and KEL replay read (../cesr, ../guardian/kel): KERI 2.0 JSON, the field order keripy writes
 * (the K0 kit's kel-jordan.cesr), a SHA2-256 'I' self-addressing prefix and Blake3 'E' event SAIDs, one P-256 key,
 * no witnesses, and indexed ECDSA signatures in a `-K` group. Pure: no keys, no storage, no network. Signing is the
 * caller's (the agent's KMS), so a private key is never handed to this module.
 *
 * @module sedi/identity/keriEvents
 */
import { DUMMY, digest } from '../guardian/kel'
import { KERI_V2_JSON } from '../cesr/codes'
import { b64Decode, b64Encode } from '../cesr/qb64'

const te = new TextEncoder()
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** A run of Base64url characters for `n`, `width` characters wide (CESR sizes, counts and indices). */
export function b64Int(n: number, width: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 64 ** width) throw new RangeError(`${n} does not fit ${width} characters`)
  let s = ''
  for (let i = 0; i < width; i++) {
    s = B64[n % 64] + s
    n = Math.floor(n / 64)
  }
  return s
}

/** Decode unpadded base64url (a JWK coordinate or key). */
export const fromB64url = (text: string): Uint8Array => {
  const pad = (4 - (text.length % 4)) % 4
  // Standard padding is never part of a JWK coordinate; added only to make whole quadlets for the decoder.
  return b64Decode(text + 'A'.repeat(pad)).slice(0, (text.length * 3) >> 2)
}

/** The compressed SEC1 form of a P-256 public key from its JWK coordinates (x, y: base64url, 32 bytes each). */
export function compressP256(x: string, y: string): Uint8Array {
  const xb = fromB64url(x)
  const yb = fromB64url(y)
  if (xb.length !== 32 || yb.length !== 32) throw new RangeError('a P-256 coordinate is not 32 bytes')
  const out = new Uint8Array(33)
  out[0] = (yb[31] & 1) === 1 ? 0x03 : 0x02
  out.set(xb, 1)
  return out
}

/** qb64 of a transferable P-256 verification key ('1AAJ', 48 characters): 3 lead bytes for the 4-character code. */
export function p256KeyQb64(compressed: Uint8Array): string {
  if (compressed.length !== 33) throw new RangeError('a compressed P-256 key is 33 bytes')
  const padded = new Uint8Array(36)
  padded.set(compressed, 3)
  return '1AAJ' + b64Encode(padded).slice(4)
}

/** qb64 of a non-transferable Ed25519 key ('B', 44 characters), which is also its basic AID. */
export function ed25519NQb64(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new RangeError('an Ed25519 public key is 32 bytes')
  const padded = new Uint8Array(33)
  padded.set(publicKey, 1)
  return 'B' + b64Encode(padded).slice(1)
}

/** The next-key commitment for a key: its qb64 text digested with SHA2-256 ('I'), as the K0 kit writes them. */
export function nextKeyDigest(keyQb64: string): string {
  return digest('I', te.encode(keyQb64))
}

/** qb64 of an indexed ECDSA P-256 signature ('E' + index, 88 characters) over its raw 64-byte r||s. */
export function indexedP256Sig(signature: Uint8Array, index: number): string {
  if (signature.length !== 64) throw new RangeError('a P-256 signature is 64 bytes (r || s)')
  const padded = new Uint8Array(66)
  padded.set(signature, 2)
  return 'E' + b64Int(index, 1) + b64Encode(padded).slice(2)
}

/** The serialised body with its version string carrying its own size in bytes. */
function withSize(fields: Record<string, unknown>): string {
  // The version string has a fixed width, so the size is measured once with a placeholder of the same width.
  const draft = JSON.stringify({ v: `${KERI_V2_JSON}AAAA.`, ...fields })
  const size = te.encode(draft).length
  return JSON.stringify({ v: `${KERI_V2_JSON}${b64Int(size, 4)}.`, ...fields })
}

/** An event body ready to sign: its exact text and bytes, its SAID and its AID. */
export interface EventBody {
  text: string
  raw: Uint8Array
  said: string
  pre: string
  sn: number
}

/**
 * The inception of a transferable AID with one P-256 key, committing to one next key: no witnesses, thresholds "1",
 * no configuration traits, no seals. The prefix is self-addressing (SHA2-256 'I') and the event SAID Blake3 ('E'),
 * both computed over the body with both fields dummied, exactly as kel.ts recomputes them.
 */
export function inceptionBody(keyQb64: string, nextDigest: string): EventBody {
  const fields = {
    t: 'icp',
    d: DUMMY,
    i: DUMMY,
    s: '0',
    kt: '1',
    k: [keyQb64],
    nt: '1',
    n: [nextDigest],
    bt: '0',
    b: [] as string[],
    c: [] as string[],
    a: [] as unknown[],
  }
  const dummied = withSize(fields)
  const pre = digest('I', te.encode(dummied))
  const said = digest('E', te.encode(dummied))
  const text = withSize({ ...fields, d: said, i: pre })
  return { text, raw: te.encode(text), said, pre, sn: 0 }
}

/** An interaction event anchoring `seals` after the event with SAID `prior` (for what the AID issues later). */
export function interactionBody(pre: string, sn: number, prior: string, seals: Record<string, string>[]): EventBody {
  if (!Number.isInteger(sn) || sn < 1) throw new RangeError('an interaction event follows the inception')
  const fields = { t: 'ixn', d: DUMMY, i: pre, s: sn.toString(16), p: prior, a: seals }
  const said = digest('E', te.encode(withSize(fields)))
  const text = withSize({ ...fields, d: said })
  return { text, raw: te.encode(text), said, pre, sn }
}

/** One event as it sits in a KEL stream: its body, then its controller signatures in one `-K` group. */
export function signedEvent(body: EventBody, signatures: string[]): string {
  const group = signatures.join('')
  if (group.length % 4 !== 0) throw new RangeError('a signature group is a whole number of quadlets')
  return body.text + '-K' + b64Int(group.length / 4, 2) + group
}
