/**
 * Posting a file through the service: where it is offered, what it refuses before anything is sent, and the order
 * of the legs for a post that goes (the file key, begin through act, the chunks and commit at the host's door, then
 * the sealed record naming the blob, put at 0.2).
 */
import { AgentRoomsService, type RoomsBackend, type RoomsCommunity } from '../real/agentRoomsService'
import { SLOW_HOST_FILE_BYTES, UPLOAD_TASK } from '../real/files/upload'
import { blobRefOf } from '../real/files/stream'
import { ROOMS_TASK } from '../real/wire'
import { RoomsRefused, RoomsUnavailable } from '../types'

const COMMUNITY: RoomsCommunity = { did: 'did:webvh:community:a', name: 'Garden club', personaDid: 'did:key:persona-a' }
const HOST = COMMUNITY.did
const OPEN_ROOM = 'did:webvh:room:open1'
const SEALED_ROOM = 'did:webvh:room:attributed1'
const PRIVATE_ROOM = 'did:webvh:room:private1'
const BASE = 'https://community.example/v1'
const FILE_KEY = Buffer.alloc(32, 9).toString('base64url')
const CONTENT = Buffer.from('the minutes of the garden club, in full')

const SERVED = [
  ROOMS_TASK.keysList02,
  ROOMS_TASK.keysBrowse,
  ROOMS_TASK.keysRead,
  ROOMS_TASK.keysAct06,
  ROOMS_TASK.keysSeal02,
  UPLOAD_TASK.fileKey,
]

function setup(o: { served?: string[]; version?: string; uploads?: boolean } = {}) {
  const calls: string[] = []
  let manifest: unknown
  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>): Promise<unknown> => {
    switch (type) {
      case ROOMS_TASK.keysList02:
        return { rooms: [] }
      case ROOMS_TASK.keysBrowse:
        return { records: [] }
      case UPLOAD_TASK.fileKey:
        calls.push('file-key')
        return { key: FILE_KEY, epoch: 2 }
      case ROOMS_TASK.keysSeal02:
        calls.push('seal')
        return { sealed: { ciphertext: `sealed:${String(payload.plaintext)}`, nonce: 'nonce', epoch: 2 } }
      case ROOMS_TASK.keysAct06: {
        const document = payload.document as Record<string, unknown>
        calls.push(`act ${String(document.type).replace('https://trusttasks.org/spec/', '')}`)
        return { principal: COMMUNITY.personaDid, document: { ...document, proof: { type: 'DataIntegrityProof' } } }
      }
      default:
        throw new Error(`unexpected agent task ${type}`)
    }
  })
  const communityTask = jest.fn(async () => ({
    items: [
      { roomId: OPEN_ROOM, host: HOST, visibility: 'open', actions: ['read', 'write'], state: 'admitted' },
      { roomId: SEALED_ROOM, host: HOST, visibility: 'attributed', actions: ['read', 'write'], state: 'admitted' },
      { roomId: PRIVATE_ROOM, host: HOST, visibility: 'private', actions: ['read', 'write'], state: 'admitted' },
    ],
  }))
  const sendCompleted = jest.fn(async (_did: string, _to: string, document: Record<string, unknown>) => {
    const payload = document.payload as Record<string, unknown>
    if (document.type === UPLOAD_TASK.begin) {
      manifest = payload.manifest
      return { uploadId: 'up-1', mode: 'proxied', missing: [0], expiresAt: '2030-01-01T00:00:00Z' }
    }
    return { key: payload.key, version: 1, epoch: 2 }
  })
  const postToDoor = jest.fn(async (base: string, document: Record<string, unknown>) => {
    calls.push(`door ${String(document.type).replace('https://trusttasks.org/spec/', '')}`)
    expect(base).toBe(BASE)
    const payload = document.payload as Record<string, unknown>
    if (document.type === UPLOAD_TASK.chunk)
      return { status: 200, body: { uploadId: 'up-1', index: payload.index, stored: true } }
    return { status: 200, body: { blobRef: blobRefOf(manifest as never), size: 1 } }
  })
  let ids = 0
  const backend: RoomsBackend = {
    agentLinked: () => true,
    agentServedTypes: async () => o.served ?? SERVED,
    agentTask,
    communities: async () => [COMMUNITY],
    communityTask,
    sendCompleted,
    newId: () => `id-${++ids}`,
    leaveCommunity: jest.fn(async () => undefined),
    decodeBase64Url: (s) => Buffer.from(s, 'base64url').toString('utf8'),
    encodeBase64Url: (text) => Buffer.from(text, 'utf8').toString('base64url'),
    hiddenOffers: async () => [],
    hideOffer: jest.fn(async () => undefined),
    warn: jest.fn(),
    ...(o.uploads === false
      ? {}
      : {
          uploads: {
            readFile: async (_uri: string, position: number, length: number) =>
              Uint8Array.from(CONTENT.subarray(position, position + length)),
            hostDoor: async () => ({ base: BASE, version: o.version ?? '0.12.0' }),
            postToDoor,
          },
        }),
  }
  const service = new AgentRoomsService(backend, undefined, { now: () => Date.UTC(2026, 9, 29) })
  return { service, agentTask, sendCompleted, postToDoor, calls }
}

const attachment = (size = CONTENT.length) => ({
  uri: 'file:///minutes.txt',
  name: 'minutes.txt',
  mimeType: 'text/plain',
  size,
})
const sealedBody = (agentTask: jest.Mock) => {
  const seal = agentTask.mock.calls.find((c) => c[0] === ROOMS_TASK.keysSeal02)![1] as { plaintext: string }
  return JSON.parse(Buffer.from(seal.plaintext, 'base64url').toString('utf8')) as Record<string, unknown>
}

describe('posting a file to a room', () => {
  it('is offered on an attributed room only', async () => {
    const { service } = setup()
    expect((await service.roomCapabilities(SEALED_ROOM)).uploadFile).toMatchObject({ status: 'available' })
    expect((await service.roomCapabilities(OPEN_ROOM)).uploadFile).toMatchObject({ reason: 'notOnThisTier' })
    expect((await service.roomCapabilities(PRIVATE_ROOM)).uploadFile).toMatchObject({ reason: 'tierNotYet' })
  })

  it('is not offered where the agent gives no file keys, or this phone has no upload leg', async () => {
    const old = setup({ served: SERVED.filter((t) => t !== UPLOAD_TASK.fileKey) })
    expect((await old.service.roomCapabilities(SEALED_ROOM)).uploadFile).toMatchObject({ reason: 'agentDoesNotServe' })
    const none = setup({ uploads: false })
    expect((await none.service.roomCapabilities(SEALED_ROOM)).uploadFile).toMatchObject({ reason: 'clientNotBuilt' })
  })

  it('uploads the file, then writes a sealed record naming it at put 0.2', async () => {
    const { service, agentTask, sendCompleted, calls } = setup()
    const preview = await service.prepareWrite(SEALED_ROOM, { title: '', body: '', attachment: attachment() })
    const progress: number[] = []
    const written = await service.confirmWrite(preview.token, { onProgress: (p) => progress.push(p.sent) })

    expect(calls).toEqual([
      'file-key',
      'act rooms/blobs/upload/begin/0.2',
      'door rooms/blobs/upload/chunk/0.2',
      'door rooms/blobs/upload/commit/0.2',
      'seal',
      'act rooms/records/put/0.2',
    ])
    const body = sealedBody(agentTask)
    expect(body).toMatchObject({ roomId: SEALED_ROOM, author: COMMUNITY.personaDid, version: 1 })
    expect(body).not.toHaveProperty('body')
    expect(body.file).toMatchObject({ name: 'minutes.txt', mediaType: 'text/plain', size: CONTENT.length, epoch: 2 })

    const put = sendCompleted.mock.calls.find((c) => c[2].type === ROOMS_TASK.recordsPut02)![2]
    const blobRef = (body.file as { blobRef: string }).blobRef
    expect((put.payload as Record<string, unknown>).blobs).toEqual([blobRef])
    expect(written).toEqual({ key: expect.stringMatching(/^note\//), version: 1 })
    expect(progress.length).toBeGreaterThan(0)
  })

  it('refuses a file larger than a host before VTC 0.15 takes, before anything is sent', async () => {
    const { service, calls } = setup({ version: '0.12.0' })
    const err = await service
      .prepareWrite(SEALED_ROOM, { title: '', body: '', attachment: attachment(SLOW_HOST_FILE_BYTES + 1) })
      .catch((e) => e)
    expect(err).toBeInstanceOf(RoomsRefused)
    expect(err).toMatchObject({ code: 'fileTooLarge' })
    expect(calls).toEqual([])
  })

  it('takes the larger file where the host is VTC 0.15 or later', async () => {
    const { service } = setup({ version: '0.15.0' })
    await expect(
      service.prepareWrite(SEALED_ROOM, { title: '', body: '', attachment: attachment(SLOW_HOST_FILE_BYTES + 1) })
    ).resolves.toMatchObject({ tier: 'attributed' })
  })

  it('refuses a file for an open room before anything is sent', async () => {
    const { service, calls } = setup()
    const err = await service
      .prepareWrite(OPEN_ROOM, { title: '', body: 'see attached', attachment: attachment() })
      .catch((e) => e)
    expect(err).toBeInstanceOf(RoomsUnavailable)
    expect(calls).toEqual([])
  })
})
