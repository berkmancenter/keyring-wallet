/**
 * Uploading one file to a sealed room, as upstream's `pnm rooms file put` does
 * (vta-cli-common `cmd_rooms_file_put` @ vta-service-v0.67.0), up to the committed blob. The record naming
 * it is the caller's: it is a sealed write like any note.
 *
 * 1. A file key for a fresh `fileId` from the agent (`rooms/keys/file-key/0.2`, `seal`), under the room's current
 *    epoch, which the answer names.
 * 2. The file sealed segment by segment (`stream.ts`), which gives the blob manifest and the file manifest.
 * 3. A single-use upload did:key, made here and dropped when the upload ends.
 * 4. `rooms/blobs/upload/begin/0.2` completed as the member by the agent and sent like any member request. It names
 *    the upload key and no `directParts`, so the host offers only a proxied transfer.
 * 5. Each chunk the host is missing, as `rooms/blobs/upload/chunk/0.2` signed by the upload key.
 * 6. `rooms/blobs/upload/commit/0.2`, signed by the upload key; on any failure, `abort` instead.
 *
 * Steps 5 and 6 go to the host's HTTPS Trust Task door (`<TrustTaskHTTPS base>/trust-tasks`), never over the
 * phone's session: a VTC refuses a messaging document signed by anyone but its sender (vtc-service-v0.12.0
 * `trust_tasks/mod.rs` step 3a), and the upload key is not the sender. On that door a host before VTC 0.15 holds
 * room documents to its anonymous limit (a burst of 10, then one every 5 s), so a `429` waits as long as the host
 * says and sends the chunk again in a new document.
 */
import { digestBytesEqual, wireTimestamp } from '@bifold/trust-tasks'
import { TypedArrayEncoder } from '@credo-ts/core'

import type { FileManifest } from '../wire'
import type { RoomsTransferOptions } from '../../types'
import type { ThrowawayKey } from '../../../trust-tasks/module/oobSignIn'

import { FileSealer, MAX_SEGMENT_SIZE, blobRefOf, bytesDigestMultibase, encodeFileId, newFileId } from './stream'

const SPEC = 'https://trusttasks.org/spec/'

export const UPLOAD_TASK = {
  fileKey: `${SPEC}rooms/keys/file-key/0.2`,
  begin: `${SPEC}rooms/blobs/upload/begin/0.2`,
  chunk: `${SPEC}rooms/blobs/upload/chunk/0.2`,
  commit: `${SPEC}rooms/blobs/upload/commit/0.2`,
  abort: `${SPEC}rooms/blobs/upload/abort/0.2`,
} as const

/**
 * The segment Keyring seals with. Its chunk document (base64url data and the envelope) stays under the 64 KiB a
 * host's HTTPS door takes from an unauthenticated caller, which the upload key is (vtc-service `UNAUTH_BODY_SIZE`).
 */
export const UPLOAD_SEGMENT_SIZE = 32_752

/** The most a file may be on a host whose door holds room documents to its anonymous limit (before VTC 0.15). */
export const SLOW_HOST_FILE_BYTES = 2_000_000
/** The most a file may be elsewhere: the picker's limit. */
export const FILE_BYTES = 25_000_000

/** How long to wait on a `429` that names no time: the anonymous limit's interval. */
const DEFAULT_RETRY_AFTER_MS = 5_000
/** How many times one chunk is sent before the upload gives up. */
const CHUNK_ATTEMPTS = 8

/** The most a file may be on a host of this version (its `/health` `version`); an unknown host gets the lower one. */
export function uploadLimitFor(hostVersion: string | undefined): number {
  const match = /^(\d+)\.(\d+)\./.exec(hostVersion ?? '')
  if (!match) return SLOW_HOST_FILE_BYTES
  const [major, minor] = [Number(match[1]), Number(match[2])]
  return major > 0 || minor >= 15 ? FILE_BYTES : SLOW_HOST_FILE_BYTES
}

/** A host's HTTPS answer: its status, how long it asked to be left alone, and its JSON. */
export interface DoorAnswer {
  status: number
  retryAfterSeconds?: number
  body: unknown
}

export interface UploadDeps {
  /** `rooms/keys/file-key/0.2` from the agent; its answer as the agent gave it. */
  fileKey(payload: Record<string, unknown>): Promise<unknown>
  /** `rooms/blobs/upload/begin/0.2`, completed as the member and sent to the host; the host's answer. */
  begin(payload: Record<string, unknown>): Promise<unknown>
  /** `length` bytes of the picked file from `position`. */
  read(position: number, length: number): Promise<Uint8Array>
  /** POST one signed document to the host's door. */
  post(document: Record<string, unknown>, signal?: AbortSignal): Promise<DoorAnswer>
  newKey(): ThrowawayKey
  newId(): string
  now(): number
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}

export interface UploadRequest {
  roomId: string
  /** The room's host: every upload document's recipient. */
  host: string
  name: string
  mediaType?: string
  size: number
  segmentSize?: number
}

/** A refusal, read as the rest of the rooms code reads one (`refusalCode`). */
export class UploadRefusal extends Error {
  public constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'VtiRefusal'
  }
}

const abortError = () => Object.assign(new Error('the upload was cancelled'), { name: 'AbortError' })
const obj = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined

/** A Trust Task answer's payload, or its refusal thrown. */
function payloadOf(what: string, answer: unknown): Record<string, unknown> {
  const doc = obj(answer)
  const type = typeof doc?.type === 'string' ? doc.type : ''
  if (type.includes('/trust-task-error/')) {
    const code = obj(doc?.payload)?.code
    const named = typeof code === 'string' ? code.slice(code.lastIndexOf(':') + 1) : 'refused'
    throw new UploadRefusal(named, `the host refused ${what}: ${named}`)
  }
  const payload = obj(doc?.payload) ?? doc
  if (!payload) throw new Error(`the answer to ${what} is not a JSON object`)
  return payload
}

interface Begun {
  uploadId: string
  mode: string
  missing: number[]
  alreadyCommitted: boolean
}

function parseBegun(payload: Record<string, unknown>): Begun | undefined {
  const { uploadId, mode, missing } = payload
  if (typeof uploadId !== 'string' || typeof mode !== 'string' || !Array.isArray(missing)) return undefined
  if (!missing.every((i) => Number.isInteger(i) && i >= 0)) return undefined
  return { uploadId, mode, missing: missing as number[], alreadyCommitted: payload.alreadyCommitted === true }
}

/**
 * Seals and uploads the file, and commits its blob. Resolves with the file manifest for the sealed record and the
 * committed `blobRef` for its `blobs`. Cancelling, or any failure after `begin`, aborts the upload at the host.
 */
export async function uploadFile(
  deps: UploadDeps,
  request: UploadRequest,
  options: RoomsTransferOptions = {}
): Promise<{ file: FileManifest; blobRef: string }> {
  const { signal, onProgress } = options
  const checkAbort = () => {
    if (signal?.aborted) throw abortError()
  }
  const segmentSize = Math.min(request.segmentSize ?? UPLOAD_SEGMENT_SIZE, MAX_SEGMENT_SIZE)

  // 1–2: the key, then every segment sealed before anything is sent: `begin` commits to every chunk's digest.
  const fileId = newFileId()
  const granted = payloadOf(
    'the file key',
    await deps.fileKey({ roomId: request.roomId, fileId: encodeFileId(fileId), purpose: 'seal' })
  )
  if (typeof granted.key !== 'string' || !Number.isInteger(granted.epoch))
    throw new Error('the agent answered the file key with something else')
  const key = TypedArrayEncoder.fromBase64Url(granted.key)
  if (key.length !== 32) throw new Error('the agent’s file key is not 32 bytes')
  const sealer = new FileSealer(
    key,
    { roomId: request.roomId, fileId, epoch: granted.epoch as number, segmentSize },
    request.size
  )
  const chunks: Uint8Array[] = []
  for (let i = 0, at = 0; i < sealer.segments; i++) {
    checkAbort()
    const length = sealer.segmentLength(i)
    const plain = await deps.read(at, length)
    if (plain.length !== length) throw new Error('the file changed while it was being read')
    chunks.push(sealer.sealNext(plain))
    at += length
  }
  key.fill(0)
  const { blob, file } = sealer.finish(request.name, request.mediaType)
  checkAbort()

  // 3–4
  const uploadKey = deps.newKey()
  const begun = parseBegun(
    payloadOf('the upload', await deps.begin({ roomId: request.roomId, manifest: blob, uploadKey: uploadKey.did }))
  )
  if (!begun) throw new Error('the host answered the upload with something else')

  const signed = (type: string, payload: Record<string, unknown>) =>
    uploadKey.sign(
      {
        id: `urn:uuid:${deps.newId()}`,
        type,
        issuer: uploadKey.did,
        recipient: request.host,
        issuedAt: wireTimestamp(new Date(Math.floor(deps.now() / 1000) * 1000)),
        payload,
      },
      'authentication'
    )

  /** One upload-key document to the door, sent again in a new document while the host asks for time. */
  const send = async (
    what: string,
    type: string,
    payload: Record<string, unknown>,
    until: AbortSignal | null = signal ?? null
  ) => {
    for (let attempt = 1; ; attempt++) {
      const answer = await deps.post(signed(type, payload), until ?? undefined)
      if (answer.status !== 429) return payloadOf(what, answer.body)
      if (attempt >= CHUNK_ATTEMPTS) throw new UploadRefusal('rateLimited', `the host kept asking for time on ${what}`)
      const wait = answer.retryAfterSeconds !== undefined ? answer.retryAfterSeconds * 1000 : DEFAULT_RETRY_AFTER_MS
      await deps.sleep(wait, until ?? undefined)
    }
  }

  if (begun.alreadyCommitted) return { file, blobRef: blobRefOf(blob) }
  try {
    if (begun.mode !== 'proxied')
      throw new UploadRefusal('directNotBuilt', `the host offered a ${begun.mode} transfer, which Keyring does not do`)
    // 5: the chunks the host already holds count as sent.
    const missing = new Set(begun.missing)
    let sent = chunks.reduce((n, c, i) => (missing.has(i) ? n : n + c.length), 0)
    onProgress?.({ sent, total: blob.size })
    for (const index of begun.missing) {
      checkAbort()
      const chunk = chunks[index]
      if (!chunk) throw new Error(`the host asked for chunk ${index}, which does not exist`)
      const stored = await send(`chunk ${index}`, UPLOAD_TASK.chunk, {
        uploadId: begun.uploadId,
        index,
        digestMultibase: bytesDigestMultibase(chunk),
        data: TypedArrayEncoder.toBase64Url(chunk),
      })
      if (stored.index !== index) throw new Error(`the host answered chunk ${index} with another`)
      sent += chunk.length
      onProgress?.({ sent, total: blob.size })
    }
    checkAbort()
    // 6
    const committed = await send('the commit', UPLOAD_TASK.commit, { uploadId: begun.uploadId })
    if (typeof committed.blobRef !== 'string' || !digestBytesEqual(committed.blobRef, file.blobRef))
      throw new Error('the host committed a blob other than the one sealed here')
    return { file, blobRef: committed.blobRef }
  } catch (e) {
    // Releases what `begin` reserved rather than leaving it to expire, cancelled or not; a failure here changes
    // nothing (the host lets an unfinished upload expire).
    await send('the abort', UPLOAD_TASK.abort, { uploadId: begun.uploadId }, null).catch(() => undefined)
    throw e
  }
}
