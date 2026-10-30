/**
 * After an auto-lock and the PIN, Room details and a room's notes said "Couldn't reach your agent" and never
 * recovered, Try again included, while the agent heard nothing from the phone (276.10). The unlock restarts the same
 * agent, and the app registered a new rooms service for it that knew no room: these screens then had to list the
 * member's rooms through the community, whose connection was down across the unlock, before asking the agent.
 */
import { container } from 'tsyringe'

import { TOKENS } from '../../../container-api'
import { AgentRoomsService, type RoomsBackend } from '../real/agentRoomsService'
import { ROOMS_TASK } from '../real/wire'
import { registerRoomsService } from '../register'
import type { RoomsService } from '../types'

const ROOM = 'did:webvh:room:seedswap'
const HOST = 'did:webvh:community:a'

/** A backend on `runsOn` whose community answers until `communityDown` is set, as across an unlock. */
function backend(runsOn?: object) {
  const state = { communityDown: false }
  const agentTask = jest.fn(async (type: string): Promise<unknown> => {
    if (type === ROOMS_TASK.keysList02)
      return { rooms: [{ roomId: ROOM, epoch: 1, earliestReadableEpoch: 1, member: 'did:key:persona-a' }] }
    throw new Error(`unexpected agent task ${type}`)
  })
  const communityTask = jest.fn(async (): Promise<unknown> => {
    if (state.communityDown) throw new Error('socket closed while the message was packed')
    return {
      items: [
        { roomId: ROOM, host: HOST, label: 'Seed swap', visibility: 'open', actions: ['read'], state: 'admitted' },
      ],
    }
  })
  const b: RoomsBackend = {
    runsOn,
    agentLinked: () => true,
    agentServedTypes: async () => [ROOMS_TASK.keysList02],
    agentTask,
    communities: async () => [{ did: HOST, personaDid: 'did:key:persona-a' }],
    communityTask,
    sendCompleted: async () => ({}),
    newId: () => 'id-1',
    leaveCommunity: async () => undefined,
    decodeBase64Url: (s) => s,
    encodeBase64Url: (s) => s,
    hiddenOffers: async () => [],
    hideOffer: async () => undefined,
    warn: jest.fn(),
  }
  return { b, state, agentTask, communityTask }
}

const resolve = (c: typeof container) => c.resolve<RoomsService | undefined>(TOKENS.UTIL_ROOMS_SERVICE)

describe('registerRoomsService after an unlock', () => {
  test('a service built on the agent already registered is not swapped in', () => {
    const c = container.createChildContainer()
    const agent = {}
    const first = new AgentRoomsService(backend(agent).b)
    registerRoomsService(c, first)
    registerRoomsService(c, new AgentRoomsService(backend(agent).b))

    expect(resolve(c)).toBe(first)
  })

  test('a room read before the lock still opens while the community is not answering', async () => {
    const c = container.createChildContainer()
    const agent = {}
    const before = backend(agent)
    registerRoomsService(c, new AgentRoomsService(before.b))
    await resolve(c)?.listMyRooms()

    before.state.communityDown = true
    const after = backend(agent)
    after.state.communityDown = true
    registerRoomsService(c, new AgentRoomsService(after.b)) // the unlock's restart of the same agent
    const room = await resolve(c)?.getRoom(ROOM)

    expect(room?.roomId).toBe(ROOM)
    expect(after.communityTask).not.toHaveBeenCalled()
  })

  test('a service on another agent replaces it, and must list through the community first (control)', async () => {
    const c = container.createChildContainer()
    const before = backend({})
    registerRoomsService(c, new AgentRoomsService(before.b))
    await resolve(c)?.listMyRooms()

    const after = backend({})
    after.state.communityDown = true
    const replacement = new AgentRoomsService(after.b)
    registerRoomsService(c, replacement)

    expect(resolve(c)).toBe(replacement)
    await expect(resolve(c)?.getRoom(ROOM)).rejects.toThrow()
    expect(after.agentTask).not.toHaveBeenCalled() // failed before the agent was asked, as on the simulator
  })

  test('a service that names no agent (the sample) always replaces what is there', () => {
    const c = container.createChildContainer()
    registerRoomsService(c, new AgentRoomsService(backend().b))
    const second = new AgentRoomsService(backend().b)
    registerRoomsService(c, second)

    expect(resolve(c)).toBe(second)
  })
})
