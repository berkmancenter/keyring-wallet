/**
 * The host's own times and first writer on a record (browse 0.4, read 0.2: `createdAt`, `createdBy`, `bodyStoredAt`)
 * reach the notes the screens order and count by, exactly as served, and only where they are the type they must be.
 */
import { AgentRoomsService, type RoomsBackend, type RoomsCommunity } from '../real/agentRoomsService'
import { parseBrowse, parseRead, parseReadBatch, ROOMS_TASK } from '../real/wire'

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const decode = (s: string) => Buffer.from(s, 'base64url').toString('utf8')
const TIMES = {
  createdAt: '2026-10-20T09:14:02Z',
  createdBy: 'did:webvh:example.com:people:alice',
  bodyStoredAt: '2026-11-10T08:00:00Z',
}
const row = (over: Record<string, unknown> = {}) => ({ key: 'k1', version: 4, status: 'active', ...over })
const record = (over: Record<string, unknown> = {}) => ({
  ...row(over),
  plaintext: b64url(JSON.stringify({ body: 'hello' })),
  verification: { priorRoots: 'noneHeld', anchor: 'none' },
})

describe('the parsers', () => {
  test('a listing row carries them as served', () => {
    expect(parseBrowse({ records: [row(TIMES)] }).records[0]).toMatchObject(TIMES)
  })

  test('a single read and a batch entry carry them as served', () => {
    expect(parseRead(record(TIMES), decode)).toMatchObject(TIMES)
    expect(parseReadBatch({ results: [record(TIMES)] }, decode)?.get('k1')).toMatchObject(TIMES)
  })

  test('an agent that predates them: none of them, and nothing else changes (control)', () => {
    const r = parseBrowse({ records: [row()] }).records[0]
    expect(r).not.toHaveProperty('createdAt')
    expect(r).not.toHaveProperty('createdBy')
    expect(r).not.toHaveProperty('bodyStoredAt')
    expect(r).toMatchObject({ key: 'k1', version: 4, status: 'active' })
  })

  test('a createdBy that is not a DID, or a time that is not a string, is left out', () => {
    const r = parseBrowse({ records: [row({ createdBy: 'alice', createdAt: 1730000000, bodyStoredAt: '' })] })
      .records[0]
    expect(r).not.toHaveProperty('createdBy')
    expect(r).not.toHaveProperty('createdAt')
    expect(r).not.toHaveProperty('bodyStoredAt')
  })
})

describe('the service', () => {
  const COMMUNITY: RoomsCommunity = {
    did: 'did:webvh:community:a',
    name: 'Garden club',
    personaDid: 'did:key:persona-a',
  }
  const ROOM = 'did:webvh:room:0123456789abcdef'
  const backend = (): RoomsBackend => ({
    agentLinked: () => true,
    agentServedTypes: async () => [ROOMS_TASK.keysList02, ROOMS_TASK.keysBrowse, ROOMS_TASK.keysRead],
    agentTask: jest.fn(async (type: string) => {
      if (type === ROOMS_TASK.keysList02)
        return { rooms: [{ roomId: ROOM, epoch: 3, earliestReadableEpoch: 1, member: COMMUNITY.personaDid }] }
      if (type === ROOMS_TASK.keysBrowse)
        return { records: [row(TIMES)], complete: true, verification: { priorRoots: 'noneHeld', anchor: 'none' } }
      if (type === ROOMS_TASK.keysRead) return record(TIMES)
      throw new Error(`unexpected ${type}`)
    }),
    communities: async () => [COMMUNITY],
    communityTask: jest.fn(async () => ({
      items: [
        {
          roomId: ROOM,
          host: COMMUNITY.did,
          label: 'Seed swap',
          visibility: 'attributed',
          actions: ['read'],
          state: 'admitted',
        },
      ],
    })),
    sendCompleted: jest.fn(async () => ({})),
    newId: () => 'id-1',
    leaveCommunity: jest.fn(async () => undefined),
    decodeBase64Url: decode,
    encodeBase64Url: b64url,
    hiddenOffers: async () => [],
    hideOffer: jest.fn(async () => undefined),
    warn: jest.fn(),
  })
  const expected = { createdAt: TIMES.createdAt, createdBy: { did: TIMES.createdBy }, bodyStoredAt: TIMES.bodyStoredAt }

  test("a listing's notes and a read note carry them, the writer as an identity", async () => {
    const service = new AgentRoomsService(backend())
    const list = await service.listNotes(ROOM)
    expect(list.notes[0]).toMatchObject(expected)
    expect(await service.readNote(ROOM, 'k1')).toMatchObject(expected)
  })
})
