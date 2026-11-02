/**
 * The STREAM port against upstream's own vectors.
 *
 * fixtures/room-file-vectors.json is a byte-for-byte copy of
 * `vti-rooms/tests/fixtures/file-vectors.json` at vta-service-v0.67.0, which upstream's
 * `test_vectors_match_the_fixture` regenerates from `seal_file`. Only the unpadded cases
 * are sealed here: Keyring never pads what it uploads.
 */
import { TypedArrayEncoder } from '@credo-ts/core'

import {
  FileBinding,
  FileSealer,
  FileStreamError,
  MIN_SEGMENT_SIZE,
  blobRefOf,
  bytesDigestMultibase,
  decodeFileId,
  encodeFileId,
  openSegment,
  sealFile,
} from '../real/files/stream'

import vectors from './fixtures/room-file-vectors.json'

const key = TypedArrayEncoder.fromBase64Url(vectors.fileKey)
const binding: FileBinding = {
  roomId: vectors.roomId,
  fileId: decodeFileId(vectors.fileId),
  epoch: vectors.epoch,
  segmentSize: vectors.segmentSize,
}
const plaintextOf = (length: number) => Uint8Array.from({ length }, (_, i) => i % 256)
const unpadded = vectors.cases.filter((c) => c.padding === 'none')

describe('room file STREAM', () => {
  it('reads every unpadded upstream case', () => {
    expect(unpadded.map((c) => c.plaintextLength)).toEqual([0, 5, MIN_SEGMENT_SIZE + 3])
  })

  it.each(unpadded.map((c) => [c.plaintextLength, c] as const))(
    'seals %i bytes exactly as upstream does',
    (length, expected) => {
      const sealed = sealFile(key, binding, plaintextOf(length), 'vector.bin', 'application/octet-stream')

      expect(sealed.chunks.map(bytesDigestMultibase)).toEqual(expected.chunkSha256)
      expect(TypedArrayEncoder.toBase64Url(sealed.chunks[0].subarray(0, 32))).toBe(expected.firstChunkHead)
      expect(sealed.blob).toEqual(expected.blobManifest)
      expect(sealed.file).toEqual(expected.fileManifest)
      expect(blobRefOf(sealed.blob)).toBe(expected.fileManifest.blobRef)
    }
  )

  it('opens what it sealed, segment by segment', () => {
    const plaintext = plaintextOf(2 * MIN_SEGMENT_SIZE + 7)
    const { chunks } = sealFile(key, binding, plaintext, 'f')
    const opened = chunks.map((chunk, i) => openSegment(key, binding, i, chunk, i === chunks.length - 1))

    expect(chunks).toHaveLength(3)
    expect(Buffer.concat(opened)).toEqual(Buffer.from(plaintext))
  })

  it('refuses a segment moved, cut short or rebound', () => {
    const { chunks } = sealFile(key, binding, plaintextOf(2 * MIN_SEGMENT_SIZE + 7), 'f')

    expect(() => openSegment(key, binding, 1, chunks[0], false)).toThrow(FileStreamError)
    expect(() => openSegment(key, binding, 1, chunks[1], true)).toThrow(FileStreamError)
    expect(() => openSegment(key, { ...binding, epoch: binding.epoch + 1 }, 0, chunks[0], false)).toThrow(
      FileStreamError
    )
    expect(() => openSegment(key, { ...binding, roomId: `${binding.roomId}x` }, 0, chunks[0], false)).toThrow(
      FileStreamError
    )
  })

  it('refuses to seal past the end, a wrong-sized segment, or a short finish', () => {
    const sealer = new FileSealer(key, binding, MIN_SEGMENT_SIZE + 3)

    expect(() => sealer.sealNext(plaintextOf(5))).toThrow(FileStreamError)
    sealer.sealNext(plaintextOf(MIN_SEGMENT_SIZE))
    expect(() => sealer.finish('f')).toThrow(FileStreamError)
    sealer.sealNext(plaintextOf(3))
    expect(() => sealer.sealNext(plaintextOf(0))).toThrow(FileStreamError)
  })

  it('refuses a segment size outside the protocol range', () => {
    expect(() => new FileSealer(key, { ...binding, segmentSize: MIN_SEGMENT_SIZE - 1 }, 10)).toThrow(FileStreamError)
  })

  it('round-trips a fileId and refuses one that is not 32 bytes', () => {
    expect(encodeFileId(binding.fileId)).toBe(vectors.fileId)
    expect(() => decodeFileId(encodeFileId(new Uint8Array(31)))).toThrow(FileStreamError)
  })
})
