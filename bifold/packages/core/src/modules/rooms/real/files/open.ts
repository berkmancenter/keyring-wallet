/**
 * Opening a room file: the reader's side of `rooms/blobs/get` and `rooms/blobs/chunk`
 * (vti-rooms `files.rs` @ vta-service-v0.69.1: `check_blob`, `StreamOpener`; the segment
 * level is `stream.ts`).
 *
 * The host is trusted for nothing but availability. The file's manifest came from its
 * record's sealed body, and it names the blob by digest, so before a byte is opened the
 * blob manifest must be that one, in the shape the file's size and segment size give.
 * Every chunk is then checked on arrival, the whole ciphertext and the plaintext at the
 * end. A file that fails any of these is refused, never returned with a warning: what
 * `push` gave back counts as received only after `finish` passes.
 *
 * What these checks prove: the bytes are the ones the sealed record names. Who wrote that
 * record is a different check, `verify_record_body` upstream, which Keyring does not make.
 */
import { digestBytesEqual } from '@bifold/trust-tasks'
import { sha256 } from '@noble/hashes/sha2.js'

import type { FileManifest } from '../wire'

import {
  FileStreamError,
  MAX_CHUNKS,
  TAG_LEN,
  blobRefOf,
  bytesDigestMultibase,
  checkSegmentSize,
  decodeFileId,
  hashDigestMultibase,
  openSegment,
  segmentCount,
  type BlobManifest,
  type FileBinding,
} from './stream'

/**
 * The length a Padmé padding gives `size` bytes (Nikitin et al., PETS 2019). Keyring pads
 * nothing it uploads; a file from another client may be padded.
 */
export function padmeLength(size: number): number {
  if (size < 2) return size
  let e = 0
  while (2 ** (e + 1) <= size) e += 1
  const lastBits = e - (32 - Math.clz32(e))
  return Math.ceil(size / 2 ** lastBits) * 2 ** lastBits
}

/** The length of the plaintext as sealed. */
export function paddedLength(file: FileManifest): number {
  return file.padding === 'padme' ? padmeLength(file.size) : file.size
}

/** What JSON Schema cannot state: `chunkCount` is ceil(size / chunkSize), with one digest per chunk. */
function checkBlobManifest({ size, chunks }: BlobManifest): void {
  if (chunks.chunkSize <= 0 || size <= 0) throw new FileStreamError('an empty blob or chunk size')
  if (chunks.chunkCount !== Math.ceil(size / chunks.chunkSize)) {
    throw new FileStreamError(`chunkCount ${chunks.chunkCount} does not fit ${size} bytes`)
  }
  if (chunks.chunkDigests.length !== chunks.chunkCount) {
    throw new FileStreamError(`${chunks.chunkDigests.length} chunk digests for ${chunks.chunkCount} chunks`)
  }
  if (chunks.chunkCount > MAX_CHUNKS)
    throw new FileStreamError(`${chunks.chunkCount} chunks is more than ${MAX_CHUNKS}`)
}

/** The checks made before trusting a byte of `blob`: it is the one the file names, in the shape the file gives. */
export function checkBlob(file: FileManifest, blob: BlobManifest): void {
  checkBlobManifest(blob)
  if (!digestBytesEqual(blobRefOf(blob), file.blobRef)) {
    throw new FileStreamError('the blob manifest is not the one the file names')
  }
  checkSegmentSize(file.segmentSize)
  if (blob.chunks.chunkSize !== file.segmentSize + TAG_LEN) {
    throw new FileStreamError(`chunkSize ${blob.chunks.chunkSize} is not segmentSize ${file.segmentSize} + ${TAG_LEN}`)
  }
  const padded = paddedLength(file)
  const expected = segmentCount(padded, file.segmentSize)
  if (blob.chunks.chunkCount !== expected) {
    throw new FileStreamError(`chunkCount ${blob.chunks.chunkCount} is not the ${expected} this file needs`)
  }
  if (blob.size !== padded + expected * TAG_LEN) {
    throw new FileStreamError(`a ${blob.size}-byte blob cannot hold this file`)
  }
}

/** Opens a file's chunks in order, removing any padding. */
export class FileOpener {
  private readonly binding: FileBinding
  private readonly padded: number
  private readonly wholeCiphertext = sha256.create()
  private readonly wholePlaintext = sha256.create()
  private index = 0
  private position = 0

  public constructor(
    private readonly key: Uint8Array,
    roomId: string,
    private readonly file: FileManifest,
    private readonly blob: BlobManifest
  ) {
    checkBlob(file, blob)
    this.padded = paddedLength(file)
    this.binding = {
      roomId,
      fileId: decodeFileId(file.fileId),
      epoch: file.epoch,
      segmentSize: file.segmentSize,
    }
  }

  /** Check and open the next chunk; returns its plaintext, not yet to be shown (see `finish`). */
  public push(chunk: Uint8Array): Uint8Array {
    const { chunkCount, chunkDigests } = this.blob.chunks
    const index = this.index
    if (index >= chunkCount) throw new FileStreamError('more chunks than the manifest names')
    if (!digestBytesEqual(bytesDigestMultibase(chunk), chunkDigests[index])) {
      throw new FileStreamError(`chunk ${index} does not match the manifest`)
    }
    this.wholeCiphertext.update(chunk)
    const last = index + 1 === chunkCount
    const plain = openSegment(this.key, this.binding, index, chunk, last)
    if (!last && plain.length !== this.file.segmentSize) {
      throw new FileStreamError(`segment ${index} before the last is not the segment size`)
    }
    const start = this.position
    this.position += plain.length
    if (this.position > this.padded) throw new FileStreamError('more plaintext than the manifest names')
    const keep = Math.max(0, Math.min(plain.length, this.file.size - start))
    if (plain.subarray(keep).some((byte) => byte !== 0)) throw new FileStreamError('padding bytes are not zero')
    const kept = plain.subarray(0, keep)
    this.wholePlaintext.update(kept)
    this.index += 1
    return kept
  }

  /** Every chunk arrived, and both whole digests hold. Only after this does what `push` gave count as received. */
  public finish(): void {
    const { chunkCount } = this.blob.chunks
    if (this.index !== chunkCount) throw new FileStreamError(`the blob ended after ${this.index} of ${chunkCount}`)
    if (this.position !== this.padded) throw new FileStreamError('the plaintext is not the length the manifest gives')
    if (!digestBytesEqual(hashDigestMultibase(this.wholeCiphertext.digest()), this.blob.digest)) {
      throw new FileStreamError('the ciphertext does not match the manifest')
    }
    if (!digestBytesEqual(hashDigestMultibase(this.wholePlaintext.digest()), this.file.digest)) {
      throw new FileStreamError('the file does not match its digest')
    }
  }
}

/** The largest file this phone opens. The picker's limit: a room's own can be far above what a phone should hold. */
export const OPEN_FILE_BYTES = 25_000_000

/** How much of a file's start stays in memory, for telling what it is. */
const HEAD_BYTES = 65_536

/** The local copy a file is written to as it opens. */
export interface OpenFileCopy {
  append(plain: Uint8Array): Promise<void>
  /** The checks passed: makes the copy what can be shown, and says where it is. */
  finish(): Promise<string>
  /** Deletes all of it. Never rejects. */
  discard(): Promise<void>
}

export interface OpenFileSteps {
  /** `rooms/blobs/get`, proxied: the blob's manifest and the handle for its chunks. */
  getBlob(blobRef: string): Promise<{ blob: BlobManifest; downloadId: string }>
  /** `rooms/blobs/chunk`: one chunk's raw bytes. */
  getChunk(downloadId: string, index: number): Promise<Uint8Array>
  /** `rooms/keys/file-key`: this file's key, opening nothing else. Held only while the file opens. */
  fileKey(file: FileManifest): Promise<Uint8Array>
  newCopy(file: FileManifest): Promise<OpenFileCopy>
}

const abortError = (): Error => {
  const error = new Error('the file was not opened')
  error.name = 'AbortError'
  return error
}

/** `step`'s answer, or an AbortError the moment `signal` aborts: a cancel or a lock does not wait for a chunk. */
function untilAborted<T>(step: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return step
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(abortError())
    if (signal.aborted) aborted()
    signal.addEventListener('abort', aborted, { once: true })
    step.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
  })
}

/**
 * Fetches, checks and opens a file into a local copy. Nothing is kept on any way out but success: not the partial
 * copy, and not the key. The key comes after the blob's manifest passes, so a blob that isn't the file's costs none.
 */
export async function openRoomFile(
  steps: OpenFileSteps,
  roomId: string,
  file: FileManifest,
  options: { signal?: AbortSignal; onProgress?: (progress: { sent: number; total: number }) => void } = {}
): Promise<{ localUri: string; head: Uint8Array }> {
  const { signal, onProgress } = options
  const { blob, downloadId } = await untilAborted(steps.getBlob(file.blobRef), signal)
  checkBlob(file, blob)
  const key = await untilAborted(steps.fileKey(file), signal)
  let copy: OpenFileCopy | undefined
  try {
    const opener = new FileOpener(key, roomId, file, blob)
    copy = await untilAborted(steps.newCopy(file), signal)
    const head = new Uint8Array(Math.min(HEAD_BYTES, file.size))
    let written = 0
    let sent = 0
    for (let index = 0; index < blob.chunks.chunkCount; index++) {
      const chunk = await untilAborted(steps.getChunk(downloadId, index), signal)
      const plain = opener.push(chunk)
      if (written < head.length) head.set(plain.subarray(0, head.length - written), written)
      written += plain.length
      // Awaited whatever a cancel says: the copy is deleted after a write, never during one.
      await copy.append(plain)
      sent += chunk.length
      onProgress?.({ sent, total: blob.size })
    }
    opener.finish()
    const localUri = await copy.finish()
    if (signal?.aborted) throw abortError()
    return { localUri, head }
  } catch (e) {
    await copy?.discard()
    throw e
  } finally {
    key.fill(0)
  }
}
