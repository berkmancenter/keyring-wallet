/**
 * TSP direct-mode messaging (`pack`/`unpack`), ported onto tsp-core's three
 * ports (`./ports`) instead of raw private key material — the gap
 * `tsp-reference/ref-09`'s investigation named as the actual blocker to
 * custody: the real `@openvtc/vti-tsp-js` package's own `pack`/`unpack` take
 * raw `PackKeys`/`UnpackKeys` directly, with no injection point for an
 * opaque signer/key-agreement.
 *
 * TypeScript port of `tsp-reference/ref-12-direct-ts-port/direct-port.mjs`,
 * proven there both directions against the real published package and
 * end-to-end over two real Askar identities with a real Credo `VidResolver`
 * — see `docs/plans/openvtc-integration-plan/2026-09-02-bam.md`.
 *
 * The CESR framing below is NOT a hand transcription of the real package's
 * `message/direct.ts` — it's rebuilt from that SAME package's own exported
 * `cesr` (wire.ts) and `encodeEnvelope`/`decodeEnvelope` (envelope.ts), which
 * are pure byte/VID framing with no keys involved (confirmed byte-identical
 * between the published `0.1.0` this package depends on and the pinned
 * `89d70c4` clone — only `crypto/hpke.ts`'s backend changed between those,
 * not the framing). Reusing the real exports instead of retyping them
 * removes an entire class of transcription bugs from the one thing that has
 * to be byte-exact for wire interop. What's actually new here is the
 * orchestration: local key material always comes from a port
 * ({@link TspIdentity}); a counterparty's public keys always come from a
 * {@link VidResolver}, never passed in directly.
 *
 * @module trust-tasks/tsp/direct
 */

import { cesr, encodeEnvelope, decodeEnvelope, type MessageType } from '@openvtc/vti-tsp-js'
import { sha256 } from '@noble/hashes/sha2.js'
import { ed25519 } from '@noble/curves/ed25519.js'

import * as hpke from './hpke'
import type { TspIdentity, VidResolver } from './ports'

export type { MessageType }

const ENC_LEN = 32
const TAG_LEN = 16
const SIG_LEN = 64
const SIG_QUADLETS = Math.ceil(SIG_LEN / 3) // 22
const EMPTY = new Uint8Array(0)

const utf8 = new TextEncoder()
const fromUtf8 = new TextDecoder('utf-8', { fatal: true })

export interface PackedMessage {
  /** Raw wire bytes. */
  bytes: Uint8Array
  /** SHA-256 of the plaintext payload frame — the TSP thread digest. */
  threadDigest: Uint8Array
}

export interface UnpackedMessage {
  /** The decrypted message body. */
  payload: Uint8Array
  /** Sender VID (from the cleartext envelope). */
  sender: string
  /** Receiver VID (from the cleartext envelope). */
  receiver: string
  /** The message kind recovered from the payload frame. */
  messageType: MessageType
  /** Remaining route for a Routed message (empty for Direct/Nested). */
  hops: string[]
  /** SHA-256 of the decrypted payload frame — the TSP thread digest. */
  threadDigest: Uint8Array
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

interface DecodedFrame {
  kind: MessageType
  hops: string[]
  body: Uint8Array
}

/** Build the CESR payload frame that gets encrypted:
 *   Direct → `-Z XSCS <B> body`
 *   Nested → `-Z XHOP -J0 <B> body`
 *   Routed → `-Z XHOP -J<n> (B hop)* <B> body`  */
function encodePayloadFrame(body: Uint8Array, kind: MessageType, hops: string[]): Uint8Array {
  const frameBody: number[] = []
  if (kind === 'direct') {
    for (const b of cesr.XSCS) frameBody.push(b)
  } else {
    for (const b of cesr.XHOP) frameBody.push(b)
    cesr.encodeHops(
      hops.map((h) => utf8.encode(h)),
      frameBody
    )
  }
  cesr.encodeVariableData(cesr.TSP_PLAINTEXT, body, frameBody)

  const out: number[] = []
  cesr.encodeCount(cesr.TSP_PAYLOAD, frameBody.length / 3, out)
  for (const b of frameBody) out.push(b)
  return new Uint8Array(out)
}

/** Decode a payload frame into its kind, remaining route, and body. */
function decodePayloadFrame(frame: Uint8Array): DecodedFrame {
  const cur: cesr.Cursor = { pos: 0 }
  if (cesr.decodeCount(cesr.TSP_PAYLOAD, frame, cur) === undefined) {
    throw new Error('tsp: missing -Z payload frame')
  }
  // Optional ESSR sender-VID: the reference omits it for HPKE-Auth. A non-VID
  // marker won't match a `B` var-data field, so this is a tolerant skip.
  cesr.decodeVariableData(cesr.TSP_VID, frame, cur)

  const marker = frame.slice(cur.pos, cur.pos + 3)
  if (bytesEqual(marker, cesr.XSCS)) {
    cur.pos += 3
    const body = cesr.decodeVariableData(cesr.TSP_PLAINTEXT, frame, cur)
    if (body === undefined) throw new Error('tsp: missing payload plaintext')
    return { kind: 'direct', hops: [], body }
  }
  if (bytesEqual(marker, cesr.XHOP)) {
    cur.pos += 3
    const hopBytes = cesr.decodeHops(frame, cur)
    if (hopBytes === undefined) throw new Error('tsp: malformed hop list')
    let hops: string[]
    try {
      hops = hopBytes.map((h) => fromUtf8.decode(h))
    } catch {
      throw new Error('tsp: hop VID not UTF-8')
    }
    const body = cesr.decodeVariableData(cesr.TSP_PLAINTEXT, frame, cur)
    if (body === undefined) throw new Error('tsp: missing payload plaintext')
    return { kind: hops.length === 0 ? 'nested' : 'routed', hops, body }
  }
  throw new Error('tsp: unsupported payload type marker')
}

/** Encode the signature frame: `-C<n> -K<n> <fixed B> sig(64)`. */
function encodeSignatureFrame(signature: Uint8Array, out: number[]): void {
  cesr.encodeCount(cesr.TSP_ATTACH_GRP, SIG_QUADLETS, out)
  cesr.encodeCount(cesr.TSP_INDEX_SIG_GRP, SIG_QUADLETS, out)
  cesr.encodeFixedData(cesr.ED25519_SIGNATURE, signature, out)
}

/** Decode the signature frame; returns the 64-byte Ed25519 signature. */
function decodeSignatureFrame(data: Uint8Array, cur: cesr.Cursor): Uint8Array {
  const a = cesr.decodeCount(cesr.TSP_ATTACH_GRP, data, cur)
  const k = cesr.decodeCount(cesr.TSP_INDEX_SIG_GRP, data, cur)
  if (a !== SIG_QUADLETS || k !== SIG_QUADLETS) {
    throw new Error('tsp: unexpected signature group size')
  }
  const sig = cesr.decodeFixedData(cesr.ED25519_SIGNATURE, SIG_LEN, data, cur)
  if (sig === undefined) throw new Error('tsp: missing Ed25519 signature')
  return sig
}

/**
 * Pack a direct TSP message: build the envelope (= HPKE info), HPKE-Auth seal
 * the payload frame (empty AAD) against the receiver's key as resolved by
 * `resolver`, append `enc`, then sign envelope‖ciphertext with the sender's
 * own `SigningKey` port.
 * @param senderIdentity the sender's OWN local ports; never resolved, always
 *   custody-backed.
 * @param resolver resolves the COUNTERPARTY's (receiver's) public keys.
 */
export async function pack(
  body: Uint8Array,
  senderVid: string,
  receiverVid: string,
  senderIdentity: TspIdentity,
  resolver: VidResolver
): Promise<PackedMessage> {
  return packWithHops(body, 'direct', [], senderVid, receiverVid, senderIdentity, resolver)
}

/** Like {@link pack} but for any message kind, carrying a routing `hops`
 *  list in the payload frame. */
export async function packWithHops(
  body: Uint8Array,
  kind: MessageType,
  hops: string[],
  senderVid: string,
  receiverVid: string,
  senderIdentity: TspIdentity,
  resolver: VidResolver
): Promise<PackedMessage> {
  const envelopeBytes = encodeEnvelope(senderVid, receiverVid)

  const payloadFrame = encodePayloadFrame(body, kind, hops)
  const threadDigest = sha256(payloadFrame)

  const { encryptionPublicKey: receiverEncPk } = await resolver.resolve(receiverVid)
  const sealed = await hpke.seal(payloadFrame, EMPTY, senderIdentity.keyAgreement, receiverEncPk, envelopeBytes)
  // Reference ciphertext layout: ct ‖ tag(16) ‖ enc(32).
  const gPayload = concat(sealed.ciphertext, sealed.enc)

  const wireBytes: number[] = []
  for (const b of envelopeBytes) wireBytes.push(b)
  cesr.encodeVariableData(cesr.TSP_HPKEAUTH_CIPHERTEXT, gPayload, wireBytes)

  const signature = await senderIdentity.signingKey.sign(new Uint8Array(wireBytes))
  encodeSignatureFrame(signature, wireBytes)

  return { bytes: new Uint8Array(wireBytes), threadDigest }
}

/**
 * Unpack a direct TSP message: parse the envelope (HPKE info), resolve the
 * claimed sender's keys via `resolver`, verify the outer Ed25519 signature,
 * split `enc` off the tail, and HPKE-Auth open (empty AAD) using the
 * receiver's own `KeyAgreement` port.
 * @param receiverIdentity the receiver's OWN local port; never resolved,
 *   always custody-backed.
 * @param resolver resolves the COUNTERPARTY's (sender's) public keys, by the
 *   VID the cleartext envelope claims — the caller is responsible for
 *   deciding whether that claimed sender is who it expected (`direct.ts`
 *   leaves this to its own caller too; the ports carry no policy).
 */
export async function unpack(
  wireBytes: Uint8Array,
  receiverIdentity: Pick<TspIdentity, 'keyAgreement'>,
  resolver: VidResolver
): Promise<UnpackedMessage> {
  if (wireBytes.length < 48) throw new Error('tsp: message too short')

  const { envelope, headerLen } = decodeEnvelope(wireBytes)
  const envelopeBytes = wireBytes.slice(0, headerLen)

  const cur: cesr.Cursor = { pos: headerLen }
  const ctRange = cesr.decodeVariableDataRange(cesr.TSP_HPKEAUTH_CIPHERTEXT, wireBytes, cur)
  if (ctRange === undefined) throw new Error('tsp: missing G ciphertext frame')
  const signedEnd = cur.pos // signature covers envelope‖ciphertext

  const gLen = ctRange.end - ctRange.begin
  if (gLen > cesr.MAX_FIELD_SIZE) throw new Error('tsp: ciphertext too large')
  if (gLen < ENC_LEN + TAG_LEN) throw new Error('tsp: ciphertext truncated')

  const signature = decodeSignatureFrame(wireBytes, cur)
  if (cur.pos !== wireBytes.length) throw new Error('tsp: trailing bytes after signature')

  const { signingPublicKey: senderSignPk, encryptionPublicKey: senderEncPk } = await resolver.resolve(envelope.sender)
  if (!ed25519.verify(signature, wireBytes.slice(0, signedEnd), senderSignPk)) {
    throw new Error('tsp: signature verification failed')
  }

  const gPayload = wireBytes.slice(ctRange.begin, ctRange.end)
  const encStart = gPayload.length - ENC_LEN
  const enc = gPayload.slice(encStart)
  const ctAndTag = gPayload.slice(0, encStart)

  const payloadFrame = await hpke.open(ctAndTag, EMPTY, enc, receiverIdentity.keyAgreement, senderEncPk, envelopeBytes)
  const threadDigest = sha256(payloadFrame)
  const frame = decodePayloadFrame(payloadFrame)

  return {
    payload: frame.body,
    sender: envelope.sender,
    receiver: envelope.receiver,
    messageType: frame.kind,
    hops: frame.hops,
    threadDigest,
  }
}

export { sha256 }
