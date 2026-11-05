/**
 * A room's files (F2): no task lists them, so the room is browsed and each live record opened; a record's file is its
 * sealed body's `file` (upstream `FileManifest`). Files exist on attributed and private rooms only. A file record has no
 * body, so its post shows no words and a file chip, never the sealed JSON (276's display bug).
 */
import { AgentRoomsService, type RoomsBackend, type RoomsCommunity } from '../real/agentRoomsService'
import { parseFileManifest, parseRead, ROOMS_TASK } from '../real/wire'

import { resolverOf, signBody, testAuthor } from './fixtures/signedBody'

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

const ALICE = testAuthor('did:key:alice')

/** A sealed record's body as its author's agent signed it, as `rooms/keys/read` returns it in `plaintext`. */
const sealedBody = (key: string, version: number, members: Record<string, unknown>) =>
  b64url(JSON.stringify(signBody(ALICE, { roomId: ROOM, key, version, author: ALICE.did, ...members })))

type HostRecord = { key: string; version: number; status?: string; plaintext?: string; sealedAt?: number }

function backend(
  records: HostRecord[],
  tier: 'open' | 'attributed' = 'attributed',
  resolveSender: RoomsBackend['resolveSender'] = resolverOf(ALICE).resolve
) {
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
          ...(r.sealedAt !== undefined ? { ext: { 'org.openvtc.rooms': { sealedAt: r.sealedAt } } } : {}),
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
    resolveSender,
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
      sender: 'confirmed',
      sharedBy: { did: 'did:key:alice' },
      sharedAt: '2026-10-30T09:00:00Z',
    })
    expect(String(files[0].name)).toBe('minutes<script>.pdf') // inert text, shown as written
  })

  it('a file whose record is not signed by who it names is listed as refused, naming no one', async () => {
    const unsigned = b64url(
      JSON.stringify({ roomId: ROOM, key: 'f1', version: 4, author: ALICE.did, file: manifest() })
    )
    const { b } = backend([{ ...FILE_RECORD, plaintext: unsigned }])
    const [file] = await new AgentRoomsService(b).listFiles(ROOM)
    expect(file.sender).toBe('refused')
    expect(file.sharedBy).toBeUndefined()
    expect(b.warn).toHaveBeenCalledWith(expect.stringMatching(/who shared f1 .* is refused: the body carries no proof/))
  })

  it('a file whose sharer can’t be checked is unconfirmed, naming no one', async () => {
    const { b } = backend([FILE_RECORD], 'attributed', resolverOf().resolve)
    const [file] = await new AgentRoomsService(b).listFiles(ROOM)
    expect(file).toMatchObject({ sender: 'unconfirmed', sharedAt: '2026-10-30T09:00:00Z' })
    expect(file.sharedBy).toBeUndefined()
  })

  it('a body is checked at the version the agent says it was sealed at, never past the record’s own', async () => {
    // Curated since it was sealed: the record is at 5, the body was signed at 4.
    const curated = { key: 'f1', version: 5, plaintext: sealedBody('f1', 4, { file: manifest() }) }
    const said = backend([{ ...curated, sealedAt: 4 }])
    expect((await new AgentRoomsService(said.b).listFiles(ROOM))[0].sender).toBe('confirmed')
    // Control: without the agent saying so, the body was signed for another version than it was read at.
    const unsaid = backend([curated])
    expect((await new AgentRoomsService(unsaid.b).listFiles(ROOM))[0].sender).toBe('refused')
    // An agent saying it opened past the record's own version is refused, as upstream refuses it.
    const ahead = { key: 'f1', version: 4, sealedAt: 5, plaintext: sealedBody('f1', 5, { file: manifest() }) }
    expect((await new AgentRoomsService(backend([ahead]).b).listFiles(ROOM))[0].sender).toBe('refused')
  })

  it('a record with no file is not checked, and asks for no DID document', async () => {
    const r = resolverOf(ALICE)
    const { b } = backend([NOTE_RECORD], 'attributed', r.resolve)
    await new AgentRoomsService(b).readNote(ROOM, 'n1')
    expect(r.asked).toEqual([])
  })

  it('a file post read by the chat carries the same check', async () => {
    const { b } = backend([FILE_RECORD])
    const note = await new AgentRoomsService(b).readNote(ROOM, 'f1')
    expect(note.files?.[0]).toMatchObject({ sender: 'confirmed', sharedBy: { did: ALICE.did } })
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

  it('takes the image members of trust-tasks-tf #1027, keeping them, so the file still opens', () => {
    const preview = { mediaType: 'image/webp', data: 'AAAA_-' }
    const withImage = manifest({ width: 800, height: 600, preview })
    expect(parseFileManifest(withImage)).toEqual(withImage)
  })

  it('refuses them when they do not read, as the schema does', () => {
    for (const over of [
      { width: 0 },
      { height: 1048577 },
      { width: 1.5 },
      { height: '600' },
      { preview: { mediaType: 'image/svg+xml', data: 'AAAA' } },
      { preview: { mediaType: 'image/png' } },
      { preview: { mediaType: 'image/png', data: 'not base64url!' } },
      { preview: { mediaType: 'image/png', data: 'A'.repeat(10924) } },
      { preview: { mediaType: 'image/png', data: 'AAAA', extra: 1 } },
    ])
      expect(parseFileManifest(manifest(over))).toBeUndefined()
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

describe('parseRead, what a record says it is (trust-tasks-tf #1027)', () => {
  const decode = (s: string) => Buffer.from(s, 'base64url').toString('utf8')
  const sealed = (body: Record<string, unknown>) =>
    parseRead({ key: 'k', version: 2, author: 'did:peer:host-said', plaintext: b64url(JSON.stringify(body)) }, decode)
  const members = {
    kind: 'message',
    inReplyTo: { key: 'k0', version: 1 },
    writtenAt: '2026-11-04T09:00:00Z',
    editedAt: '2026-11-04T09:05:00.5Z',
  }

  it('reads them from a sealed body and from an open room s cleartext', () => {
    expect(sealed({ body: 'Words', ...members })).toMatchObject({ body: 'Words', ...members })
    const open = parseRead({ key: 'k', version: 2, cleartext: { body: 'Words', ...members } }, decode)
    expect(open).toMatchObject({ body: 'Words', ...members })
  })

  it('drops one that does not read, alone, and the record reads on', () => {
    for (const bad of [{ kind: 'Message' }, { kind: 'a-b' }, { kind: 7 }, { kind: 'a'.repeat(65) }, { kind: '' }])
      expect(sealed({ body: 'Words', ...bad })).toMatchObject({ body: 'Words' })
    expect(sealed({ body: 'Words', kind: 'Message' })?.kind).toBeUndefined()
    expect(sealed({ body: 'Words', kind: 'a'.repeat(64) })?.kind).toBe('a'.repeat(64))
    for (const bad of [
      { version: 1 },
      { key: '' },
      { key: 7 },
      { key: 'a'.repeat(513) },
      { key: 'k0', version: 0 },
      { key: 'k0', x: 1 },
      'k0',
    ])
      expect(sealed({ body: 'Words', inReplyTo: bad })?.inReplyTo).toBeUndefined()
    expect(sealed({ body: 'Words', inReplyTo: { key: 'k0' } })?.inReplyTo).toEqual({ key: 'k0' })
    for (const bad of ['2026-11-04', '2026-11-04T09:00:00+01:00', '2026-13-45T09:00:00Z', 7]) {
      expect(sealed({ body: 'Words', writtenAt: bad })?.writtenAt).toBeUndefined()
      expect(sealed({ body: 'Words', editedAt: bad })?.editedAt).toBeUndefined()
    }
  })

  it('a record that says what it is, with no words, is no JSON to show: a withdrawn message', () => {
    const opened = sealed({ kind: 'message', writtenAt: members.writtenAt })
    expect(opened?.body).toBe('')
    expect(opened?.kind).toBe('message')
    // With nothing to say what it is, a JSON body with no `body` is shown whole, as it always was (control).
    const raw = { some: 'json' }
    expect(sealed(raw)?.body).toBe(JSON.stringify(raw))
  })

  it("today's records read as they did, with no new member", () => {
    const shapes = [
      sealed({ title: 'T', body: 'B' }),
      sealed({ body: 'B' }),
      parseRead({ key: 'k', version: 1, plaintext: b64url('not json {') }, decode),
      parseRead({ key: 'k', version: 1, status: 'retracted' }, decode),
    ]
    for (const opened of shapes)
      for (const member of Object.keys(members)) expect(Object.keys(opened!)).not.toContain(member)
    expect(shapes[0]).toMatchObject({ title: 'T', body: 'B' })
    expect(shapes[2]?.body).toBe('not json {')
  })

  it("the author is the host's, never the body's: one is not trusted until its signature is checked", () => {
    expect(sealed({ body: 'Words', author: 'did:peer:body-said' })?.author).toBe('did:peer:host-said')
    expect(
      parseRead(
        { key: 'k', version: 1, plaintext: b64url(JSON.stringify({ body: 'W', author: 'did:peer:body-said' })) },
        decode
      )?.author
    ).toBeUndefined()
  })
})
