/**
 * TSP direct-mode messaging over tsp-core's three ports (`./ports`) — the
 * public `pack`/`unpack` of this package, and the one place the wire
 * revision is decided.
 *
 * **Pack one revision, read both** (`tsp_rev3_subtask.md` §2.1, adopted from
 * upstream unchanged). `unpack` dispatches on the version marker every
 * message carries — readable without keys, at a fixed offset, before anything
 * else is parsed — and hands a Rev 2 message to the frozen Rev 2 codec and a
 * Rev 3 message to the Rev 3 one. `pack` has nothing to dispatch on: an
 * outbound message has no field saying what the peer can read, so which
 * packer is wired is a property of a build (§2.3), fixed here through
 * {@link createTspCodec} and never chosen per message. The revision a peer
 * was observed to speak comes back on {@link UnpackedMessage.revision} for the
 * caller to record and surface (§2.2); nothing in this package feeds it back
 * into what it packs.
 *
 * The reference rungs and the Rev 2 fixtures keep both packers reachable
 * (`packRev2`/`packRev3`); the wallet's default codec packs Rev 3.
 *
 * @module trust-tasks/tsp/direct
 */

import { peekRevision as peekRevisionUpstream, sha256 } from '@openvtc/vti-tsp-js'

import type { TspIdentity, VidResolver } from './ports'
import { packRev2, packWithHopsRev2, unpackRev2 } from './rev2'
import { packInviteRev3, packRev3, packWithHopsRev3, unpackRev3, type UnsafeDeterministicPack } from './rev3'
import { type ApplicationKind, type PackedMessage, type TspRevision, type UnpackedMessage } from './shared'

export { packRev2, packWithHopsRev2, unpackRev2 } from './rev2'
export {
  packInviteRev3,
  packRev3,
  packWithHopsRev3,
  unpackRev3,
  encodeFieldsRev3,
  finalizeFrameRev3,
  decodeEnvelopeRev3,
  encodePayloadFrameRev3,
  decodePayloadFrameRev3,
  type UnsafeDeterministicPack,
  type DecodedEnvelopeRev3,
} from './rev3'
export { decodeUtf8Strict, makeStrictUtf8Decode } from './shared'
export type { ApplicationKind, MessageType, PackedMessage, TspRevision, UnpackedMessage } from './shared'
export { sha256 }

/** What the version marker at the head of a frame says, read without keys. */
export interface PeekedRevision {
  revision: TspRevision
  major: number
  minor: number
  /** Whether MINOR is one this implementation has seen. A MAJOR 0 message
   *  with an unfamiliar MINOR is still read as Rev 3 (§3.5): MINOR never
   *  refuses a message. */
  recognised: boolean
}

/**
 * Read the revision off the first nine bytes. Throws only when the bytes are
 * not a TSP frame at all, or carry a MAJOR this implementation cannot
 * process — the honest error, in place of a crypto-layer failure further on.
 */
export function peekRevision(wireBytes: Uint8Array): PeekedRevision {
  const peeked = peekRevisionUpstream(wireBytes)
  return { revision: peeked.revision, major: peeked.major, minor: peeked.minor, recognised: peeked.recognised }
}

/** Pack a direct message with the revision this build wires (Rev 3). */
export async function pack(
  body: Uint8Array,
  senderVid: string,
  receiverVid: string,
  senderIdentity: TspIdentity,
  resolver: VidResolver
): Promise<PackedMessage> {
  return packRev3(body, senderVid, receiverVid, senderIdentity, resolver)
}

/** Like {@link pack} for any application kind, with a routing `hops` list. */
export async function packWithHops(
  body: Uint8Array,
  kind: ApplicationKind,
  hops: string[],
  senderVid: string,
  receiverVid: string,
  senderIdentity: TspIdentity,
  resolver: VidResolver
): Promise<PackedMessage> {
  return packWithHopsRev3(body, kind, hops, senderVid, receiverVid, senderIdentity, resolver)
}

/**
 * Unpack a message of either revision. A Rev 2 message is read by the frozen
 * Rev 2 codec and reported as `revision: 'rev2'` rather than dying in the
 * Rev 3 ciphertext selector.
 */
export async function unpack(
  wireBytes: Uint8Array,
  receiverIdentity: Pick<TspIdentity, 'keyAgreement'>,
  resolver: VidResolver
): Promise<UnpackedMessage> {
  const peeked = peekRevision(wireBytes)
  if (peeked.revision === 'rev2') return unpackRev2(wireBytes, receiverIdentity, resolver)
  return unpackRev3(wireBytes, receiverIdentity, resolver)
}

/** A `pack`/`unpack` pair with the packer fixed at construction. */
export interface TspCodec {
  /** The revision this codec packs. */
  readonly packs: TspRevision
  pack(
    body: Uint8Array,
    senderVid: string,
    receiverVid: string,
    senderIdentity: TspIdentity,
    resolver: VidResolver
  ): Promise<PackedMessage>
  packWithHops(
    body: Uint8Array,
    kind: ApplicationKind,
    hops: string[],
    senderVid: string,
    receiverVid: string,
    senderIdentity: TspIdentity,
    resolver: VidResolver
  ): Promise<PackedMessage>
  /** Always dual: reads whichever revision the message carries. */
  unpack(
    wireBytes: Uint8Array,
    receiverIdentity: Pick<TspIdentity, 'keyAgreement'>,
    resolver: VidResolver
  ): Promise<UnpackedMessage>
}

/**
 * The build-time wiring choice (§2.3): construct the codec once, at the
 * registration that owns it, with the revision that build packs. `unpack` is
 * the same dual reader whichever packer is chosen.
 */
export function createTspCodec(options: { packs: TspRevision } = { packs: 'rev3' }): TspCodec {
  const packs = options.packs
  return {
    packs,
    pack: packs === 'rev2' ? packRev2 : packRev3,
    packWithHops: packs === 'rev2' ? packWithHopsRev2 : packWithHopsRev3,
    unpack,
  }
}

/** Test-only deterministic Rev 3 invite packing, for checking our `XRFI`
 *  against upstream's byte for byte from the same ephemeral and nonce. */
export function __unsafeDeterministicPackInviteRev3(
  senderVid: string,
  receiverVid: string,
  senderIdentity: Pick<TspIdentity, 'signingKey'>,
  resolver: VidResolver,
  options: { route?: string[]; nonce: Uint8Array },
  unsafe: UnsafeDeterministicPack
): Promise<PackedMessage> {
  return packInviteRev3(senderVid, receiverVid, senderIdentity, resolver, options, unsafe)
}

/** Test-only deterministic Rev 3 packing, for reproducing published vectors. */
export function __unsafeDeterministicPackRev3(
  body: Uint8Array,
  senderVid: string,
  receiverVid: string,
  senderIdentity: Pick<TspIdentity, 'signingKey'>,
  resolver: VidResolver,
  unsafe: UnsafeDeterministicPack
): Promise<PackedMessage> {
  return packRev3(body, senderVid, receiverVid, senderIdentity, resolver, unsafe)
}
