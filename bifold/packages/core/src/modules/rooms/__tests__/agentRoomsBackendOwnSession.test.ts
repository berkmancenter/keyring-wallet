/**
 * Which session a rooms ask goes out on (sessions phase B, rooms-slow §8b): the identity's own, where the release
 * switch is on and that session is open, else the shared session as today. A session found closed before anything
 * was sent falls back; any other failure is the ask's own and is never sent again the shared way.
 */
const mockHolding = jest.fn(async (..._a: unknown[]) => 'shared')
const mockOwnOpen = jest.fn((_did: string) => true)
const mockTaskAs = jest.fn(async (..._a: unknown[]): Promise<unknown> => 'own')
const mockCompletedAs = jest.fn(async (..._a: unknown[]): Promise<unknown> => 'own')
let mockPersona: Record<string, unknown> | undefined
jest.mock('../../trust-tasks/module/VtiIdentityStore', () => ({
  GenericRecordsIdentityStore: class {
    async getPersona() {
      return mockPersona
    }
    async listPersonas() {
      return mockPersona ? [mockPersona] : []
    }
    async setPersona() {
      return undefined
    }
  },
}))
jest.mock('../../trust-tasks/module/VtiCommunityStore', () => ({
  ...jest.requireActual('../../trust-tasks/module/VtiCommunityStore'),
  GenericRecordsCommunityStore: class {
    async listMemberships() {
      return []
    }
  },
}))
jest.mock('../../trust-tasks/module/vtiJoin', () => ({ leaveCommunity: jest.fn() }))
jest.mock('../../trust-tasks/module/vtiVetting', () => ({ GenericRecordsVettingStore: class {} }))
jest.mock('../../trust-tasks/module/vtiAgent', () => {
  class VtiNoOwnSession extends Error {
    constructor() {
      super('not open')
      this.name = 'VtiNoOwnSession'
    }
  }
  return {
    VtiNoOwnSession,
    vtiAgent: {
      holding: (...a: unknown[]) => mockHolding(...a),
      communityTask: jest.fn(),
      sendCompleted: jest.fn(),
      ownSessionOpen: (did: string) => mockOwnOpen(did),
      communityTaskAs: (...a: unknown[]) => mockTaskAs(...a),
      sendCompletedAs: (...a: unknown[]) => mockCompletedAs(...a),
    },
  }
})
jest.mock('../../trust-tasks/module/vtaAgent', () => ({ vtaAgent: {} }))
jest.mock('../../trust-tasks/module/vtiTsp', () => ({ GenericRecordsTspPeerRevisionStore: class {} }))

import { SESSIONS_PER_IDENTITY } from '../../trust-tasks/module/sessionsPerIdentitySwitch'
import { VtiNoOwnSession } from '../../trust-tasks/module/vtiAgent'
import { createAgentRoomsBackend } from '../real/agentRoomsBackend'

const agent = { config: { logger: { warn: jest.fn(), info: jest.fn() } } } as never
const COMMUNITY = 'did:webvh:c:test-vtc'
const HOST = 'did:webvh:h:host'
const LIST = 'https://trusttasks.org/spec/vtc/rooms/memberships/list/0.1'
const PUT = { type: 'https://trusttasks.org/spec/rooms/records/put/0.3', payload: { key: 'k' } }

const listing = () => createAgentRoomsBackend(agent).communityTask(COMMUNITY, LIST, {})
const write = () => createAgentRoomsBackend(agent).sendCompleted?.(COMMUNITY, HOST, PUT)

beforeEach(() => {
  for (const m of [mockHolding, mockOwnOpen, mockTaskAs, mockCompletedAs]) m.mockClear()
  mockOwnOpen.mockImplementation(() => true)
  mockTaskAs.mockImplementation(async () => 'own')
  mockCompletedAs.mockImplementation(async () => 'own')
  mockPersona = {
    did: 'did:webvh:p:airport',
    communityDid: COMMUNITY,
    vtaDid: 'did:webvh:a:agent',
    vtaKeyIds: { signing: 's', keyAgreement: 'k' },
    kmsKeyIds: { keyAgreement: 'vta-copy:k', signing: 'vta-copy:s' },
  }
  Object.assign(SESSIONS_PER_IDENTITY, { on: true, remoteOff: false })
})
// Put back what the release ships, whatever that is, not a value assumed here.
const SHIPPED = { ...SESSIONS_PER_IDENTITY }
afterAll(() => Object.assign(SESSIONS_PER_IDENTITY, SHIPPED))

describe('the rooms backend, with its identity’s own session open', () => {
  it('lists over that session, as the identity, with no hold of the shared session', async () => {
    await expect(listing()).resolves.toBe('own')
    expect(mockTaskAs).toHaveBeenCalledWith(mockPersona, COMMUNITY, LIST, {})
    expect(mockHolding).not.toHaveBeenCalled()
  })

  it('sends a completed record over it too', async () => {
    await expect(write()).resolves.toBe('own')
    expect(mockCompletedAs).toHaveBeenCalledWith(mockPersona, HOST, PUT)
    expect(mockHolding).not.toHaveBeenCalled()
  })

  it('asks the shared way when the session turns out closed before anything was sent', async () => {
    mockTaskAs.mockImplementation(async () => {
      throw new (VtiNoOwnSession as unknown as new () => Error)()
    })
    await expect(listing()).resolves.toBe('shared')
    expect(mockHolding).toHaveBeenCalledTimes(1)
  })

  it('never sends a write again the shared way after it failed on the own session', async () => {
    mockCompletedAs.mockImplementation(async () => {
      throw Object.assign(new Error('no answer yet'), { name: 'VtiSentNoAnswer' })
    })
    await expect(write()).rejects.toMatchObject({ name: 'VtiSentNoAnswer' })
    expect(mockHolding).not.toHaveBeenCalled()
  })
})

describe('the rooms backend asks the shared way, as today (controls)', () => {
  it('with the switch off', async () => {
    SESSIONS_PER_IDENTITY.on = false
    await expect(listing()).resolves.toBe('shared')
    expect(mockTaskAs).not.toHaveBeenCalled()
  })

  it('with the switch turned off remotely, whatever `on` says', async () => {
    SESSIONS_PER_IDENTITY.remoteOff = true
    await expect(listing()).resolves.toBe('shared')
    expect(mockTaskAs).not.toHaveBeenCalled()
  })

  it('when the identity has no session of its own open', async () => {
    mockOwnOpen.mockImplementation(() => false)
    await expect(write()).resolves.toBe('shared')
    expect(mockCompletedAs).not.toHaveBeenCalled()
  })

  it('a switch that is not plainly on reads as off', async () => {
    Object.assign(SESSIONS_PER_IDENTITY, { on: 'yes' as unknown as boolean })
    await expect(listing()).resolves.toBe('shared')
  })
})
