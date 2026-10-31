/**
 * A room's files (F2): no task lists them, so the room is browsed and each live record opened; a record's file is its
 * sealed body's `file` (upstream `FileManifest`). Files exist on attributed and private rooms only. A file record has no
 * body, so its post shows no words and a file chip, never the sealed JSON (276's display bug).
 */
import { AgentRoomsService, type RoomsBackend, type RoomsCommunity } from '../real/agentRoomsService'
import { parseFileManifest, parseRead, ROOMS_TASK } from '../real/wire'

const COMMUNITY: RoomsCommunity = { did: 'did:webvh:community:a', name: 'Garden club', personaDid: 'did:key:persona-a' }
const ROOM = 'did:webvh:room:0123456789abcdef'
const HOST = 'did:webvh:community:a'
const FILE_ID = 'A'.repeat(43)

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url')

const manifest = (over: Record<string, unknown> = {}) => ({
  fileId: FILE_ID,
  name: 'minutes<script>.pdf',
  mediaType: 'application/pdf',
  size: 1234,
  digest: 'uEiDigest',
  epoch: 3,
  segmentSize: 65520,
  blobRef: 'uEiBlobRef',
  ...over,
})

/** A sealed record's signed body, as `rooms/keys/read` returns it in `plaintext`. */
const sealedBody = (key: string, version: number, members: Record<string, unknown>) =>
  b64url(
    JSON.stringify({
      roomId: ROOM,
      key,
      version,
      author: 'did:key:alice',
      ...members,
      proof: { type: 'DataIntegrityProof', proofValue: 'z123' },
    })
  )

type HostRecord = { key: string; version: number; status?: string; plaintext?: string }

function backend(records: HostRecord[], tier: 'open' | 'attributed' = 'attributed') {
  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>): Promise<unknown> => {
    switch (type) {
      case ROOMS_TASK.keysList02:
        return { rooms: [{ roomId: ROOM, epoch: 3, earliestReadableEpoch: 1, member: 'did:key:persona-a' }] }
      case ROOMS_TASK.keysBrowse:
        return {
          records: records.map(({ key, version, status }) => ({
            key,
            version,
            status: status ?? 'active',
            author: 'did:key:alice',
            updatedAt: '2026-10-30T09:00:00Z',
          })),
          complete: true,
        }
      case ROOMS_TASK.keysRead: {
        const r = records.find((x) => x.key === payload.key)
        if (!r?.plaintext) throw new Error(`no such record ${String(payload.key)}`)
        return {
          key: r.key,
          version: r.version,
          status: 'active',
          author: 'did:key:alice',
          updatedAt: '2026-10-30T09:00:00Z',
          plaintext: r.plaintext,
        }
      }
      default:
        throw new Error(`unexpected agent task ${type}`)
    }
  })
  const b: RoomsBackend = {
    agentLinked: () => true,
    agentServedTypes: async () => [ROOMS_TASK.keysList02, ROOMS_TASK.keysBrowse, ROOMS_TASK.keysRead],
    agentTask,
    communities: async () => [COMMUNITY],
    communityTask: jest.fn(async () => ({
      items: [{ roomId: ROOM, host: HOST, visibility: tier, actions: ['read'], state: 'admitted' }],
    })),
    sendCompleted: jest.fn(async () => ({})),
    newId: () => 'id-1',
    leaveCommunity: jest.fn(async () => undefined),
    decodeBase64Url: (s) => Buffer.from(s, 'base64url').toString('utf8'),
    encodeBase64Url: (s) => Buffer.from(s, 'utf8').toString('base64url'),
    hiddenOffers: async () => [],
    hideOffer: jest.fn(async () => undefined),
    warn: jest.fn(),
  } as RoomsBackend
  const reads = () => agentTask.mock.calls.filter(([type]) => type === ROOMS_TASK.keysRead).map(([, p]) => p.key)
  return { b, agentTask, reads }
}

const FILE_RECORD = { key: 'f1', version: 4, plaintext: sealedBody('f1', 4, { file: manifest() }) }
const NOTE_RECORD = { key: 'n1', version: 2, plaintext: sealedBody('n1', 2, { title: 'Agenda', body: 'Bring seeds' }) }

describe('listing a room’s files', () => {
  it('opens each live record and lists the ones that carry a file, with what their author signed', async () => {
    const { b, reads } = backend([FILE_RECORD, NOTE_RECORD, { key: 'gone', version: 5, status: 'retracted' }])
    const files = await new AgentRoomsService(b).listFiles(ROOM)
    expect(reads()).toEqual(['f1', 'n1']) // the retracted record has no body to open
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({
      fileId: FILE_ID,
      mediaType: 'application/pdf',
      size: 1234,
      sharedBy: { did: 'did:key:alice' },
      sharedAt: '2026-10-30T09:00:00Z',
    })
    expect(String(files[0].name)).toBe('minutes<script>.pdf') // inert text, shown as written
  })

  it('a second look opens only what changed: a record is opened again only at a new version', async () => {
    const records = [FILE_RECORD, NOTE_RECORD]
    const { b, reads } = backend(records)
    const service = new AgentRoomsService(b)
    await service.listFiles(ROOM)
    await service.listFiles(ROOM)
    expect(reads()).toEqual(['f1', 'n1'])
    records[1] = { ...NOTE_RECORD, version: 3, plaintext: sealedBody('n1', 3, { body: 'Bring more seeds' }) }
    await service.listFiles(ROOM)
    expect(reads()).toEqual(['f1', 'n1', 'n1'])
  })

  it('a record the chat already opened is not opened again for the files', async () => {
    const { b, reads } = backend([FILE_RECORD])
    const service = new AgentRoomsService(b)
    await service.readNote(ROOM, 'f1')
    await service.listFiles(ROOM)
    expect(reads()).toEqual(['f1'])
  })

  it('a record that can’t be opened is left out; if none could be, that is the answer, not "no files"', async () => {
    const one = backend([FILE_RECORD, { key: 'broken', version: 1 }])
    expect(await new AgentRoomsService(one.b).listFiles(ROOM)).toHaveLength(1)
    const none = backend([{ key: 'broken', version: 1 }])
    await expect(new AgentRoomsService(none.b).listFiles(ROOM)).rejects.toThrow('no such record broken')
  })

  it('an open room has no files: listing is refused with that reason, never asked of the agent', async () => {
    const { b, reads } = backend([FILE_RECORD], 'open')
    const service = new AgentRoomsService(b)
    const statuses = await service.roomCapabilities(ROOM)
    expect(statuses.listFiles).toMatchObject({ status: 'unavailable', reason: 'notOnThisTier' })
    expect(statuses.openFile).toMatchObject({ status: 'unavailable', reason: 'notOnThisTier' })
    await expect(service.listFiles(ROOM)).rejects.toMatchObject({ reason: 'notOnThisTier' })
    expect(reads()).toEqual([])
  })

  it('an attributed room’s files are listed', async () => {
    const statuses = await new AgentRoomsService(backend([]).b).roomCapabilities(ROOM)
    expect(statuses.listFiles.status).toBe('available')
  })
})

describe('a file record in the chat', () => {
  it('shows no words and the file as a chip, never the sealed JSON', async () => {
    const note = await new AgentRoomsService(backend([FILE_RECORD]).b).readNote(ROOM, 'f1')
    expect(String(note.body)).toBe('')
    expect(note.files?.map((f) => f.fileId)).toEqual([FILE_ID])
  })

  it('a sealed note still shows its title and words, and carries no file', async () => {
    const note = await new AgentRoomsService(backend([NOTE_RECORD]).b).readNote(ROOM, 'n1')
    expect(String(note.title)).toBe('Agenda')
    expect(String(note.body)).toBe('Bring seeds')
    expect(note.files).toBeUndefined()
  })
})

describe('parseFileManifest', () => {
  it('takes upstream’s manifest, with padding and without a media type', () => {
    expect(parseFileManifest(manifest())).toEqual(manifest())
    const { mediaType: _m, ...bare } = manifest({ padding: 'padme' })
    expect(parseFileManifest(bare)).toEqual(bare)
  })

  it('refuses what upstream refuses: an unknown member, a fileId that is not 32 bytes, a padding it does not name', () => {
    expect(parseFileManifest(manifest({ extra: 1 }))).toBeUndefined()
    expect(parseFileManifest(manifest({ fileId: 'short' }))).toBeUndefined()
    expect(parseFileManifest(manifest({ padding: 'zeros' }))).toBeUndefined()
    expect(parseFileManifest(manifest({ size: -1 }))).toBeUndefined()
    expect(parseFileManifest({ ...manifest(), blobRef: undefined })).toBeUndefined()
  })

  it('a body whose file is not a manifest is shown whole, as any unknown JSON', () => {
    const raw = JSON.stringify({ file: { name: 'x' } })
    const opened = parseRead({ key: 'k', version: 1, plaintext: b64url(raw) }, (s) =>
      Buffer.from(s, 'base64url').toString('utf8')
    )
    expect(opened?.body).toBe(raw)
    expect(opened?.file).toBeUndefined()
  })
})
