/**
 * Opening a room file (F3), through a real sealed file: the record's manifest, the host's blob and chunks through
 * `rooms/keys/act`, the file's key from the agent. What a host can do wrong is refused and leaves nothing behind.
 */
import { DeviceEventEmitter } from 'react-native'
import RNFS from 'react-native-fs'

import { WALLET_LOCKED_EVENT } from '../../../utils/walletLocked'
import { AgentRoomsService, type RoomsBackend, type RoomsCommunity } from '../real/agentRoomsService'
import { OPEN_FILE_BYTES, type OpenFileCopy } from '../real/files/open'
import { decodeFileId, sealFile } from '../real/files/stream'
import { KEYS_ACT_TYPES, ROOMS_TASK, type FileManifest } from '../real/wire'
import { RoomsRefused } from '../types'

import { resolverOf, signBody, testAuthor } from './fixtures/signedBody'

jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: { CachesDirectoryPath: '/caches', unlink: jest.fn(async () => undefined) },
}))

const COMMUNITY: RoomsCommunity = { did: 'did:webvh:community:a', name: 'Garden club', personaDid: 'did:key:persona-a' }
const ROOM = 'did:webvh:room:0123456789abcdef'
const HOST = 'did:webvh:community:a'
const FILE_ID = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
const KEY = new Uint8Array(32).fill(9)
const SEGMENT = 16_368

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url')
const plaintextOf = (length: number) => Uint8Array.from({ length }, (_, i) => i % 251)
const seal = (plain: Uint8Array, name = 'minutes.pdf', mediaType?: string) =>
  sealFile(KEY, { roomId: ROOM, fileId: decodeFileId(FILE_ID), epoch: 3, segmentSize: SEGMENT }, plain, name, mediaType)

type Sealed = ReturnType<typeof seal>

const ALICE = testAuthor('did:key:alice')

/** The record's body as Alice's agent signed it; `signed: false` leaves the proof off. */
const body = (file: FileManifest, signed = true) => {
  const unsigned = { roomId: ROOM, key: 'f1', version: 4, author: ALICE.did, file }
  return b64url(Buffer.from(JSON.stringify(signed ? signBody(ALICE, unsigned) : unsigned)))
}

/** A copy in memory, as `fileCopies` gives one. */
function copies(atFinish?: () => void) {
  const made: (OpenFileCopy & { bytes: number[]; state: string; finished: boolean })[] = []
  return {
    made,
    fileCopies: {
      create: jest.fn(async () => {
        const copy = {
          bytes: [] as number[],
          state: 'open',
          finished: false,
          append: async (plain: Uint8Array) => {
            copy.bytes.push(...plain)
          },
          finish: async () => {
            copy.state = 'finished'
            copy.finished = true
            atFinish?.()
            return 'file:///caches/copy/minutes.pdf'
          },
          discard: async () => {
            copy.state = 'discarded'
          },
        }
        made.push(copy)
        return copy
      }),
      release: jest.fn(async () => undefined),
    },
  }
}

interface Host {
  sealed: Sealed
  /** Each chunk's answer; a thrown error stands for no answer or a refusal. */
  chunk?: (index: number, data: Uint8Array) => Promise<Record<string, unknown>> | Record<string, unknown>
  blobAnswer?: (standard: Record<string, unknown>) => Record<string, unknown>
  fileKey?: () => Promise<unknown>
  file?: FileManifest
  atFinish?: () => void
  /** The record as stored is not signed by its author. */
  unsigned?: boolean
  /** Who shared it can't be checked: no DID document is to be had. */
  noDocuments?: boolean
}

function backend(host: Host) {
  const file = host.file ?? host.sealed.file
  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>): Promise<unknown> => {
    if ((KEYS_ACT_TYPES as readonly string[]).includes(type))
      return { principal: COMMUNITY.personaDid, document: { ...(payload.document as object), proof: {} } }
    switch (type) {
      case ROOMS_TASK.keysList02:
        return { rooms: [{ roomId: ROOM, epoch: 3, earliestReadableEpoch: 1, member: COMMUNITY.personaDid }] }
      case ROOMS_TASK.keysBrowse:
        return {
          records: [{ key: 'f1', version: 4, status: 'active', author: 'did:key:alice' }],
          complete: true,
        }
      case ROOMS_TASK.keysRead:
        return { key: 'f1', version: 4, status: 'active', author: ALICE.did, plaintext: body(file, !host.unsigned) }
      case ROOMS_TASK.keysFileKey:
        return host.fileKey ? host.fileKey() : { key: b64url(KEY), epoch: 3 }
      default:
        throw new Error(`unexpected agent task ${type}`)
    }
  })
  const sendCompleted = jest.fn(async (_community: string, _host: string, document: Record<string, unknown>) => {
    const p = document.payload as Record<string, unknown>
    if (document.type === ROOMS_TASK.blobsGet) {
      const standard = {
        mode: 'proxied',
        manifest: host.sealed.blob,
        downloadId: 'dl-1',
        expiresAt: '2026-11-02T00:00:00Z',
      }
      return host.blobAnswer ? host.blobAnswer(standard) : standard
    }
    const index = p.index as number
    const data = host.sealed.chunks[index]
    if (host.chunk) return host.chunk(index, data)
    return { index, digestMultibase: 'zHostsWord', data: b64url(data) }
  })
  const made = copies(host.atFinish)
  const warn = jest.fn()
  const b = {
    agentLinked: () => true,
    agentServedTypes: async () => [
      ROOMS_TASK.keysList02,
      ROOMS_TASK.keysBrowse,
      ROOMS_TASK.keysRead,
      ROOMS_TASK.keysFileKey,
      ROOMS_TASK.keysAct08,
    ],
    agentTask,
    communities: async () => [COMMUNITY],
    communityTask: jest.fn(async () => ({
      items: [{ roomId: ROOM, host: HOST, visibility: 'attributed', actions: ['read'], state: 'admitted' }],
    })),
    sendCompleted,
    newId: () => 'id-1',
    leaveCommunity: jest.fn(async () => undefined),
    decodeBase64Url: (s: string) => Buffer.from(s, 'base64url').toString('utf8'),
    encodeBase64Url: (s: string) => Buffer.from(s, 'utf8').toString('base64url'),
    hiddenOffers: async () => [],
    hideOffer: jest.fn(async () => undefined),
    warn,
    fileCopies: made.fileCopies,
    resolveSender: host.noDocuments ? resolverOf().resolve : resolverOf(ALICE).resolve,
  } as unknown as RoomsBackend
  const service = new AgentRoomsService(b)
  const hostTypes = () => sendCompleted.mock.calls.map(([, , document]) => document.type)
  return { b, service, agentTask, sendCompleted, hostTypes, warn, ...made }
}

const refusal = (text: string, code: string) => Object.assign(new Error(text), { name: 'VtiRefusal', code })

const open = (service: AgentRoomsService, options = {}) => service.openFile(ROOM, FILE_ID, options)

describe('opening a room file', () => {
  it('the first service of a launch clears what a killed app left, before any room can open, and only that one', () => {
    expect(RNFS.unlink).not.toHaveBeenCalled()
    backend({ sealed: seal(plaintextOf(5)) })
    expect(RNFS.unlink).toHaveBeenCalledTimes(1)
    expect(RNFS.unlink).toHaveBeenCalledWith('/caches/keyring-room-files')
    backend({ sealed: seal(plaintextOf(5)) })
    expect(RNFS.unlink).toHaveBeenCalledTimes(1)
  })

  it('fetches the blob, then its key, then each chunk; the copy holds the plaintext and is made final last', async () => {
    const plain = plaintextOf(SEGMENT + 40)
    const { service, sendCompleted, agentTask, made } = backend({
      sealed: seal(plain, 'minutes.pdf', 'application/pdf'),
    })
    const progress: number[] = []

    const opened = await open(service, { onProgress: (p: { sent: number }) => progress.push(p.sent) })

    expect(opened).toEqual({
      localUri: 'file:///caches/copy/minutes.pdf',
      mediaType: 'application/pdf',
      size: SEGMENT + 40,
    })
    expect(Uint8Array.from(made[0].bytes)).toEqual(plain)
    expect(made[0].state).toBe('finished')
    expect(progress).toEqual([SEGMENT + 16, SEGMENT + 16 + 40 + 16])

    const [get, first, second] = sendCompleted.mock.calls.map(([, recipient, document]) => ({
      ...document,
      recipient,
      payload: document.payload,
    }))
    expect(get).toMatchObject({ type: ROOMS_TASK.blobsGet, recipient: HOST, issuer: COMMUNITY.personaDid })
    expect(first).toMatchObject({ type: ROOMS_TASK.blobsChunk, issuer: COMMUNITY.personaDid })
    expect(first.payload).toEqual({ downloadId: 'dl-1', index: 0 })
    expect(second.payload).toEqual({ downloadId: 'dl-1', index: 1 })
    // Absent is proxied: no storage URL is ever asked for.
    expect(get.payload).toEqual({ roomId: ROOM, blobRef: seal(plain).file.blobRef })
    expect(agentTask.mock.calls.find(([type]) => type === ROOMS_TASK.keysFileKey)?.[1]).toEqual({
      roomId: ROOM,
      fileId: FILE_ID,
      purpose: 'open',
      epoch: 3,
    })
  })

  it('calls a file an image from its bytes, never from the type the post claims', async () => {
    const png = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64'
      )
    )
    const claimedPdf = await open(backend({ sealed: seal(png, 'a.pdf', 'application/pdf') }).service)
    expect(claimedPdf.image).toBe(true)
    const claimedPng = await open(backend({ sealed: seal(plaintextOf(64), 'a.png', 'image/png') }).service)
    expect(claimedPng.image).toBeUndefined()
  })

  it('refuses a changed chunk: nothing is kept', async () => {
    const { service, made } = backend({
      sealed: seal(plaintextOf(SEGMENT + 40)),
      chunk: (index, data) => {
        const changed = data.slice()
        if (index === 1) changed[0] ^= 1
        return { index, digestMultibase: 'zHostsWord', data: b64url(changed) }
      },
    })
    await expect(open(service)).rejects.toThrow('chunk 1 does not match the manifest')
    expect(made[0].state).toBe('discarded')
  })

  it('a file whose digest fails is never made final', async () => {
    const sealed = seal(plaintextOf(5))
    const wrong = seal(plaintextOf(6)).file.digest
    const { service, made } = backend({ sealed, file: { ...sealed.file, digest: wrong } })
    await expect(open(service)).rejects.toThrow('the file does not match its digest')
    expect(made[0].finished).toBe(false)
    expect(made[0].state).toBe('discarded')
  })

  it('refuses a blob that is not the one the record names, before asking for any key', async () => {
    const other = seal(plaintextOf(7))
    const { service, agentTask, made } = backend({
      sealed: seal(plaintextOf(5)),
      blobAnswer: (standard) => ({ ...standard, manifest: other.blob }),
    })
    await expect(open(service)).rejects.toThrow('the blob manifest is not the one the file names')
    expect(agentTask.mock.calls.some(([type]) => type === ROOMS_TASK.keysFileKey)).toBe(false)
    expect(made).toHaveLength(0)
  })

  it('does not use a storage URL, even when a host offers one', async () => {
    const { service, hostTypes, made } = backend({
      sealed: seal(plaintextOf(5)),
      blobAnswer: (standard) => ({ ...standard, mode: 'direct', target: { url: 'https://s3' } }),
    })
    await expect(open(service)).rejects.toThrow('the host did not open a proxied download')
    expect(hostTypes()).toEqual([ROOMS_TASK.blobsGet])
    expect(made).toHaveLength(0)
  })

  it('a member the agent will not give the key to gets its refusal, and no copy', async () => {
    const { service, made } = backend({
      sealed: seal(plaintextOf(5)),
      fileKey: async () => {
        throw refusal('removed', 'rooms/keys/file-key:unknownEpoch')
      },
    })
    await expect(open(service)).rejects.toMatchObject({ name: 'RoomsRefused', code: 'unknownEpoch' })
    expect(made).toHaveLength(0)
  })

  it('asks a chunk again when no answer came, and stops after three', async () => {
    let asked = 0
    const flaky = backend({
      sealed: seal(plaintextOf(5)),
      chunk: (index, data) => {
        asked++
        if (asked === 1) throw new Error('no answer')
        return { index, digestMultibase: 'z', data: b64url(data) }
      },
    })
    await expect(open(flaky.service)).resolves.toMatchObject({ size: 5 })
    expect(asked).toBe(2)

    let tries = 0
    const lost = backend({
      sealed: seal(plaintextOf(5)),
      chunk: () => {
        tries++
        throw new Error('no answer')
      },
    })
    await expect(open(lost.service)).rejects.toThrow('no answer')
    expect(tries).toBe(3)
    expect(lost.made[0].state).toBe('discarded')
  })

  it('does not ask again after a refusal', async () => {
    let tries = 0
    const { service } = backend({
      sealed: seal(plaintextOf(5)),
      chunk: () => {
        tries++
        throw refusal('gone', 'rooms/blobs/chunk:notFound')
      },
    })
    await expect(open(service)).rejects.toThrow('gone')
    expect(tries).toBe(1)
  })

  it('a file the room no longer lists is not opened', async () => {
    const { service, hostTypes } = backend({ sealed: seal(plaintextOf(5)) })
    await expect(service.openFile(ROOM, 'B'.repeat(43))).rejects.toThrow(RoomsRefused)
    expect(hostTypes()).toEqual([])
  })

  it('a file whose record is not signed by who it names is refused before anything is fetched, and no copy is made', async () => {
    const control = backend({ sealed: seal(plaintextOf(5)) })
    await expect(open(control.service)).resolves.toMatchObject({ size: 5 })

    const { service, sendCompleted, agentTask, made } = backend({ sealed: seal(plaintextOf(5)), unsigned: true })
    const refused = await open(service).catch((e) => e)
    expect(refused).toBeInstanceOf(RoomsRefused)
    expect(refused.code).toBe('senderRefused')
    expect(sendCompleted).not.toHaveBeenCalled()
    expect(agentTask.mock.calls.map(([type]) => type)).not.toContain(ROOMS_TASK.keysFileKey)
    expect(made).toHaveLength(0)
  })

  it('a file whose sharer can’t be checked still opens: unconfirmed is not refused', async () => {
    const { service } = backend({ sealed: seal(plaintextOf(5)), noDocuments: true })
    await expect(open(service)).resolves.toMatchObject({ size: 5 })
  })

  it('a file over the limit is refused from its manifest, before anything is fetched', async () => {
    const sealed = seal(plaintextOf(5))
    const { service, hostTypes } = backend({ sealed, file: { ...sealed.file, size: OPEN_FILE_BYTES + 1 } })
    await expect(open(service)).rejects.toThrow('tooLarge')
    expect(hostTypes()).toEqual([])
  })

  it('Cancel stops at once, without waiting for the chunk under way, and keeps nothing', async () => {
    const stop = new AbortController()
    const { service, made, warn } = backend({
      sealed: seal(plaintextOf(5)),
      chunk: () => new Promise(() => stop.abort()),
    })
    await expect(open(service, { signal: stop.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(made[0].state).toBe('discarded')
    expect(warn).not.toHaveBeenCalled()
  })

  it('a lock stops a file being opened and deletes every copy', async () => {
    const { service, made } = backend({
      sealed: seal(plaintextOf(5)),
      chunk: () =>
        new Promise(() => {
          DeviceEventEmitter.emit(WALLET_LOCKED_EVENT)
        }),
    })
    await expect(open(service)).rejects.toMatchObject({ name: 'AbortError' })
    expect(made[0].state).toBe('discarded')
    expect(RNFS.unlink).toHaveBeenCalledWith('/caches/keyring-room-files')
  })

  it('a lock at the very last moment still keeps nothing', async () => {
    const { service, made } = backend({
      sealed: seal(plaintextOf(5)),
      atFinish: () => {
        DeviceEventEmitter.emit(WALLET_LOCKED_EVENT)
      },
    })
    await expect(open(service)).rejects.toMatchObject({ name: 'AbortError' })
    expect(made[0].state).toBe('discarded')
  })

  it('what goes to the log names neither the file nor its key', async () => {
    const { service, warn } = backend({
      sealed: seal(plaintextOf(SEGMENT + 40), 'secret-name.pdf'),
      chunk: (index) => ({ index, digestMultibase: 'z', data: 'AAAA' }),
    })
    await expect(open(service)).rejects.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    const said = JSON.stringify(warn.mock.calls)
    expect(said).not.toContain('secret-name')
    expect(said).not.toContain(b64url(KEY))
  })

  it('releaseFile deletes the copy it is given', async () => {
    const { service, fileCopies } = backend({ sealed: seal(plaintextOf(5)) })
    await service.releaseFile('file:///caches/copy/minutes.pdf')
    expect(fileCopies.release).toHaveBeenCalledWith('file:///caches/copy/minutes.pdf')
  })
})
