import {
  AgentRoomsService,
  SERVED_UNKNOWN_RETRY_MS,
  type RoomsBackend,
  type RoomsCommunity,
} from '../real/agentRoomsService'
import { ROOMS_TASK } from '../real/wire'
import { RoomsUnavailable } from '../types'

const SPEC = 'https://trusttasks.org/spec/'
const COMMUNITY: RoomsCommunity = { did: 'did:webvh:community:a', name: 'Garden club', personaDid: 'did:key:persona-a' }
const ROOM = 'did:webvh:room:0123456789abcdef'
const CUSTODY_ROOM = 'did:webvh:room:custodyonly42'
const HOST = 'did:webvh:community:a'

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url')

function backend(overrides: Partial<RoomsBackend> = {}) {
  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>): Promise<unknown> => {
    switch (type) {
      case ROOMS_TASK.keysList02:
        return {
          rooms: [
            { roomId: ROOM, epoch: 3, earliestReadableEpoch: 1, member: 'did:key:persona-a' },
            {
              roomId: CUSTODY_ROOM,
              epoch: 1,
              earliestReadableEpoch: 1,
              member: 'did:key:persona-a',
              personal: { label: 'My old room' },
            },
          ],
        }
      case ROOMS_TASK.keysBrowse:
        return {
          records: [
            { key: 'n1', version: 2, status: 'active', title: 'Agenda', author: 'did:key:x', updatedAt: '2026-10-01' },
            { key: 'bad' }, // no version: dropped
          ],
          complete: true,
          verification: { priorRoots: 'agree', anchor: 'agrees', trace: 'verified', count: 'agrees' },
        }
      case ROOMS_TASK.keysRead:
        return {
          key: payload.key,
          version: 2,
          status: 'active',
          plaintext: b64url(JSON.stringify({ title: 'Agenda', body: 'Bring <b>seeds</b>' })),
          verification: { priorRoots: 'noneHeld', anchor: 'none' },
        }
      default:
        throw new Error(`unexpected agent task ${type}`)
    }
  })
  const communityTask = jest.fn(
    async (_did: string, type: string, payload: Record<string, unknown>): Promise<unknown> => {
      if (type !== ROOMS_TASK.membershipsList) throw new Error(`unexpected community task ${type}`)
      if (!payload.cursor)
        return {
          items: [
            {
              roomId: ROOM,
              host: HOST,
              label: 'Seed swap',
              visibility: 'attributed',
              actions: ['read', 'write', 'fly'],
              state: 'admitted',
            },
          ],
          nextCursor: 'page2',
        }
      return {
        items: [
          { roomId: 'did:webvh:room:offered', host: HOST, visibility: 'open', actions: ['read'], state: 'offered' },
        ],
      }
    }
  )
  const b: RoomsBackend = {
    agentLinked: () => true,
    agentServedTypes: async () => [
      ROOMS_TASK.keysList02,
      ROOMS_TASK.keysList01,
      ROOMS_TASK.keysBrowse,
      ROOMS_TASK.keysRead,
    ],
    agentTask,
    communities: async () => [COMMUNITY],
    communityTask,
    sendCompleted: jest.fn(async () => ({})),
    newId: () => 'id-1',
    leaveCommunity: jest.fn(async () => undefined),
    decodeBase64Url: (s) => Buffer.from(s, 'base64url').toString('utf8'),
    encodeBase64Url: (text) => Buffer.from(text, 'utf8').toString('base64url'),
    hiddenOffers: async () => [],
    hideOffer: jest.fn(async () => undefined),
    warn: jest.fn(),
    ...overrides,
  }
  return { b, agentTask, communityTask }
}

describe('AgentRoomsService', () => {
  it('joins the community’s record with the agent’s custody', async () => {
    const { b, agentTask, communityTask } = backend()
    const rooms = await new AgentRoomsService(b).listMyRooms()

    expect(communityTask).toHaveBeenCalledTimes(2) // followed the cursor
    expect(agentTask).toHaveBeenCalledWith(ROOMS_TASK.keysList02, { includePersonal: true })
    expect(rooms.map((r) => r.roomId)).toEqual([ROOM, CUSTODY_ROOM]) // the offer is not a room yet

    const [community, custody] = rooms
    expect(community).toMatchObject({
      source: 'community',
      nameFrom: 'community',
      communityDid: COMMUNITY.did,
      tier: 'attributed',
      verbs: ['read', 'write'], // an unknown verb is dropped
      host: HOST,
      standing: 'member',
    })
    expect(String(community.name)).toBe('Seed swap')
    expect(custody).toMatchObject({ source: 'custody', nameFrom: 'personal', tier: 'unknown' })
    expect(custody.verbs).toBeUndefined()
    expect(custody).not.toHaveProperty('host')
  })

  it('asks keys/list 0.1 when the agent does not serve 0.2', async () => {
    const { b, agentTask } = backend({ agentServedTypes: async () => [ROOMS_TASK.keysList01] })
    agentTask.mockImplementation(async () => ({
      rooms: [{ roomId: CUSTODY_ROOM, epoch: 1, earliestReadableEpoch: 1 }],
    }))
    const rooms = await new AgentRoomsService(b).listMyRooms()
    expect(agentTask).toHaveBeenCalledWith(ROOMS_TASK.keysList01, {})
    const custody = rooms.find((r) => r.roomId === CUSTODY_ROOM)
    expect(custody).toMatchObject({ nameFrom: 'roomId', source: 'custody' })
    // What tells it apart (roomRef): this ID has no path, so the end of its SCID, said to be cut; never its last 10.
    expect(String(custody?.name)).toBe('…room')
  })

  it('keeps the other rooms when one community cannot answer, and logs why it did not', async () => {
    const other: RoomsCommunity = { did: 'did:webvh:community:b', name: 'Choir', personaDid: 'did:key:persona-b' }
    const { b, communityTask } = backend({ communities: async () => [COMMUNITY, other] })
    const answer = communityTask.getMockImplementation()
    communityTask.mockImplementation(async (did, type, payload) => {
      if (did === other.did) throw new Error('community unreachable')
      return answer?.(did, type, payload)
    })
    const rooms = await new AgentRoomsService(b).listMyRooms()
    expect(rooms.map((r) => [r.roomId, r.source])).toEqual([
      [ROOM, 'community'],
      [CUSTODY_ROOM, 'custody'],
    ])
    expect(b.warn).toHaveBeenCalledTimes(1)
    expect(b.warn).toHaveBeenCalledWith(`rooms: ${other.did} did not list this member's rooms: community unreachable`)
  })

  // A member whose community session could not open (an identity brought back from the agent, before its keys
  // were borrowed: 10-28) saw one sealed room by its id and no open room at all, and nothing said why.
  it('fails, saying no community was reached, when none answers, and logs each reason', async () => {
    const { b } = backend({
      communityTask: jest.fn(async () => {
        throw new Error('vtiAgent: the persona has no borrowed key-agreement key')
      }),
    })
    await expect(new AgentRoomsService(b).listMyRooms()).rejects.toMatchObject({
      name: 'RoomsUnavailable',
      operation: 'listMyRooms',
      reason: 'communityUnreachable',
    })
    expect(b.warn).toHaveBeenCalledWith(
      `rooms: ${COMMUNITY.did} did not list this member's rooms: vtiAgent: the persona has no borrowed key-agreement key`
    )
  })

  it('a phone in no community still lists the rooms its agent holds keys for', async () => {
    const { b, communityTask } = backend({ communities: async () => [] })
    const rooms = await new AgentRoomsService(b).listMyRooms()
    expect(communityTask).not.toHaveBeenCalled()
    expect(rooms.map((r) => [r.roomId, r.source])).toEqual([
      [ROOM, 'custody'],
      [CUSTODY_ROOM, 'custody'],
    ])
  })

  it('lists and opens notes through the agent, naming the host from the membership', async () => {
    const { b, agentTask } = backend()
    const service = new AgentRoomsService(b)

    const list = await service.listNotes(ROOM)
    expect(agentTask).toHaveBeenCalledWith(ROOMS_TASK.keysBrowse, { roomId: ROOM, host: HOST })
    expect(list.notes.map((n) => n.key)).toEqual(['n1'])
    expect(list.check.verdict).toBe('consistent')

    const note = await service.readNote(ROOM, 'n1')
    expect(agentTask).toHaveBeenCalledWith(ROOMS_TASK.keysRead, { roomId: ROOM, host: HOST, key: 'n1' })
    expect(String(note.title)).toBe('Agenda')
    expect(String(note.body)).toBe('Bring <b>seeds</b>') // inert: kept as text, never interpreted
    expect(note.check.verdict).toBe('unverified')
  })

  it('refuses notes in a custody-only room, and where the member lacks the right', async () => {
    const { b, communityTask } = backend()
    communityTask.mockImplementation(async () => ({
      items: [{ roomId: ROOM, host: HOST, visibility: 'private', actions: ['write'], state: 'admitted' }],
    }))
    const service = new AgentRoomsService(b)
    await expect(service.listNotes(CUSTODY_ROOM)).rejects.toMatchObject({ reason: 'detailsNotLoaded' })
    await expect(service.readNote(ROOM, 'n1')).rejects.toMatchObject({ reason: 'noRight' })
  })

  it('reports per-room capabilities from the membership', async () => {
    const { b } = backend()
    const service = new AgentRoomsService(b)
    const caps = await service.roomCapabilities(ROOM)
    expect(caps.listNotes).toMatchObject({ status: 'available' })
    // Built, but this agent cannot complete a write as the member (no rooms/keys/act).
    expect(caps.write).toMatchObject({ status: 'unavailable', reason: 'agentDoesNotServe' })
    expect((await service.roomCapabilities(CUSTODY_ROOM)).readNote.reason).toBe('detailsNotLoaded')
  })

  it('marks a removed membership with no rights', async () => {
    const { b, communityTask } = backend()
    communityTask.mockImplementation(async () => ({
      items: [{ roomId: ROOM, host: HOST, visibility: 'open', actions: ['read'], state: 'removed' }],
    }))
    const room = await new AgentRoomsService(b).getRoom(ROOM)
    expect(room).toMatchObject({ standing: 'removed', verbs: [] })
    expect(room.actingAs.did).toBe(COMMUNITY.personaDid)
  })

  it('without discovery, says so instead of sending anything', async () => {
    const { b, agentTask, communityTask } = backend({ agentServedTypes: async () => undefined })
    await expect(new AgentRoomsService(b).listMyRooms()).rejects.toMatchObject({ reason: 'agentUnknown' })
    expect(agentTask).not.toHaveBeenCalled()
    expect(communityTask).not.toHaveBeenCalled()
  })

  it('asks an agent that could not say what it serves again after a while, and keeps an answer it gave', async () => {
    // Lost while the session reopened after an unlock, the answer was kept: every room said "Couldn't reach your
    // agent" until a pull to refresh (#772, 10-30).
    let now = 0
    let answer: string[] | undefined = undefined
    const agentServedTypes = jest.fn(async () => answer)
    const { b } = backend({ agentServedTypes })
    const service = new AgentRoomsService(b, undefined, { now: () => now })
    await expect(service.listMyRooms()).rejects.toMatchObject({ reason: 'agentUnknown' })

    // The agent could answer now, but within the wait it is not asked again (control: not on every call).
    answer = [ROOMS_TASK.keysList02]
    now = SERVED_UNKNOWN_RETRY_MS - 1
    await expect(service.listMyRooms()).rejects.toMatchObject({ reason: 'agentUnknown' })
    expect(agentServedTypes).toHaveBeenCalledTimes(1)

    now = SERVED_UNKNOWN_RETRY_MS
    await expect(service.listMyRooms()).resolves.toHaveLength(2)
    expect(agentServedTypes).toHaveBeenCalledTimes(2)

    // An answer it gave is kept (control).
    now = 10 * SERVED_UNKNOWN_RETRY_MS
    await service.listMyRooms()
    expect(agentServedTypes).toHaveBeenCalledTimes(2)
  })

  it('keeps an empty answer: an agent that serves none of it is not asked again', async () => {
    let now = 0
    const agentServedTypes = jest.fn(async (): Promise<string[] | undefined> => [])
    const { b } = backend({ agentServedTypes })
    const service = new AgentRoomsService(b, undefined, { now: () => now })
    await expect(service.listMyRooms()).rejects.toMatchObject({ reason: 'agentDoesNotServe' })
    now = 10 * SERVED_UNKNOWN_RETRY_MS
    await expect(service.listMyRooms()).rejects.toMatchObject({ reason: 'agentDoesNotServe' })
    expect(agentServedTypes).toHaveBeenCalledTimes(1)
  })

  it('asks once while an ask is out: every caller waits for the same answer', async () => {
    let answer: (types: string[] | undefined) => void = () => undefined
    const agentServedTypes = jest.fn(() => new Promise<string[] | undefined>((resolve) => (answer = resolve)))
    const { b } = backend({ agentServedTypes })
    const service = new AgentRoomsService(b)
    // Callers that need an answer, not a fresh one (a refresh starts its own: below).
    const asks = [service.capabilities(), service.capabilities(), service.capabilities()]
    expect(agentServedTypes).toHaveBeenCalledTimes(1)
    answer([ROOMS_TASK.keysList02])
    const answers = await Promise.all(asks)
    expect(answers.map((c) => c.listMyRooms.status)).toEqual(['available', 'available', 'available'])
    // Once it has answered, a refresh asks again (control: the sharing ends with the ask).
    agentServedTypes.mockImplementation(async () => [ROOMS_TASK.keysList02])
    await service.capabilities({ refresh: true })
    expect(agentServedTypes).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['the earlier ask answers first', ['A', 'B']],
    ['the earlier ask answers last', ['B', 'A']],
  ])(
    "a refresh asks afresh, not joining an ask already out, and keeps the latest ask's answer (%s)",
    async (_, order) => {
      // An ask sent while A was linked, then the agent switched to B and a refresh asked for B's services: A's answer
      // must not be kept as B's (it never aged out: A serves something).
      const answers: Record<string, (types: string[]) => void> = {}
      const agentServedTypes = jest
        .fn<Promise<string[] | undefined>, []>()
        .mockImplementationOnce(() => new Promise((resolve) => (answers.A = resolve)))
        .mockImplementationOnce(() => new Promise((resolve) => (answers.B = resolve)))
      const { b } = backend({ agentServedTypes })
      const service = new AgentRoomsService(b)
      const before = service.capabilities()
      const refreshed = service.capabilities({ refresh: true })
      expect(agentServedTypes).toHaveBeenCalledTimes(2)
      const served = { A: [ROOMS_TASK.keysList02], B: [ROOMS_TASK.keysBrowse] }
      for (const agent of order) answers[agent](served[agent as 'A' | 'B'])
      await Promise.all([before, refreshed])
      // B serves no key list: listing rooms is not available, as B said.
      const now = await service.capabilities()
      expect(now.listMyRooms.reason).toBe('agentDoesNotServe')
      expect(now.listNotes.reason).toBe('ok')
    }
  )

  it('leaves through the community and forgets its rooms', async () => {
    const { b } = backend()
    const service = new AgentRoomsService(b)
    await service.listMyRooms()
    await service.leaveViaCommunity(COMMUNITY.did)
    expect(b.leaveCommunity).toHaveBeenCalledWith(COMMUNITY.did)
  })

  it('reports later phases as not built, without sending anything', async () => {
    const { b, agentTask } = backend({
      agentServedTypes: async () => [ROOMS_TASK.keysList02, `${SPEC}rooms/keys/act/0.6`],
    })
    const service = new AgentRoomsService(b)
    const err = await service.openFile().catch((e) => e)
    expect(err).toBeInstanceOf(RoomsUnavailable)
    expect(err).toMatchObject({ reason: 'clientNotBuilt' })
    expect(agentTask).not.toHaveBeenCalled()
  })
})

// Screens that list rooms read again on focus, together; the agent client sends one task at a time, so each copy
// of the key list queued behind the last (five in 4.5 s in a tester's run, 10-29).
describe('the agent’s key list, read by several screens at once', () => {
  const keyListAsks = (agentTask: jest.Mock) => agentTask.mock.calls.filter(([type]) => type === ROOMS_TASK.keysList02)

  it('is asked once while one read is in flight, and both callers get the rooms', async () => {
    const { b, agentTask } = backend()
    const answer = agentTask.getMockImplementation()!
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    agentTask.mockImplementation(async (type: string, payload: Record<string, unknown>) => {
      if (type === ROOMS_TASK.keysList02) await held
      return answer(type, payload)
    })
    const service = new AgentRoomsService(b)

    const both = Promise.all([service.listMyRooms(), service.listMyRooms()])
    // Both lists reach the key list before it answers.
    await new Promise((resolve) => setTimeout(resolve, 0))
    release()
    const [first, second] = await both

    expect(keyListAsks(agentTask)).toHaveLength(1)
    expect(first.map((r) => r.roomId)).toEqual([ROOM, CUSTODY_ROOM])
    expect(second.map((r) => r.roomId)).toEqual([ROOM, CUSTODY_ROOM])
  })

  it('is asked again by a read that starts after the last one answered (control: nothing is kept)', async () => {
    const { b, agentTask } = backend()
    const service = new AgentRoomsService(b)
    await service.listMyRooms()
    await service.listMyRooms()
    expect(keyListAsks(agentTask)).toHaveLength(2)
  })

  it('is asked again after a read that failed', async () => {
    const { b, agentTask } = backend()
    const answer = agentTask.getMockImplementation()!
    agentTask.mockImplementationOnce(async () => {
      throw new Error('no answer')
    })
    agentTask.mockImplementation(answer)
    const service = new AgentRoomsService(b)
    await expect(service.listMyRooms()).rejects.toThrow('no answer')
    expect((await service.listMyRooms()).map((r) => r.roomId)).toEqual([ROOM, CUSTODY_ROOM])
    expect(keyListAsks(agentTask)).toHaveLength(2)
  })
})
