/**
 * A room file's STREAM construction, segment by segment, and its blob manifest.
 *
 * A port of upstream `vti-rooms/src/files.rs` (vta-service-v0.67.0), the half a member
 * holding one file's key needs. The key itself comes from the agent
 * (`rooms/keys/file-key/0.2`); the room's storage key never reaches the phone, so there
 * is no derivation here.
 *
 * Segment `i` is sealed with ChaCha20-Poly1305 under
 *
 *   nonce_i = u32be(0) || u64be(i)
 *   aad_i   = "openvtc/room/file/v1" || roomId || fileId || u64be(epoch) || u64be(i) || u8(final)
 *
 * `final` is 1 on the last segment only, so a host that truncates, reorders or splices
 * ciphertext gets an authentication failure, never a shorter or rearranged file. The
 * nonces are counters, so a key must never seal two files: every file gets a fresh
 * random `fileId`, which also salts its key.
 *
 * One sealed segment is one transfer chunk (`chunkSize = segmentSize + 16`). The file
 * level of opening (manifest checks, digests, padding) is `open.ts`.
 */
import { MultiBaseEncoder, MultiHashEncoder, TypedArrayEncoder } from '@credo-ts/core'
import { digestMultibase } from '@bifold/trust-tasks'
import { chacha20poly1305 } from '@noble/ciphers/chacha.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { randomBytes } from '@noble/hashes/utils.js'

import type { FileManifest } from '../wire'

/** The domain label of every segment's associated data. */
export const FILE_LABEL = new TextEncoder().encode('openvtc/room/file/v1')
/** The Poly1305 tag each sealed segment carries. */
export const TAG_LEN = 16
/** The smallest segment a manifest may name. */
export const MIN_SEGMENT_SIZE = 16_368
/** The largest: one 262144-byte transfer chunk, less the tag. */
export const MAX_SEGMENT_SIZE = 262_128
/** The most chunks one blob may have. */
export const MAX_CHUNKS = 4096

/** Why a segment or a manifest was refused. */
export class FileStreamError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'FileStreamError'
  }
}

/** What binds a file's segments to their place: the room, the file and the epoch. */
export type FileBinding = {
  roomId: string
  /** The 32 raw bytes. */
  fileId: Uint8Array
  epoch: number
  segmentSize: number
}

/** A blob's ciphertext manifest (`rooms/_shared/0.1/blobs.schema.json` `BlobManifest`). */
export type BlobManifest = {
  /** Ciphertext bytes. */
  size: number
  chunks: { chunkSize: number; chunkCount: number; chunkDigests: string[] }
  /** Digest of the whole ciphertext. */
  digest: string
}

export function checkSegmentSize(segmentSize: number): void {
  if (!Number.isInteger(segmentSize) || segmentSize < MIN_SEGMENT_SIZE || segmentSize > MAX_SEGMENT_SIZE) {
    throw new FileStreamError(`a segment size of ${segmentSize} is outside ${MIN_SEGMENT_SIZE}–${MAX_SEGMENT_SIZE}`)
  }
}

/** How many segments `size` plaintext bytes need: at least one, so an empty file is one empty final segment. */
export function segmentCount(size: number, segmentSize: number): number {
  return Math.max(1, Math.ceil(size / segmentSize))
}

/** `value` as 8 big-endian bytes at `offset`; exact for every safe integer. */
function putU64be(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, Math.floor(value / 2 ** 32))
  view.setUint32(offset + 4, value >>> 0)
}

export function segmentNonce(index: number): Uint8Array {
  const nonce = new Uint8Array(12)
  putU64be(new DataView(nonce.buffer), 4, index)
  return nonce
}

export function segmentAad(binding: FileBinding, index: number, final: boolean): Uint8Array {
  const room = new TextEncoder().encode(binding.roomId)
  const aad = new Uint8Array(FILE_LABEL.length + room.length + binding.fileId.length + 17)
  let at = 0
  aad.set(FILE_LABEL, at)
  at += FILE_LABEL.length
  aad.set(room, at)
  at += room.length
  aad.set(binding.fileId, at)
  at += binding.fileId.length
  const view = new DataView(aad.buffer)
  putU64be(view, at, binding.epoch)
  putU64be(view, at + 8, index)
  aad[at + 16] = final ? 1 : 0
  return aad
}

export function sealSegment(
  key: Uint8Array,
  binding: FileBinding,
  index: number,
  plaintext: Uint8Array,
  final: boolean
): Uint8Array {
  return chacha20poly1305(key, segmentNonce(index), segmentAad(binding, index, final)).encrypt(plaintext)
}

/** Open one segment; a segment that does not authenticate in this place is refused. */
export function openSegment(
  key: Uint8Array,
  binding: FileBinding,
  index: number,
  sealed: Uint8Array,
  final: boolean
): Uint8Array {
  try {
    return chacha20poly1305(key, segmentNonce(index), segmentAad(binding, index, final)).decrypt(sealed)
  } catch {
    throw new FileStreamError(`segment ${index} did not open`)
  }
}

/** `DigestMultibase` of raw bytes: a sha2-256 multihash, base58btc. */
export function bytesDigestMultibase(bytes: Uint8Array): string {
  return MultiBaseEncoder.encode(MultiHashEncoder.encode(bytes, 'sha-256'), 'base58btc')
}

/** `DigestMultibase` of a sha-256 already computed. */
function hashDigestMultibase(hash: Uint8Array): string {
  const multihash = new Uint8Array(2 + hash.length)
  multihash.set([0x12, 0x20], 0)
  multihash.set(hash, 2)
  return MultiBaseEncoder.encode(multihash, 'base58btc')
}

/** A blob's `BlobRef`: the digest of its manifest's JCS form. */
export function blobRefOf(manifest: BlobManifest): string {
  return digestMultibase(manifest)
}

/** A fresh `fileId`. Never reuse one: the segment nonces are counters. */
export function newFileId(): Uint8Array {
  return randomBytes(32)
}

export function encodeFileId(fileId: Uint8Array): string {
  return TypedArrayEncoder.toBase64Url(fileId)
}

export function decodeFileId(encoded: string): Uint8Array {
  let bytes: Uint8Array
  try {
    bytes = TypedArrayEncoder.fromBase64Url(encoded)
  } catch {
    throw new FileStreamError('fileId is not base64url')
  }
  if (bytes.length !== 32) throw new FileStreamError('fileId is not 32 bytes')
  return bytes
}

/** Builds a `BlobManifest` from sealed chunks, as they are produced. */
export class ManifestBuilder {
  private readonly digests: string[] = []
  private readonly whole = sha256.create()
  private size = 0

  public constructor(private readonly chunkSize: number) {}

  public push(chunk: Uint8Array): void {
    this.digests.push(bytesDigestMultibase(chunk))
    this.whole.update(chunk)
    this.size += chunk.length
  }

  public finish(): BlobManifest {
    const chunkCount = this.digests.length
    if (this.size === 0 || chunkCount !== Math.ceil(this.size / this.chunkSize)) {
      throw new FileStreamError('the chunks do not make a manifest')
    }
    if (chunkCount > MAX_CHUNKS) throw new FileStreamError(`${chunkCount} chunks is more than ${MAX_CHUNKS}`)
    return {
      size: this.size,
      chunks: { chunkSize: this.chunkSize, chunkCount, chunkDigests: [...this.digests] },
      digest: hashDigestMultibase(this.whole.digest()),
    }
  }
}

/**
 * Seals a file of a declared `size` one segment at a time, in order. Every segment but
 * the last is exactly `segmentSize` bytes. Sealing past the end, or finishing early, is
 * refused: a reused sealer would reuse nonces.
 */
export class FileSealer {
  private readonly manifest: ManifestBuilder
  private readonly plainDigest = sha256.create()
  private readonly count: number
  private index = 0

  public constructor(
    private readonly key: Uint8Array,
    private readonly binding: FileBinding,
    private readonly size: number
  ) {
    checkSegmentSize(binding.segmentSize)
    this.count = segmentCount(size, binding.segmentSize)
    if (this.count > MAX_CHUNKS) throw new FileStreamError(`${this.count} chunks is more than ${MAX_CHUNKS}`)
    this.manifest = new ManifestBuilder(binding.segmentSize + TAG_LEN)
  }

  /** How many segments this file has. */
  public get segments(): number {
    return this.count
  }

  /** The plaintext length segment `index` must have. */
  public segmentLength(index: number): number {
    const last = index === this.count - 1
    return last ? this.size - index * this.binding.segmentSize : this.binding.segmentSize
  }

  public sealNext(plaintext: Uint8Array): Uint8Array {
    const index = this.index
    if (index >= this.count) throw new FileStreamError('the final segment has already been sealed')
    if (plaintext.length !== this.segmentLength(index)) {
      throw new FileStreamError(`segment ${index} is ${plaintext.length} bytes, not ${this.segmentLength(index)}`)
    }
    const sealed = sealSegment(this.key, this.binding, index, plaintext, index === this.count - 1)
    this.plainDigest.update(plaintext)
    this.manifest.push(sealed)
    this.index += 1
    return sealed
  }

  /** The blob's manifest and the file's (never padded: Keyring does not pad), once the final segment is sealed. */
  public finish(name: string, mediaType?: string): { blob: BlobManifest; file: FileManifest } {
    if (this.index !== this.count) throw new FileStreamError('finished before the final segment')
    const blob = this.manifest.finish()
    return {
      blob,
      file: {
        fileId: encodeFileId(this.binding.fileId),
        name,
        ...(mediaType ? { mediaType } : {}),
        size: this.size,
        digest: hashDigestMultibase(this.plainDigest.digest()),
        epoch: this.binding.epoch,
        segmentSize: this.binding.segmentSize,
        blobRef: blobRefOf(blob),
      },
    }
  }
}

/** Seal a whole file held in memory. */
export function sealFile(
  key: Uint8Array,
  binding: FileBinding,
  plaintext: Uint8Array,
  name: string,
  mediaType?: string
): { chunks: Uint8Array[]; blob: BlobManifest; file: FileManifest } {
  const sealer = new FileSealer(key, binding, plaintext.length)
  const chunks: Uint8Array[] = []
  let at = 0
  for (let i = 0; i < sealer.segments; i++) {
    const length = sealer.segmentLength(i)
    chunks.push(sealer.sealNext(plaintext.subarray(at, at + length)))
    at += length
  }
  return { chunks, ...sealer.finish(name, mediaType) }
}
