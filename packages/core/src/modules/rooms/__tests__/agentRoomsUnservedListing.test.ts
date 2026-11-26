/**
 * A room whose host is too old for the listing the agent asks it (`rooms/keys/browse` answered `unsupportedVersion`)
 * was asked again on every rooms listing and refused the same way each time: 5 times in 3 minutes on a tester's phone
 * (11-16), each a round trip on the shared agent queue. Within {@link UNSERVED_LISTING_MS}, at the same browse type, the
 * listing is answered with that same refusal and nothing is sent.
 */
import {
  AgentRoomsService,
  UNSERVED_LISTING_MS,
  type RoomsBackend,
  type RoomsCommunity,
} from '../real/agentRoomsService'
import { ROOMS_TASK } from '../real/wire'

const COMMUNITY: RoomsCommunity = { did: 'did:webvh:community:a', personaDid: 'did:key:persona-a' }
const ROOM = 'did:webvh:room:old-host'
const OTHER = 'did:webvh:room:new-host'

/** A refusal as both legs throw it (`VtiRefusal`), the task's own code in `details`. */
const refusal = (code: string) =>
  Object.assign(new Error(`refused: ${code}`), { name: 'VtiRefusal', code: 'taskFailed', details: { code } })

function setup() {
  let clock = 1_000_000
  let served: string[] = [ROOMS_TASK.keysList02, ROOMS_TASK.keysRead, ROOMS_TASK.keysBrowse04]
  /** What the agent answers a browse of each room with: a refusal, or a listing. */
  const answers = new Map<string, () => unknown>([
    [ROOM, () => Promise.reject(refusal('rooms/keys/browse:unsupportedVersion'))],
    [OTHER, () => ({ roomId: OTHER, records: [], complete: true })],
  ])
  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>): Promise<unknown> => {
    if (type === ROOMS_TASK.keysList02) return { rooms: [] }
    if (type.includes('/rooms/keys/browse/')) return answers.get(String(payload.roomId))!()
    throw new Error(`unexpected agent task ${type}`)
  })
  const b = {
    agentLinked: () => true,
    agentServedTypes: async () => served,
    agentTask,
    communities: async () => [COMMUNITY],
    communityTask: jest.fn(async () => ({
      items: [ROOM, OTHER].map((roomId) => ({
        roomId,
        host: COMMUNITY.did,
        visibility: 'open',
        actions: ['read'],
        state: 'admitted',
      })),
    })),
    sendCompleted: jest.fn(async () => ({})),
    newId: () => 'id-1',
    leaveCommunity: jest.fn(async () => undefined),
    decodeBase64Url: (s: string) => Buffer.from(s, 'base64url').toString('utf8'),
    encodeBase64Url: (s: string) => Buffer.from(s, 'utf8').toString('base64url'),
    hiddenOffers: async () => [],
    hideOffer: jest.fn(async () => undefined),
    warn: jest.fn(),
  } as unknown as RoomsBackend
  const service = new AgentRoomsService(b, undefined, { now: () => clock, sleep: async () => undefined })
  const browses = (roomId: string) =>
    agentTask.mock.calls.filter(([type, p]) => type.includes('/rooms/keys/browse/') && p.roomId === roomId).length
  return {
    service,
    answers,
    browses,
    advance: (ms: number) => (clock += ms),
    serve: (types: string[]) => (served = types),
  }
}

describe('a room listing its host refused as unsupportedVersion', () => {
  it('is answered with the same refusal again, and nothing is sent, until the while is out', async () => {
    const s = setup()
    await s.service.listMyRooms()
    const first = await s.service.listNotes(ROOM).catch((e: unknown) => e)
    expect(first).toMatchObject({ name: 'VtiRefusal' })

    s.advance(UNSERVED_LISTING_MS - 1)
    await expect(s.service.listNotes(ROOM)).rejects.toBe(first)
    expect(s.browses(ROOM)).toBe(1)

    s.advance(1)
    await expect(s.service.listNotes(ROOM)).rejects.toMatchObject({ name: 'VtiRefusal' })
    expect(s.browses(ROOM)).toBe(2)
  })

  it('control: another room on the same agent is asked every time', async () => {
    const s = setup()
    await s.service.listMyRooms()
    await s.service.listNotes(ROOM).catch(() => undefined)
    await s.service.listNotes(OTHER)
    await s.service.listNotes(OTHER)
    expect(s.browses(OTHER)).toBe(2)
  })

  it.each([
    ['another refusal', () => Promise.reject(refusal('rooms/keys/browse:permissionDenied'))],
    ['no answer', () => Promise.reject(Object.assign(new Error('timed out'), { name: 'VtiSentNoAnswer' }))],
  ])('control: %s is asked again at once', async (_name, answer) => {
    const s = setup()
    s.answers.set(ROOM, answer)
    await s.service.listMyRooms()
    await s.service.listNotes(ROOM).catch(() => undefined)
    await s.service.listNotes(ROOM).catch(() => undefined)
    expect(s.browses(ROOM)).toBe(2)
  })

  it('an agent that came to serve another browse version asks again', async () => {
    const s = setup()
    await s.service.listMyRooms()
    await s.service.listNotes(ROOM).catch(() => undefined)
    s.serve([ROOMS_TASK.keysList02, ROOMS_TASK.keysRead, ROOMS_TASK.keysBrowse03])
    await s.service.capabilities({ refresh: true })
    await s.service.listNotes(ROOM).catch(() => undefined)
    expect(s.browses(ROOM)).toBe(2)
  })
})
