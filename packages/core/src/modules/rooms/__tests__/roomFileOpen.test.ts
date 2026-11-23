/**
 * Opening a room file against upstream's own vectors (fixtures/room-file-vectors.json, see roomFileStream.test.ts),
 * every case including the padded one, and against each thing a host could do with a blob.
 */
import { TypedArrayEncoder } from '@credo-ts/core'
import { sha256 } from '@noble/hashes/sha2.js'

import { FileOpener, checkBlob, openRoomFile, padmeLength, type OpenFileSteps } from '../real/files/open'
import {
  FileBinding,
  FileStreamError,
  blobRefOf,
  bytesDigestMultibase,
  decodeFileId,
  hashDigestMultibase,
  sealFile,
  type BlobManifest,
} from '../real/files/stream'
import type { FileManifest } from '../real/wire'

import vectors from './fixtures/room-file-vectors.json'

const key = TypedArrayEncoder.fromBase64Url(vectors.fileKey)
const binding: FileBinding = {
  roomId: vectors.roomId,
  fileId: decodeFileId(vectors.fileId),
  epoch: vectors.epoch,
  segmentSize: vectors.segmentSize,
}
const plaintextOf = (length: number) => Uint8Array.from({ length }, (_, i) => i % 256)
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
const openAll = (file: FileManifest, blob: BlobManifest, chunks: Uint8Array[], withKey = key) => {
  const opener = new FileOpener(withKey, vectors.roomId, file, blob)
  const plain = chunks.map((c) => opener.push(c))
  opener.finish()
  return concat(plain)
}
// A blob manifest for chunks the host changed, named by the file so the manifest check passes and the next one runs.
const renamed = (file: FileManifest, chunks: Uint8Array[]): { file: FileManifest; blob: BlobManifest } => {
  const whole = sha256(concat(chunks))
  const blob: BlobManifest = {
    size: chunks.reduce((n, c) => n + c.length, 0),
    chunks: {
      chunkSize: file.segmentSize + 16,
      chunkCount: chunks.length,
      chunkDigests: chunks.map(bytesDigestMultibase),
    },
    digest: hashDigestMultibase(whole),
  }
  return { file: { ...file, blobRef: blobRefOf(blob) }, blob }
}

describe('opening a room file', () => {
  it.each(vectors.cases.map((c) => [c.plaintextLength, c.padding, c] as const))(
    "opens upstream's %i-byte case (padding %s)",
    (length, _padding, vector) => {
      // Keyring seals no padding, so the padded case is its plaintext zero-padded to the sealed length.
      const sealedLength = vector.blobManifest.size - 16 * vector.blobManifest.chunks.chunkCount
      const padded = new Uint8Array(sealedLength)
      padded.set(plaintextOf(length))
      const { chunks, blob } = sealFile(key, binding, padded, 'vector.bin', 'application/octet-stream')

      expect(blob).toEqual(vector.blobManifest)
      expect(openAll(vector.fileManifest as FileManifest, blob, chunks)).toEqual(plaintextOf(length))
    }
  )

  it('gives the Padmé lengths upstream does', () => {
    const padded = vectors.cases.find((c) => c.padding === 'padme')!
    expect(padded.blobManifest.size - 16).toBe(padmeLength(padded.plaintextLength))
    expect([0, 1, 2, 3, 100, 1000, 16371, 1_048_577].map(padmeLength)).toEqual([
      0, 1, 2, 3, 104, 1024, 16384, 1_081_344,
    ])
  })

  it('refuses padding that is not zero bytes', () => {
    const size = 100
    const padded = plaintextOf(padmeLength(size))
    const { chunks, blob, file } = sealFile(key, binding, padded, 'vector.bin')
    const manifest: FileManifest = {
      ...file,
      size,
      padding: 'padme',
      digest: hashDigestMultibase(sha256(plaintextOf(size))),
    }
    expect(() => openAll(manifest, blob, chunks)).toThrow('padding bytes are not zero')
  })

  describe('a host cannot', () => {
    const sealed = sealFile(key, binding, plaintextOf(16371), 'vector.bin')

    it('swap the blob for another', () => {
      const other = sealFile(key, binding, plaintextOf(5), 'other.bin')
      expect(() => new FileOpener(key, vectors.roomId, sealed.file, other.blob)).toThrow(FileStreamError)
    })

    it('change a chunk', () => {
      const changed = sealed.chunks.map((c) => c.slice())
      changed[1][0] ^= 1
      expect(() => openAll(sealed.file, sealed.blob, changed)).toThrow('chunk 1 does not match the manifest')
    })

    it('reorder chunks, even with a manifest that names them in that order', () => {
      const swapped = [sealed.chunks[1], sealed.chunks[0]]
      const { file, blob } = renamed(sealed.file, swapped)
      expect(() => openAll(file, blob, swapped)).toThrow(FileStreamError)
    })

    it('cut the file short', () => {
      const opener = new FileOpener(key, vectors.roomId, sealed.file, sealed.blob)
      opener.push(sealed.chunks[0])
      expect(() => opener.finish()).toThrow('the blob ended after 1 of 2')
    })

    it('add a chunk', () => {
      const opener = new FileOpener(key, vectors.roomId, sealed.file, sealed.blob)
      sealed.chunks.forEach((c) => opener.push(c))
      expect(() => opener.push(sealed.chunks[1])).toThrow('more chunks than the manifest names')
    })

    it("name a whole digest that is not the ciphertext's", () => {
      const blob = { ...sealed.blob, digest: hashDigestMultibase(sha256(plaintextOf(1))) }
      const file = { ...sealed.file, blobRef: blobRefOf(blob) }
      expect(() => openAll(file, blob, sealed.chunks)).toThrow('the ciphertext does not match the manifest')
    })
  })

  it('refuses a plaintext that is not the digest its record names', () => {
    const { chunks, blob, file } = sealFile(key, binding, plaintextOf(5), 'vector.bin')
    const wrong = { ...file, digest: hashDigestMultibase(sha256(plaintextOf(6))) }
    expect(() => openAll(wrong, blob, chunks)).toThrow('the file does not match its digest')
  })

  it('refuses the wrong key', () => {
    const { chunks, blob, file } = sealFile(key, binding, plaintextOf(5), 'vector.bin')
    expect(() => openAll(file, blob, chunks, new Uint8Array(32).fill(7))).toThrow('segment 0 did not open')
  })

  it.each([
    [
      'a chunk size other than the segment size and tag',
      (b: BlobManifest) => ({ ...b, chunks: { ...b.chunks, chunkSize: b.chunks.chunkSize + 1 } }),
    ],
    [
      'a chunk count that does not fit the size',
      (b: BlobManifest) => ({ ...b, chunks: { ...b.chunks, chunkCount: 9 } }),
    ],
    [
      'a digest list shorter than the count',
      (b: BlobManifest) => ({ ...b, chunks: { ...b.chunks, chunkDigests: [] } }),
    ],
  ])('refuses %s', (_what, change) => {
    const { blob, file } = sealFile(key, binding, plaintextOf(16371), 'vector.bin')
    const bad = change(blob)
    expect(() => checkBlob({ ...file, blobRef: blobRefOf(bad) }, bad)).toThrow(FileStreamError)
  })

  it('refuses a blob too small for the size the file names', () => {
    const { blob, file } = sealFile(key, binding, plaintextOf(5), 'vector.bin')
    expect(() => checkBlob({ ...file, size: 6 }, blob)).toThrow(FileStreamError)
  })

  describe('its key', () => {
    const sealed = sealFile(key, binding, plaintextOf(5), 'vector.bin')
    const copy = { append: async () => undefined, finish: async () => 'file:///copy', discard: async () => undefined }
    const steps = (held: Uint8Array, chunk = sealed.chunks[0]): OpenFileSteps => ({
      getBlob: async () => ({ blob: sealed.blob, downloadId: 'dl' }),
      getChunk: async () => chunk,
      fileKey: async () => held,
      newCopy: async () => copy,
    })

    it('is wiped once the file is open', async () => {
      const held = key.slice()
      await openRoomFile(steps(held), vectors.roomId, sealed.file)
      expect(held.every((byte) => byte === 0)).toBe(true)
    })

    it('is wiped when opening fails', async () => {
      const held = key.slice()
      const changed = sealed.chunks[0].slice()
      changed[0] ^= 1
      await expect(openRoomFile(steps(held, changed), vectors.roomId, sealed.file)).rejects.toThrow(FileStreamError)
      expect(held.every((byte) => byte === 0)).toBe(true)
    })
  })
})
