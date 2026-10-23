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

import { sha256, TspRevisionError } from '@openvtc/vti-tsp-js'

import type { TspIdentity, VidResolver } from './ports'
import { packRev2, packWithHopsRev2, unpackRev2 } from './rev2'
import {
  packAcceptRev3,
  packAcceptV1,
  packCancelRev3,
  packCancelV1,
  packInviteRev3,
  packInviteV1,
  packRev3,
  packV1,
  packWithHopsRev3,
  packWithHopsV1,
  unpackRev3,
  unpackV1,
  type UnsafeDeterministicPack,
} from './rev3'
import { type ApplicationKind, type PackedMessage, type TspRevision, type UnpackedMessage } from './shared'
import { readTspVersion, TSP_REV2, TSP_REV3, TSP_V1 } from './version'

export { packRev2, packWithHopsRev2, unpackRev2 } from './rev2'
export {
  CONTROL_FRAME_RECEIVED,
  packAcceptRev3,
  packCancelRev3,
  packInviteRev3,
  packRev3,
  packWithHopsRev3,
  unpackRev3,
  packV1,
  packWithHopsV1,
  packInviteV1,
  packAcceptV1,
  packCancelV1,
  unpackV1,
  revisionOf,
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
  // Read without judging (`./version`), then judge here. MAJOR 0 is Rev 2 or
  // Rev 3 by MINOR; MAJOR 1 is TSP 1.0. Any other MAJOR is refused with the
  // error and code tsp-js uses (`E_TSP_REVISION`), so callers that branch on
  // the code see one shape.
  const { major, minor } = readTspVersion(wireBytes)
  if (major === TSP_V1.major) {
    return { revision: 'v1', major, minor, recognised: minor === TSP_V1.minor }
  }
  if (major !== TSP_REV3.major) {
    throw new TspRevisionError(
      `tsp: message declares MAJOR ${major}; this implementation reads MAJOR ${TSP_REV3.major} and ${TSP_V1.major}`,
      major,
      minor
    )
  }
  // An unknown MAJOR-0 MINOR is read as Rev 3 on purpose, not refused: only
  // MAJOR gates (spec §9.1), and neither affinidi-tsp nor tsp-js refuses on
  // MINOR. `recognised: false` is for the error text a later failure cites.
  return {
    revision: minor === TSP_REV2.minor ? 'rev2' : 'rev3',
    major,
    minor,
    recognised: Object.prototype.hasOwnProperty.call(KNOWN_MINORS, minor),
  }
}

/** MAJOR-0 MINORs this codec can name, for diagnostics only, never admission
 *  (as tsp-js 0.3.0's `KNOWN_MINORS`): `YTSP-ABA` is the pre-merge Rev 3. */
const KNOWN_MINORS: Readonly<Record<number, string>> = Object.freeze({
  1: 'Rev 2 (YTSP-AAB)',
  2: 'Rev 3 (YTSP-AAC)',
  64: 'Rev 3 as published upstream (YTSP-ABA)',
})

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
 * Unpack a message of any revision this package reads: Rev 2 (by the frozen
 * Rev 2 codec), Rev 3, or TSP 1.0 (the Rev 3 layout with the sender rule),
 * dispatched on the version marker and reported on `revision`.
 */
export async function unpack(
  wireBytes: Uint8Array,
  receiverIdentity: Pick<TspIdentity, 'keyAgreement'>,
  resolver: VidResolver
): Promise<UnpackedMessage> {
  const peeked = peekRevision(wireBytes)
  if (peeked.revision === 'rev2') return unpackRev2(wireBytes, receiverIdentity, resolver)
  if (peeked.revision === 'v1') return unpackV1(wireBytes, receiverIdentity, resolver)
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
  const packers = {
    rev2: { pack: packRev2, packWithHops: packWithHopsRev2 },
    rev3: { pack: packRev3, packWithHops: packWithHopsRev3 },
    v1: { pack: packV1, packWithHops: packWithHopsV1 },
  }[packs]
  if (!packers) throw new Error(`tsp: no packer for revision "${packs}"`)
  return { packs, ...packers, unpack }
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

/** Test-only deterministic Rev 3 accept (`XRFA`), for checking against upstream. */
export function __unsafeDeterministicPackAcceptRev3(
  inviteDigest: Uint8Array,
  senderVid: string,
  receiverVid: string,
  senderIdentity: Pick<TspIdentity, 'signingKey'>,
  resolver: VidResolver,
  unsafe: UnsafeDeterministicPack
): Promise<PackedMessage> {
  return packAcceptRev3(inviteDigest, senderVid, receiverVid, senderIdentity, resolver, unsafe)
}

/** Test-only deterministic Rev 3 cancel (`XRFD`), for checking against upstream. */
export function __unsafeDeterministicPackCancelRev3(
  relationshipDigest: Uint8Array,
  senderVid: string,
  receiverVid: string,
  senderIdentity: Pick<TspIdentity, 'signingKey'>,
  resolver: VidResolver,
  unsafe: UnsafeDeterministicPack
): Promise<PackedMessage> {
  return packCancelRev3(relationshipDigest, senderVid, receiverVid, senderIdentity, resolver, unsafe)
}

/** Test-only deterministic TSP 1.0 packing, for reproducing the 1.0 vectors. */
export function __unsafeDeterministicPackV1(
  body: Uint8Array,
  senderVid: string,
  receiverVid: string,
  senderIdentity: Pick<TspIdentity, 'signingKey'>,
  resolver: VidResolver,
  unsafe: UnsafeDeterministicPack
): Promise<PackedMessage> {
  return packV1(body, senderVid, receiverVid, senderIdentity, resolver, unsafe)
}

/** Test-only deterministic TSP 1.0 invite (`XRFI`). */
export function __unsafeDeterministicPackInviteV1(
  senderVid: string,
  receiverVid: string,
  senderIdentity: Pick<TspIdentity, 'signingKey'>,
  resolver: VidResolver,
  options: { route?: string[]; nonce: Uint8Array },
  unsafe: UnsafeDeterministicPack
): Promise<PackedMessage> {
  return packInviteV1(senderVid, receiverVid, senderIdentity, resolver, options, unsafe)
}

/** Test-only deterministic TSP 1.0 accept (`XRFA`). */
export function __unsafeDeterministicPackAcceptV1(
  inviteDigest: Uint8Array,
  senderVid: string,
  receiverVid: string,
  senderIdentity: Pick<TspIdentity, 'signingKey'>,
  resolver: VidResolver,
  unsafe: UnsafeDeterministicPack
): Promise<PackedMessage> {
  return packAcceptV1(inviteDigest, senderVid, receiverVid, senderIdentity, resolver, unsafe)
}

/** Test-only deterministic TSP 1.0 cancel (`XRFD`). */
export function __unsafeDeterministicPackCancelV1(
  relationshipDigest: Uint8Array,
  senderVid: string,
  receiverVid: string,
  senderIdentity: Pick<TspIdentity, 'signingKey'>,
  resolver: VidResolver,
  unsafe: UnsafeDeterministicPack
): Promise<PackedMessage> {
  return packCancelV1(relationshipDigest, senderVid, receiverVid, senderIdentity, resolver, unsafe)
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
