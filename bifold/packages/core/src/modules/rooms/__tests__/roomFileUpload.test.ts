/**
 * The upload pipeline against a fake agent and a fake host door: what each party is sent, in what order and
 * signed by whom, and that the host ends up holding exactly the chunks the agent's key opens.
 */
import { TypedArrayEncoder } from '@credo-ts/core'

import { newThrowawayKey } from '../../trust-tasks/module/oobSignIn'
import { refusalCode } from '../real/wire'
import { FileBinding, MIN_SEGMENT_SIZE, blobRefOf, decodeFileId, openSegment } from '../real/files/stream'
import {
  DoorAnswer,
  FILE_BYTES,
  SLOW_HOST_FILE_BYTES,
  UPLOAD_TASK,
  UploadDeps,
  uploadFile,
  uploadLimitFor,
} from '../real/files/upload'

const ROOM = 'did:webvh:QmRoom:rooms.example'
const HOST = 'did:webvh:QmHost:community.example'
const FILE_KEY = new Uint8Array(32).fill(7)
const SEGMENT = MIN_SEGMENT_SIZE
const content = Uint8Array.from({ length: 2 * SEGMENT + 10 }, (_, i) => (i * 31) % 256)

type Sent = { type: string; issuer: string; id: string; payload: Record<string, unknown>; proof?: unknown }

function harness(
  options: {
    missing?: number[]
    mode?: string
    door?: (doc: Sent, n: number) => DoorAnswer | undefined
    commitRef?: string
  } = {}
) {
  const posted: Sent[] = []
  const held = new Map<number, Uint8Array>()
  const asked: Record<string, unknown>[] = []
  let begun: Record<string, unknown> | undefined
  const sleeps: number[] = []
  let ids = 0
  const deps: UploadDeps = {
    fileKey: async (payload) => {
      asked.push(payload)
      return { payload: { key: TypedArrayEncoder.toBase64Url(FILE_KEY), epoch: 3 } }
    },
    begin: async (payload) => {
      begun = payload
      const manifest = payload.manifest as { chunks: { chunkCount: number } }
      return {
        payload: {
          uploadId: 'up-1',
          mode: options.mode ?? 'proxied',
          missing: options.missing ?? [...Array(manifest.chunks.chunkCount).keys()],
          expiresAt: '2030-01-01T00:00:00Z',
        },
      }
    },
    read: async (position, length) => content.slice(position, position + length),
    post: async (document) => {
      const doc = document as unknown as Sent
      posted.push(doc)
      const scripted = options.door?.(doc, posted.length)
      if (scripted) return scripted
      if (doc.type === UPLOAD_TASK.chunk) {
        const p = doc.payload
        held.set(p.index as number, TypedArrayEncoder.fromBase64Url(p.data as string))
        return { status: 200, body: { payload: { uploadId: 'up-1', index: p.index, stored: true } } }
      }
      if (doc.type === UPLOAD_TASK.commit)
        return {
          status: 200,
          body: { payload: { blobRef: options.commitRef ?? blobRefOf(begun!.manifest as never), size: 1 } },
        }
      return { status: 200, body: { payload: {} } }
    },
    newKey: () => newThrowawayKey(),
    newId: () => `id-${++ids}`,
    now: () => Date.UTC(2026, 9, 29, 12),
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  }
  return { deps, posted, held, asked, sleeps, begun: () => begun }
}

const request = { roomId: ROOM, host: HOST, name: 'notes.pdf', mediaType: 'application/pdf', size: content.length }

describe('room file upload', () => {
  it('seals under the agent’s key, sends the missing chunks signed by a single-use key, and commits', async () => {
    const h = harness()
    const progress: number[] = []
    const { file, blobRef } = await uploadFile(
      h.deps,
      { ...request, segmentSize: SEGMENT },
      {
        onProgress: (p) => progress.push(p.sent),
      }
    )

    expect(h.asked).toEqual([{ roomId: ROOM, fileId: file.fileId, purpose: 'seal' }])
    const begun = h.begun()!
    expect(Object.keys(begun).sort()).toEqual(['manifest', 'roomId', 'uploadKey'])
    const uploadKey = begun.uploadKey as string
    expect(uploadKey).toMatch(/^did:key:z6Mk/)

    expect(h.posted.map((d) => d.type)).toEqual([
      UPLOAD_TASK.chunk,
      UPLOAD_TASK.chunk,
      UPLOAD_TASK.chunk,
      UPLOAD_TASK.commit,
    ])
    for (const doc of h.posted) {
      expect(doc.issuer).toBe(uploadKey)
      expect(doc).toHaveProperty('proof.cryptosuite', 'eddsa-jcs-2022')
      expect(doc).toHaveProperty('proof.proofPurpose', 'authentication')
    }

    // What the host holds opens with the agent's key, in this room, file and epoch, into the file.
    const binding: FileBinding = { roomId: ROOM, fileId: decodeFileId(file.fileId), epoch: 3, segmentSize: SEGMENT }
    const opened = [0, 1, 2].map((i) => openSegment(FILE_KEY, binding, i, h.held.get(i)!, i === 2))
    expect(Buffer.concat(opened)).toEqual(Buffer.from(content))

    expect(file).toMatchObject({ name: 'notes.pdf', mediaType: 'application/pdf', size: content.length, epoch: 3 })
    expect(blobRef).toBe(file.blobRef)
    expect(progress[progress.length - 1]).toBe((begun.manifest as { size: number }).size)
    expect([...progress].sort((a, b) => a - b)).toEqual(progress)
  })

  it('sends only what the host is missing', async () => {
    const h = harness({ missing: [1] })
    await uploadFile(h.deps, { ...request, segmentSize: SEGMENT })

    expect(h.posted.filter((d) => d.type === UPLOAD_TASK.chunk).map((d) => d.payload.index)).toEqual([1])
  })

  it('waits as long as a 429 asks, then sends the chunk again in a new document', async () => {
    const h = harness({ door: (_doc, n) => (n === 1 ? { status: 429, retryAfterSeconds: 4, body: {} } : undefined) })
    await uploadFile(h.deps, { ...request, segmentSize: SEGMENT })

    expect(h.sleeps).toEqual([4000])
    expect(h.posted[0].payload.index).toBe(0)
    expect(h.posted[1].payload.index).toBe(0)
    expect(h.posted[1].id).not.toBe(h.posted[0].id)
  })

  it('aborts at the host and reports the refusal when a chunk is refused', async () => {
    const h = harness({
      door: (doc) =>
        doc.type === UPLOAD_TASK.chunk
          ? {
              status: 200,
              body: { type: 'https://trusttasks.org/spec/trust-task-error/0.5', payload: { code: 'quotaExceeded' } },
            }
          : undefined,
    })
    const failed = await uploadFile(h.deps, { ...request, segmentSize: SEGMENT }).catch((e) => e)

    expect(refusalCode(failed)).toBe('quotaExceeded')
    expect(h.posted.map((d) => d.type)).toEqual([UPLOAD_TASK.chunk, UPLOAD_TASK.abort])
  })

  it('aborts at the host when cancelled, and the abort is still sent', async () => {
    const controller = new AbortController()
    const h = harness({
      door: (doc) => {
        if (doc.type === UPLOAD_TASK.chunk && doc.payload.index === 0) controller.abort()
        return undefined
      },
    })
    const failed = await uploadFile(h.deps, { ...request, segmentSize: SEGMENT }, { signal: controller.signal }).catch(
      (e) => e
    )

    expect(failed).toHaveProperty('name', 'AbortError')
    expect(h.posted.map((d) => d.type)).toEqual([UPLOAD_TASK.chunk, UPLOAD_TASK.abort])
  })

  it('refuses a commit of another blob', async () => {
    const h = harness({ commitRef: 'zQmSpqAfj8dtZpby8x5YiYGkdxApBh5bh8pJBBXMo7gYpqr' })
    const failed = await uploadFile(h.deps, { ...request, segmentSize: SEGMENT }).catch((e) => e)

    expect(failed).toBeInstanceOf(Error)
    expect(String(failed.message)).toMatch(/another blob|other than/)
    expect(h.posted[h.posted.length - 1].type).toBe(UPLOAD_TASK.abort)
  })

  it('refuses a direct transfer, which Keyring does not do, and aborts it', async () => {
    const h = harness({ mode: 'direct' })
    const failed = await uploadFile(h.deps, { ...request, segmentSize: SEGMENT }).catch((e) => e)

    expect(refusalCode(failed)).toBe('directNotBuilt')
    expect(h.posted.map((d) => d.type)).toEqual([UPLOAD_TASK.abort])
  })

  it('keeps files small on a host before VTC 0.15, and on one whose version is unknown', () => {
    expect(uploadLimitFor('0.12.0')).toBe(SLOW_HOST_FILE_BYTES)
    expect(uploadLimitFor(undefined)).toBe(SLOW_HOST_FILE_BYTES)
    expect(uploadLimitFor('0.15.0')).toBe(FILE_BYTES)
    expect(uploadLimitFor('1.0.0')).toBe(FILE_BYTES)
  })
})
