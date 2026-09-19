/**
 * TSP **Rev 3** direct-mode messaging over the three ports (`./ports`) — the
 * revision Keyring packs.
 *
 * Layout (spec Rev 3 §9.1–§9.2, as `@openvtc/vti-tsp-js` 0.3.0 packs it):
 *
 *   -E<count>                     one frame; the count covers everything below
 *     YTSP-AAC                      version marker
 *     <B> sender-VID
 *     <B> receiver-VID
 *     <F> enc ‖ ct                HPKE-Base ciphertext, AEAD tag inside ct
 *   -C23 -K22 B0 sig(64)          indexed Ed25519 signature over the -E frame
 *
 * and the plaintext the ciphertext seals, the payload frame:
 *
 *   Direct  -Z<n> XSCS  sndr  pad  -A<n> <B body>
 *   Nested  -Z<n> XHOP  sndr  -JAA        pad  <raw inner message>
 *   Routed  -Z<n> XHOP  sndr  -J<n> hops  pad  <raw inner message>
 *
 * The framing is rebuilt here on the vendored package's own exported `cesr`
 * table rather than imported from it, for the same reason the Rev 2 codec
 * was: the package's `pack`/`unpack` take raw private keys, and its Rev 3
 * field/payload codecs are internal modules its `exports` map does not reach.
 * What is ours is the orchestration — local key material always comes from a
 * port, a counterparty's public keys always from a {@link VidResolver} — and
 * the tests in `@bifold/core` cross-check every byte against the package's
 * own packer and unpacker and against the specification's Appendix A vectors.
 *
 * What Rev 3 changed, and where it lands here:
 *
 * - HPKE-**Base**: the sender's static key leaves the KEM. `packRev3` never
 *   calls `keyAgreement.agree()`; it needs only a `SigningKey`. The receiver's
 *   decap is one `agree(enc)` through its port (`hpke.openBase`).
 * - `info` is the fixed code `YTSP-`; the AAD is the envelope *fields*
 *   (version ‖ VID_sndr ‖ VID_rcvr) without the `-E` count code.
 * - The `-E` count covers the ciphertext, so the frame is finalized after
 *   sealing; past 4095 quadlets the count takes the six-byte long form
 *   (`--E…`, leading byte `0xFB`), which an ingress classifier has to accept.
 * - Ciphertext code `G` → `F`, and the field is `enc ‖ ct` (Rev 2 put `enc`
 *   last).
 * - The signature is indexed (`B0`) under length-based counts `-C23 -K22`.
 * - Every payload layout carries the ESSR sender field and a padding field.
 *   The sender field is always written with the sender's VID and always
 *   checked against the envelope on read.
 *
 * @module trust-tasks/tsp/rev3
 */

import { cesr } from '@openvtc/vti-tsp-js'
import { sha256 } from '@noble/hashes/sha2.js'
import { ed25519 } from '@noble/curves/ed25519.js'

import * as hpke from './hpke'
import type { TspIdentity, VidResolver } from './ports'
import {
  bytesEqual,
  decodeUtf8Strict,
  utf8,
  type ApplicationKind,
  type PackedMessage,
  type UnpackedMessage,
} from './shared'

const ENC_LEN = 32
const TAG_LEN = 16
const SIG_LEN = 64
/** The `-K` group's content: the 2-byte indexed code plus 64 bytes of
 *  signature, 66 bytes = 22 quadlets. */
const SIG_GROUP_QUADLETS = 22
/** The `-C` group holds the `-K` header plus its content — §9.5 made these
 *  counts length-based, where Rev 2 repeated the same number twice. */
const ATTACH_GROUP_QUADLETS = SIG_GROUP_QUADLETS + 1
/** Only index 0 can be verified: a VID names one signing key here. */
const SIG_INDEX = 0

/**
 * Test-only knobs that make a pack byte-reproducible against published
 * vectors. **Never use outside tests.** A fixed HPKE ephemeral makes every
 * message sealed with it to the same recipient share one (key, base_nonce)
 * pair, which under ChaCha20-Poly1305 gives away both confidentiality and
 * integrity.
 */
export interface UnsafeDeterministicPack {
  /** RFC 9180 §7.1.3 `DeriveKeyPair` input for the HPKE-Base ephemeral — the
   *  `ikmE` the specification's Appendix A prints. */
  __unsafeIkmE: Uint8Array
  /** Write the NULL VID `4BAA` in the ESSR sender field instead of the
   *  sender's VID — §9.2 permits it under HPKE-Base and the published vectors
   *  use it; this codec's own stance is to always write the VID. */
  nullPayloadSender?: boolean
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface DecodedEnvelopeRev3 {
  sender: string
  /** Empty string is the NULL VID `4BAA` — "no receiver named". */
  receiver: string
  /** Byte range of the encoded envelope fields — the HPKE-Base AAD. */
  aad: { begin: number; end: number }
  /** Offset just past the envelope fields: where the ciphertext field begins. */
  headerLen: number
  /** Offset just past the signable content the `-E` count declares. */
  contentEnd: number
  /** MINOR as carried. Never gates processing (`tsp_rev3_subtask.md` §3.5). */
  minor: number
}

/** The envelope *fields* — version, sender VID, receiver VID — without the
 *  enclosing `-E` count code. These bytes are the HPKE-Base AAD. */
export function encodeFieldsRev3(sender: string, receiver: string): Uint8Array {
  const body: number[] = []
  cesr.encodeVersion(body)
  cesr.encodeVariableData(cesr.TSP_VID, utf8.encode(sender), body)
  cesr.encodeVariableData(cesr.TSP_VID, utf8.encode(receiver), body)
  if (body.length % 3 !== 0) throw new Error('tsp: envelope fields not a multiple of 3 bytes')
  return new Uint8Array(body)
}

/** Prepend the `-E` count code to `fields ‖ body`. The count covers both and
 *  excludes the signature attachment appended afterwards. */
export function finalizeFrameRev3(fields: Uint8Array, body: Uint8Array): Uint8Array {
  const contentLen = fields.length + body.length
  if (contentLen % 3 !== 0) throw new Error('tsp: envelope content not a multiple of 3 bytes')
  const out: number[] = []
  cesr.encodeCount(cesr.TSP_ETS_WRAPPER, contentLen / 3, out)
  for (const b of fields) out.push(b)
  for (const b of body) out.push(b)
  return new Uint8Array(out)
}

/** Decode a Rev 3 envelope and the offsets needed to open and verify it. */
export function decodeEnvelopeRev3(data: Uint8Array): DecodedEnvelopeRev3 {
  const cur: cesr.Cursor = { pos: 0 }
  const quadlets = cesr.decodeCount(cesr.TSP_ETS_WRAPPER, data, cur)
  if (quadlets === undefined) throw new Error('tsp: missing -E envelope frame')
  const contentBegin = cur.pos
  const contentEnd = contentBegin + quadlets * 3
  if (contentEnd > data.length) throw new Error('tsp: -E frame declares more content than the message')

  const version = cesr.readVersion(data, cur)
  if (version === undefined) throw new Error('tsp: missing or malformed version marker')
  if (version.major !== cesr.TSP_VERSION.major) throw new Error(`tsp: unsupported TSP major version ${version.major}`)

  const senderBytes = cesr.decodeVariableData(cesr.TSP_VID, data, cur)
  if (senderBytes === undefined) throw new Error('tsp: missing sender VID')
  const receiverBytes = cesr.decodeVariableData(cesr.TSP_VID, data, cur)
  if (receiverBytes === undefined) throw new Error('tsp: missing receiver VID field')

  let sender: string
  let receiver: string
  try {
    sender = decodeUtf8Strict(senderBytes)
    receiver = decodeUtf8Strict(receiverBytes)
  } catch {
    throw new Error('tsp: invalid VID encoding')
  }
  if (sender.length === 0) throw new Error('tsp: sender VID is the NULL VID; every TSP message names its sender')
  if (cur.pos > contentEnd) throw new Error('tsp: envelope fields overrun the -E frame count')

  return {
    sender,
    receiver,
    aad: { begin: contentBegin, end: cur.pos },
    headerLen: cur.pos,
    contentEnd,
    minor: version.minor,
  }
}

// ---------------------------------------------------------------------------
// Payload frame
// ---------------------------------------------------------------------------

interface DecodedFrame {
  kind: ApplicationKind
  hops: string[]
  body: Uint8Array
  /** The ESSR sender VID as carried, or `""` for the NULL VID. */
  senderVid: string
}

/** The ESSR sender-VID field. The NULL VID is the empty string. */
function encodeSenderField(senderVid: string, out: number[]): void {
  cesr.encodeVariableData(cesr.TSP_VID, utf8.encode(senderVid), out)
}

/** The padding field — always written, always empty (§7.5). */
function encodeEmptyPadding(out: number[]): void {
  cesr.encodeVariableData(cesr.TSP_PLAINTEXT, new Uint8Array(0), out)
}

function decodePadding(frame: Uint8Array, cur: cesr.Cursor): void {
  if (cesr.decodeVariableData(cesr.TSP_PLAINTEXT, frame, cur) === undefined)
    throw new Error('tsp: missing padding field')
}

/** A `-J` VID list. §9.2 counts the group's byte length in quadlets, where
 *  Rev 2 counted VIDs; an empty list is `-JAA`. */
function encodeVidList(vids: string[], out: number[]): void {
  const body: number[] = []
  for (const vid of vids) cesr.encodeVariableData(cesr.TSP_VID, utf8.encode(vid), body)
  if (body.length % 3 !== 0) throw new Error('tsp: -J VID list not a multiple of 3 bytes')
  cesr.encodeCount(cesr.TSP_HOP_LIST, body.length / 3, out)
  for (const b of body) out.push(b)
}

function decodeVidList(stream: Uint8Array, cur: cesr.Cursor): string[] {
  const quadlets = cesr.decodeCount(cesr.TSP_HOP_LIST, stream, cur)
  if (quadlets === undefined) throw new Error('tsp: missing -J VID list')
  const groupLen = quadlets * 3
  if (groupLen > cesr.MAX_FIELD_SIZE) throw new Error('tsp: -J VID list too long')
  const groupEnd = cur.pos + groupLen
  if (groupEnd > stream.length) throw new Error('tsp: -J VID list overruns message')
  const vids: string[] = []
  while (cur.pos < groupEnd) {
    if (vids.length >= cesr.MAX_HOPS) throw new Error('tsp: too many hops')
    const vid = cesr.decodeVariableData(cesr.TSP_VID, stream, cur)
    if (vid === undefined) throw new Error('tsp: malformed VID in -J list')
    try {
      vids.push(decodeUtf8Strict(vid))
    } catch {
      throw new Error('tsp: VID in -J list is not UTF-8')
    }
  }
  if (cur.pos !== groupEnd) throw new Error('tsp: -J VID list does not fill its declared length')
  return vids
}

/** Build an application payload frame and the thread digest over it. */
export function encodePayloadFrameRev3(
  body: Uint8Array,
  kind: ApplicationKind,
  hops: string[],
  senderVid: string
): { frame: Uint8Array; threadDigest: Uint8Array } {
  const frameBody: number[] = []
  if (kind === 'direct') {
    for (const b of cesr.XSCS) frameBody.push(b)
    encodeSenderField(senderVid, frameBody)
    encodeEmptyPadding(frameBody)
    // §9.2.3: the upper-layer payload is a generic CESR stream holding one
    // Bytes primitive. The caller's bytes are carried opaquely — not wrapped
    // in the non-native message group, which would assert a serialization
    // this layer has not been told about.
    const stream: number[] = []
    cesr.encodeVariableData(cesr.TSP_PLAINTEXT, body, stream)
    cesr.encodeCount(cesr.TSP_GENERIC_STREAM, stream.length / 3, frameBody)
    for (const b of stream) frameBody.push(b)
  } else {
    for (const b of cesr.XHOP) frameBody.push(b)
    encodeSenderField(senderVid, frameBody)
    encodeVidList(kind === 'nested' ? [] : hops, frameBody)
    encodeEmptyPadding(frameBody)
    // The inner message is self-framing and carried raw; every TSP message
    // is quadlet-aligned, so the frame stays aligned.
    if (body.length % 3 !== 0) throw new Error('tsp: nested inner message is not quadlet-aligned')
    for (const b of body) frameBody.push(b)
  }
  if (frameBody.length % 3 !== 0) throw new Error('tsp: payload frame not a multiple of 3 bytes')
  const out: number[] = []
  cesr.encodeCount(cesr.TSP_PAYLOAD, frameBody.length / 3, out)
  for (const b of frameBody) out.push(b)
  const frame = new Uint8Array(out)
  return { frame, threadDigest: sha256(frame) }
}

/**
 * Decode an application payload frame. `envelopeSender` is checked against
 * the ESSR sender field: a non-NULL field that disagrees with the envelope is
 * a message claiming two senders — a verification failure, not a parse one.
 * Relationship-forming control frames (`XRFI`/`XRFA`/`XRFD`) are recognised
 * and refused by name: this codec does not yet form relationships.
 */
export function decodePayloadFrameRev3(
  frame: Uint8Array,
  envelopeSender: string
): DecodedFrame & { threadDigest: Uint8Array } {
  const cur: cesr.Cursor = { pos: 0 }
  const quadlets = cesr.decodeCount(cesr.TSP_PAYLOAD, frame, cur)
  if (quadlets === undefined) throw new Error('tsp: missing -Z payload frame')
  const frameEnd = cur.pos + quadlets * 3
  if (frameEnd > frame.length) throw new Error('tsp: -Z frame declares more content than the payload')
  const threadDigest = sha256(frame.slice(0, frameEnd))

  if (cur.pos + 3 > frame.length) throw new Error('tsp: truncated payload type code')
  const typeCode = frame.slice(cur.pos, cur.pos + 3)
  cur.pos += 3

  const senderBytes = cesr.decodeVariableData(cesr.TSP_VID, frame, cur)
  if (senderBytes === undefined) throw new Error('tsp: missing ESSR sender VID field')
  let senderVid: string
  try {
    senderVid = decodeUtf8Strict(senderBytes)
  } catch {
    throw new Error('tsp: ESSR sender VID is not UTF-8')
  }
  if (senderVid.length > 0 && senderVid !== envelopeSender) {
    throw new Error('tsp: ESSR sender VID does not match the envelope sender')
  }

  if (bytesEqual(typeCode, cesr.XSCS)) {
    decodePadding(frame, cur)
    const streamQuadlets = cesr.decodeCount(cesr.TSP_GENERIC_STREAM, frame, cur)
    if (streamQuadlets === undefined) throw new Error('tsp: missing -A payload stream')
    const streamEnd = cur.pos + streamQuadlets * 3
    if (streamEnd !== frameEnd) throw new Error('tsp: -A stream does not end the payload frame')
    const body = cesr.decodeVariableData(cesr.TSP_PLAINTEXT, frame, cur)
    if (body === undefined) throw new Error('tsp: missing payload body')
    if (cur.pos !== streamEnd) throw new Error('tsp: -A stream must hold exactly one Bytes primitive')
    return { kind: 'direct', hops: [], body, senderVid, threadDigest }
  }

  if (bytesEqual(typeCode, cesr.XHOP)) {
    const hops = decodeVidList(frame, cur)
    decodePadding(frame, cur)
    const body = frame.slice(cur.pos, frameEnd)
    return { kind: hops.length === 0 ? 'nested' : 'routed', hops, body, senderVid, threadDigest }
  }

  if (bytesEqual(typeCode, cesr.XRFI) || bytesEqual(typeCode, cesr.XRFA) || bytesEqual(typeCode, cesr.XRFD)) {
    throw new Error('tsp: relationship-forming control message; this codec does not form relationships yet')
  }
  if (bytesEqual(typeCode, cesr.XCTL) || bytesEqual(typeCode, cesr.XPAD)) {
    throw new Error('tsp: control or padding payload; not an application message')
  }
  throw new Error('tsp: unsupported payload type marker')
}

// ---------------------------------------------------------------------------
// Signature attachment
// ---------------------------------------------------------------------------

/** `-C23 -K22 B0 sig(64)`. */
function encodeSignatureFrame(signature: Uint8Array, out: number[]): void {
  cesr.encodeCount(cesr.TSP_ATTACH_GRP, ATTACH_GROUP_QUADLETS, out)
  cesr.encodeCount(cesr.TSP_INDEX_SIG_GRP, SIG_GROUP_QUADLETS, out)
  cesr.encodeIndexedEd25519Signature(SIG_INDEX, signature, out)
}

function decodeSignatureFrame(data: Uint8Array, cur: cesr.Cursor): Uint8Array {
  const attach = cesr.decodeCount(cesr.TSP_ATTACH_GRP, data, cur)
  const group = cesr.decodeCount(cesr.TSP_INDEX_SIG_GRP, data, cur)
  if (attach !== ATTACH_GROUP_QUADLETS || group !== SIG_GROUP_QUADLETS)
    throw new Error('tsp: unexpected signature group size')
  if (cur.pos + 2 + SIG_LEN > data.length) throw new Error('tsp: truncated signature attachment')
  const word = ((data[cur.pos] << 16) | (data[cur.pos + 1] << 8)) >>> 0
  if (word >>> 18 !== cesr.ED25519_SIGNATURE) throw new Error('tsp: signature is not the indexed Ed25519 code')
  const index = (word >>> 12) & 0x3f
  if (index !== SIG_INDEX)
    throw new Error(`tsp: signature names key index ${index}, but only index ${SIG_INDEX} can be verified`)
  cur.pos += 2
  const sig = data.slice(cur.pos, cur.pos + SIG_LEN)
  cur.pos += SIG_LEN
  return sig
}

// ---------------------------------------------------------------------------
// pack / unpack
// ---------------------------------------------------------------------------

/**
 * Pack a Rev 3 direct message. Only the sender's `SigningKey` port is used:
 * HPKE-Base needs no sender key, so `senderIdentity.keyAgreement` is never
 * consulted (a test double that throws on `agree()` proves it).
 * @param resolver resolves the COUNTERPARTY's (receiver's) public keys.
 */
export async function packRev3(
  body: Uint8Array,
  senderVid: string,
  receiverVid: string,
  senderIdentity: Pick<TspIdentity, 'signingKey'>,
  resolver: VidResolver,
  unsafe?: UnsafeDeterministicPack
): Promise<PackedMessage> {
  return packWithHopsRev3(body, 'direct', [], senderVid, receiverVid, senderIdentity, resolver, unsafe)
}

/** Like {@link packRev3} for any application kind, with a routing `hops` list
 *  (empty for Direct/Nested). */
export async function packWithHopsRev3(
  body: Uint8Array,
  kind: ApplicationKind,
  hops: string[],
  senderVid: string,
  receiverVid: string,
  senderIdentity: Pick<TspIdentity, 'signingKey'>,
  resolver: VidResolver,
  unsafe?: UnsafeDeterministicPack
): Promise<PackedMessage> {
  const fields = encodeFieldsRev3(senderVid, receiverVid)
  const payloadSender = unsafe?.nullPayloadSender === true ? '' : senderVid
  const { frame, threadDigest } = encodePayloadFrameRev3(body, kind, hops, payloadSender)

  const { encryptionPublicKey: receiverEncPk } = await resolver.resolve(receiverVid)
  const ephemeralSk = unsafe ? hpke.deriveKeyPair(unsafe.__unsafeIkmE).sk : undefined
  const sealed = hpke.sealBase(frame, fields, receiverEncPk, cesr.TSP_INFO, ephemeralSk)

  // Ciphertext field: `enc ‖ ct`, with the AEAD tag inside `ct`.
  const ciphertext = new Uint8Array(sealed.enc.length + sealed.ciphertext.length)
  ciphertext.set(sealed.enc, 0)
  ciphertext.set(sealed.ciphertext, sealed.enc.length)
  const field: number[] = []
  cesr.encodeVariableData(cesr.TSP_HPKE_BASE_CIPHERTEXT, ciphertext, field)

  const wireBytes = finalizeFrameRev3(fields, new Uint8Array(field))
  const signature = await senderIdentity.signingKey.sign(wireBytes)
  const out = Array.from(wireBytes)
  encodeSignatureFrame(signature, out)
  return { bytes: new Uint8Array(out), threadDigest, revision: 'rev3' }
}

/**
 * Unpack a Rev 3 message: decode the envelope, verify the indexed signature
 * against the claimed sender's key as `resolver` gives it, then HPKE-Base
 * open through the receiver's own `KeyAgreement` port and read the frame.
 * The caller decides whether the claimed sender is who it expected; the
 * ports carry no policy.
 */
export async function unpackRev3(
  wireBytes: Uint8Array,
  receiverIdentity: Pick<TspIdentity, 'keyAgreement'>,
  resolver: VidResolver
): Promise<UnpackedMessage> {
  if (wireBytes.length < 48) throw new Error('tsp: message too short')

  const envelope = decodeEnvelopeRev3(wireBytes)
  const aad = wireBytes.slice(envelope.aad.begin, envelope.aad.end)

  const cur: cesr.Cursor = { pos: envelope.headerLen }
  const ctRange = cesr.decodeVariableDataRange(cesr.TSP_HPKE_BASE_CIPHERTEXT, wireBytes, cur)
  if (ctRange === undefined) {
    const probe: cesr.Cursor = { pos: envelope.headerLen }
    if (cesr.decodeVariableDataRange(cesr.TSP_SEALED_BOX_CIPHERTEXT, wireBytes, probe)) {
      throw new Error(
        'tsp: message is sealed with the libsodium sealed box (§8.3), which this implementation does not support'
      )
    }
    throw new Error('tsp: missing F ciphertext field')
  }
  const ctLen = ctRange.end - ctRange.begin
  if (ctLen > cesr.MAX_FIELD_SIZE) throw new Error('tsp: ciphertext too large')
  if (ctLen < ENC_LEN + TAG_LEN) throw new Error('tsp: ciphertext truncated')
  if (cur.pos !== envelope.contentEnd) throw new Error('tsp: message body does not fill the -E frame')

  const signature = decodeSignatureFrame(wireBytes, cur)
  if (cur.pos !== wireBytes.length) throw new Error('tsp: trailing bytes after signature')

  const { signingPublicKey: senderSignPk } = await resolver.resolve(envelope.sender)
  if (!ed25519.verify(signature, wireBytes.slice(0, envelope.contentEnd), senderSignPk)) {
    throw new Error('tsp: signature verification failed')
  }

  const ciphertext = wireBytes.slice(ctRange.begin, ctRange.end)
  const payloadFrame = await hpke.openBase(
    ciphertext.slice(ENC_LEN),
    aad,
    ciphertext.slice(0, ENC_LEN),
    receiverIdentity.keyAgreement,
    cesr.TSP_INFO
  )
  const frame = decodePayloadFrameRev3(payloadFrame, envelope.sender)

  return {
    payload: frame.body,
    sender: envelope.sender,
    receiver: envelope.receiver,
    messageType: frame.kind,
    hops: frame.hops,
    threadDigest: frame.threadDigest,
    revision: 'rev3',
  }
}
