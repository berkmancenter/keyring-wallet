import { AgentRoomsService, type RoomsBackend, type RoomsCommunity } from '../real/agentRoomsService'
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
    leaveCommunity: jest.fn(async () => undefined),
    decodeBase64Url: (s) => Buffer.from(s, 'base64url').toString('utf8'),
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
    expect(rooms.find((r) => r.roomId === CUSTODY_ROOM)).toMatchObject({ nameFrom: 'roomId', source: 'custody' })
  })

  it('keeps the other rooms when one community cannot answer', async () => {
    const { b } = backend({
      communityTask: jest.fn(async () => {
        throw new Error('community unreachable')
      }),
    })
    const rooms = await new AgentRoomsService(b).listMyRooms()
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
    expect(caps.write).toMatchObject({ status: 'comingSoon', reason: 'clientNotBuilt' })
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
    const err = await service.prepareWrite().catch((e) => e)
    expect(err).toBeInstanceOf(RoomsUnavailable)
    expect(err).toMatchObject({ reason: 'clientNotBuilt' })
    await expect(service.listOffers()).rejects.toMatchObject({ reason: 'clientNotBuilt' })
    expect(agentTask).not.toHaveBeenCalled()
  })
})
