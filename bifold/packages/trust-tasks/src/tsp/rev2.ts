/**
 * TSP **Rev 2** direct-mode messaging over the three ports (`./ports`) —
 * frozen. Rev 3 (`./rev3`) is what Keyring packs; this codec exists so a
 * Rev 2 message is still *read* correctly and reported as Rev 2, and so the
 * Rev 2 fixtures in `tsp-reference/ref-00…04` keep a packer that reproduces
 * them. `pack`/`unpack` in `./direct` are the public entry points; nothing
 * outside this package's `tsp` module should import the Rev 2 codec by name.
 *
 * This is the port-based `direct.ts` as it stood before the Rev 3 cutover —
 * proven both directions against `@openvtc/vti-tsp-js` 0.1.0/0.2.0 and end to
 * end over real Askar identities (`tsp-reference/ref-12`,
 * `docs/plans/openvtc-integration-plan/2026-09-02-bam.md`). The vendored
 * package it now builds on packs Rev 3 and no longer exports a Rev 2
 * envelope encoder or Rev 2 hop codec, so those few dozen bytes of framing are
 * spelled out here from Rev 2's layout (`-E<count>` over the header only,
 * `YTSP-AAB`, the trailing `X 00 00` marker, `-J` counting VIDs, `G`
 * ciphertext `ct ‖ tag ‖ enc`, the non-indexed `0B` signature under `-C22 -K22`)
 * — the same table the package's own `rev2/reader.ts` reads by.
 *
 * @module trust-tasks/tsp/rev2
 */

import { cesr } from '@openvtc/vti-tsp-js'
import { sha256 } from '@noble/hashes/sha2.js'
import { ed25519 } from '@noble/curves/ed25519.js'

import * as hpke from './hpke'
import type { TspIdentity, VidResolver } from './ports'
import {
  bytesEqual,
  concat,
  decodeUtf8Strict,
  utf8,
  type ApplicationKind,
  type PackedMessage,
  type UnpackedMessage,
} from './shared'

const ENC_LEN = 32
const TAG_LEN = 16
const SIG_LEN = 64
const SIG_QUADLETS = Math.ceil(SIG_LEN / 3) // 22
const EMPTY = new Uint8Array(0)

/** `YTSP` + the Rev 2 version count (`YTSP-AAB`). */
function encodeVersionRev2(out: number[]): void {
  for (const b of cesr.YTSP) out.push(b)
  cesr.encodeCount(cesr.TSP_VERSION.major, cesr.REV2_MINOR, out)
}

/** The Rev 2 `-E` frame: version, sender VID, receiver VID, `X 00 00`. The
 *  returned bytes are the HPKE `info` for the message. */
export function encodeEnvelopeRev2(sender: string, receiver: string): Uint8Array {
  const body: number[] = []
  encodeVersionRev2(body)
  cesr.encodeVariableData(cesr.TSP_VID, utf8.encode(sender), body)
  cesr.encodeVariableData(cesr.TSP_VID, utf8.encode(receiver), body)
  cesr.encodeFixedData(cesr.TSP_TMP, new Uint8Array([0, 0]), body)
  if (body.length % 3 !== 0) throw new Error('tsp: envelope body not a multiple of 3 bytes')
  const out: number[] = []
  cesr.encodeCount(cesr.TSP_ETS_WRAPPER, body.length / 3, out)
  for (const b of body) out.push(b)
  return new Uint8Array(out)
}

/** Decode a Rev 2 envelope; `headerLen` is the whole `-E` frame (the HPKE `info`). */
export function decodeEnvelopeRev2(data: Uint8Array): { sender: string; receiver: string; headerLen: number } {
  const cur: cesr.Cursor = { pos: 0 }
  const quadlets = cesr.decodeCount(cesr.TSP_ETS_WRAPPER, data, cur, cesr.LONG_COUNT_REV2)
  if (quadlets === undefined) throw new Error('tsp: missing -E envelope wrapper')
  const version = cesr.readVersion(data, cur)
  if (!version || version.major !== cesr.TSP_VERSION.major || version.minor !== cesr.REV2_MINOR) {
    throw new Error('tsp: not a Rev 2 version marker')
  }
  const senderBytes = cesr.decodeVariableData(cesr.TSP_VID, data, cur)
  if (senderBytes === undefined) throw new Error('tsp: missing sender VID')
  const receiverBytes = cesr.decodeVariableData(cesr.TSP_VID, data, cur)
  if (receiverBytes === undefined) throw new Error('tsp: missing receiver VID')
  let sender: string
  let receiver: string
  try {
    sender = decodeUtf8Strict(senderBytes)
    receiver = decodeUtf8Strict(receiverBytes)
  } catch {
    throw new Error('tsp: invalid VID encoding')
  }
  if (cesr.decodeFixedData(cesr.TSP_TMP, 2, data, cur) === undefined)
    throw new Error('tsp: missing envelope terminator')
  return { sender, receiver, headerLen: cur.pos }
}

/** Rev 2 `-J<n>`: `n` counts VIDs, each a `B` var-data field. */
function encodeHopsRev2(hops: Uint8Array[], out: number[]): void {
  cesr.encodeCount(cesr.TSP_HOP_LIST, hops.length, out)
  for (const hop of hops) cesr.encodeVariableData(cesr.TSP_VID, hop, out)
}

function decodeHopsRev2(stream: Uint8Array, cur: cesr.Cursor): Uint8Array[] | undefined {
  const count = cesr.decodeCount(cesr.TSP_HOP_LIST, stream, cur, cesr.LONG_COUNT_REV2)
  if (count === undefined || count > cesr.MAX_HOPS) return undefined
  const hops: Uint8Array[] = []
  for (let i = 0; i < count; i++) {
    const hop = cesr.decodeVariableData(cesr.TSP_VID, stream, cur)
    if (hop === undefined) return undefined
    hops.push(hop)
  }
  return hops
}

interface DecodedFrame {
  kind: ApplicationKind
  hops: string[]
  body: Uint8Array
}

/** Build the Rev 2 CESR payload frame that gets encrypted:
 *   Direct → `-Z XSCS <B> body`
 *   Nested → `-Z XHOP -J0 <B> body`
 *   Routed → `-Z XHOP -J<n> (B hop)* <B> body`  */
function encodePayloadFrame(body: Uint8Array, kind: ApplicationKind, hops: string[]): Uint8Array {
  const frameBody: number[] = []
  if (kind === 'direct') {
    for (const b of cesr.XSCS) frameBody.push(b)
  } else {
    for (const b of cesr.XHOP) frameBody.push(b)
    encodeHopsRev2(
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

function decodePayloadFrame(frame: Uint8Array): DecodedFrame {
  const cur: cesr.Cursor = { pos: 0 }
  if (cesr.decodeCount(cesr.TSP_PAYLOAD, frame, cur, cesr.LONG_COUNT_REV2) === undefined) {
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
    const hopBytes = decodeHopsRev2(frame, cur)
    if (hopBytes === undefined) throw new Error('tsp: malformed hop list')
    let hops: string[]
    try {
      hops = hopBytes.map((h) => decodeUtf8Strict(h))
    } catch {
      throw new Error('tsp: hop VID not UTF-8')
    }
    const body = cesr.decodeVariableData(cesr.TSP_PLAINTEXT, frame, cur)
    if (body === undefined) throw new Error('tsp: missing payload plaintext')
    return { kind: hops.length === 0 ? 'nested' : 'routed', hops, body }
  }
  throw new Error('tsp: unsupported payload type marker')
}

/** Encode the Rev 2 signature frame: `-C22 -K22 <0B> sig(64)`. */
function encodeSignatureFrame(signature: Uint8Array, out: number[]): void {
  cesr.encodeCount(cesr.TSP_ATTACH_GRP, SIG_QUADLETS, out)
  cesr.encodeCount(cesr.TSP_INDEX_SIG_GRP, SIG_QUADLETS, out)
  cesr.encodeFixedData(cesr.ED25519_SIGNATURE, signature, out)
}

function decodeSignatureFrame(data: Uint8Array, cur: cesr.Cursor): Uint8Array {
  const a = cesr.decodeCount(cesr.TSP_ATTACH_GRP, data, cur, cesr.LONG_COUNT_REV2)
  const k = cesr.decodeCount(cesr.TSP_INDEX_SIG_GRP, data, cur, cesr.LONG_COUNT_REV2)
  if (a !== SIG_QUADLETS || k !== SIG_QUADLETS) {
    throw new Error('tsp: unexpected signature group size')
  }
  const sig = cesr.decodeFixedData(cesr.ED25519_SIGNATURE, SIG_LEN, data, cur)
  if (sig === undefined) throw new Error('tsp: missing Ed25519 signature')
  return sig
}

/**
 * Pack a Rev 2 direct message: build the envelope (= HPKE info), HPKE-Auth seal
 * the payload frame (empty AAD) against the receiver's key, append `enc`, then
 * sign envelope‖ciphertext with the sender's own `SigningKey` port.
 */
export async function packRev2(
  body: Uint8Array,
  senderVid: string,
  receiverVid: string,
  senderIdentity: TspIdentity,
  resolver: VidResolver
): Promise<PackedMessage> {
  return packWithHopsRev2(body, 'direct', [], senderVid, receiverVid, senderIdentity, resolver)
}

/** Like {@link packRev2} for any application kind, with a routing `hops` list. */
export async function packWithHopsRev2(
  body: Uint8Array,
  kind: ApplicationKind,
  hops: string[],
  senderVid: string,
  receiverVid: string,
  senderIdentity: TspIdentity,
  resolver: VidResolver
): Promise<PackedMessage> {
  const envelopeBytes = encodeEnvelopeRev2(senderVid, receiverVid)

  const payloadFrame = encodePayloadFrame(body, kind, hops)
  const threadDigest = sha256(payloadFrame)

  const { encryptionPublicKey: receiverEncPk } = await resolver.resolve(receiverVid)
  const sealed = await hpke.seal(payloadFrame, EMPTY, senderIdentity.keyAgreement, receiverEncPk, envelopeBytes)
  // Rev 2 ciphertext layout: ct ‖ tag(16) ‖ enc(32).
  const gPayload = concat(sealed.ciphertext, sealed.enc)

  const wireBytes: number[] = []
  for (const b of envelopeBytes) wireBytes.push(b)
  cesr.encodeVariableData(cesr.TSP_HPKEAUTH_CIPHERTEXT, gPayload, wireBytes)

  const signature = await senderIdentity.signingKey.sign(new Uint8Array(wireBytes))
  encodeSignatureFrame(signature, wireBytes)

  return { bytes: new Uint8Array(wireBytes), threadDigest, revision: 'rev2' }
}

/**
 * Unpack a Rev 2 direct message: parse the envelope (HPKE info), resolve the
 * claimed sender's keys, verify the outer Ed25519 signature, split `enc` off
 * the tail, and HPKE-Auth open (empty AAD) with the receiver's own
 * `KeyAgreement` port.
 */
export async function unpackRev2(
  wireBytes: Uint8Array,
  receiverIdentity: Pick<TspIdentity, 'keyAgreement'>,
  resolver: VidResolver
): Promise<UnpackedMessage> {
  if (wireBytes.length < 48) throw new Error('tsp: message too short')

  const envelope = decodeEnvelopeRev2(wireBytes)
  const envelopeBytes = wireBytes.slice(0, envelope.headerLen)

  const cur: cesr.Cursor = { pos: envelope.headerLen }
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
    revision: 'rev2',
  }
}
