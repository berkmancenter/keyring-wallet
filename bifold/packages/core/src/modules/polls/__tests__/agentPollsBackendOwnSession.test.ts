/**
 * Which session a polls ask goes out on (sessions phase B, as rooms: agentRoomsBackendOwnSession.test.ts): the
 * identity's own, where the release switch is on and that session is open, else the shared session exactly as before.
 * A session found closed before anything was sent falls back; any other failure is the ask's own, and a ticket request
 * is never sent again the shared way. Y74V-MEPV (11-17): opening a SEDI poll signed the shared session in (+2.2 s).
 */
const mockHolding = jest.fn(async (..._a: unknown[]) => 'shared')
const mockOwnOpen = jest.fn((_did: string) => true)
const mockOnceOpen = jest.fn(async (_did: string) => false)
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
    async getMembership() {
      return undefined
    }
  },
}))
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
      ownSessionOnceOpen: (did: string) => mockOnceOpen(did),
      communityTaskAs: (...a: unknown[]) => mockTaskAs(...a),
      sendCompletedAs: (...a: unknown[]) => mockCompletedAs(...a),
    },
  }
})
const mockAgentTask = jest.fn(async (..._a: unknown[]): Promise<unknown> => ({ ok: true }))
const mockServedRefused = jest.fn()
const mockServedTypes = jest.fn(async (..._a: unknown[]) => ['a'])
jest.mock('../../trust-tasks/module/vtaAgent', () => ({
  vtaAgent: {
    roomsClient: async () => ({ task: (...a: unknown[]) => mockAgentTask(...a) }),
    servedRefused: (...a: unknown[]) => mockServedRefused(...a),
    servedTypes: (...a: unknown[]) => mockServedTypes(...a),
  },
}))
jest.mock('../../trust-tasks/module/vtiTsp', () => ({ GenericRecordsTspPeerRevisionStore: class {} }))
jest.mock('../ballotBoxDoor', () => ({ createBallotBoxDoor: () => ({}) }))

import { SESSIONS_PER_IDENTITY } from '../../trust-tasks/module/sessionsPerIdentitySwitch'
import { VtiNoOwnSession } from '../../trust-tasks/module/vtiAgent'
import { createAgentPollsBackend } from '../agentPollsBackend'

const agent = { config: { logger: { warn: jest.fn(), info: jest.fn() } } } as never
const COMMUNITY = 'did:webs:webvh.storm.ws:sedi-vtc:EExample'
const LIST = 'https://trusttasks.org/spec/vtc/elections/list/0.5'
const SHOW = 'https://trusttasks.org/spec/vtc/elections/show/0.6'
const TICKET = { type: 'https://trusttasks.org/spec/vtc/elections/tickets/issue/0.1', payload: { electionId: 'e1' } }

const listing = () => createAgentPollsBackend(agent).communityTask(COMMUNITY, LIST, {})
const show = () => createAgentPollsBackend(agent).communityTask(COMMUNITY, SHOW, { electionId: 'e1' })
const ticket = () => createAgentPollsBackend(agent).sendCompleted(COMMUNITY, TICKET)
const noOwnSession = () => {
  throw new (VtiNoOwnSession as unknown as new () => Error)()
}

beforeEach(() => {
  for (const m of [mockHolding, mockOwnOpen, mockOnceOpen, mockTaskAs, mockCompletedAs]) m.mockClear()
  mockOwnOpen.mockImplementation(() => true)
  mockOnceOpen.mockImplementation(async () => false)
  mockTaskAs.mockImplementation(async () => 'own')
  mockCompletedAs.mockImplementation(async () => 'own')
  mockPersona = {
    did: 'did:webvh:p:pull-hockey',
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

describe('the polls backend, with its identity’s own session open', () => {
  it('lists over that session, as the identity, with no hold of the shared session', async () => {
    await expect(listing()).resolves.toBe('own')
    expect(mockTaskAs).toHaveBeenCalledWith(mockPersona, COMMUNITY, LIST, {})
    expect(mockHolding).not.toHaveBeenCalled()
  })

  it('reads one poll over it too (Y74V-MEPV: opening a poll signed the shared session in first)', async () => {
    await expect(show()).resolves.toBe('own')
    expect(mockTaskAs).toHaveBeenCalledWith(mockPersona, COMMUNITY, SHOW, { electionId: 'e1' })
    expect(mockHolding).not.toHaveBeenCalled()
  })

  it('sends the ticket request over it, to the community', async () => {
    await expect(ticket()).resolves.toBe('own')
    expect(mockCompletedAs).toHaveBeenCalledWith(mockPersona, COMMUNITY, TICKET)
    expect(mockHolding).not.toHaveBeenCalled()
  })

  it('asks the shared way when the session turns out closed before anything was sent', async () => {
    mockTaskAs.mockImplementation(async () => noOwnSession())
    await expect(listing()).resolves.toBe('shared')
    expect(mockHolding).toHaveBeenCalledTimes(1)
  })

  it('a ticket request found with no session before it was sent goes the shared way, once', async () => {
    mockCompletedAs.mockImplementation(async () => noOwnSession())
    await expect(ticket()).resolves.toBe('shared')
    expect(mockCompletedAs).toHaveBeenCalledTimes(1)
    expect(mockHolding).toHaveBeenCalledTimes(1)
  })

  it('never sends a ticket request again the shared way after it failed on the own session', async () => {
    mockCompletedAs.mockImplementation(async () => {
      throw Object.assign(new Error('no answer yet'), { name: 'VtiSentNoAnswer' })
    })
    await expect(ticket()).rejects.toMatchObject({ name: 'VtiSentNoAnswer' })
    expect(mockHolding).not.toHaveBeenCalled()
  })

  it('a listing that failed on the own session for any other reason is not asked again the shared way', async () => {
    mockTaskAs.mockImplementation(async () => {
      throw Object.assign(new Error('refused'), { name: 'VtiRefusal' })
    })
    await expect(listing()).rejects.toMatchObject({ name: 'VtiRefusal' })
    expect(mockHolding).not.toHaveBeenCalled()
  })
})

describe('the polls backend asks the shared way, exactly as before (controls)', () => {
  const holdingOptions = () => mockHolding.mock.calls[0][4] as Record<string, unknown>

  it('one community (the shared session is this identity, so it has no session of its own): a listing as before', async () => {
    mockOwnOpen.mockImplementation(() => false)
    await expect(listing()).resolves.toBe('shared')
    expect(mockTaskAs).not.toHaveBeenCalled()
    expect(holdingOptions()).toMatchObject({ reason: 'polls', claims: false, listing: true })
  })

  it('one community: a ticket request as before, holding as an ordinary caller', async () => {
    mockOwnOpen.mockImplementation(() => false)
    await expect(ticket()).resolves.toBe('shared')
    expect(mockCompletedAs).not.toHaveBeenCalled()
    expect(holdingOptions()).toMatchObject({ reason: 'polls', claims: true })
    expect(holdingOptions()).not.toHaveProperty('listing')
  })

  it('with the switch turned off remotely, whatever `on` says', async () => {
    SESSIONS_PER_IDENTITY.remoteOff = true
    await expect(listing()).resolves.toBe('shared')
    await expect(ticket()).resolves.toBe('shared')
    expect(mockTaskAs).not.toHaveBeenCalled()
    expect(mockCompletedAs).not.toHaveBeenCalled()
  })

  it('with the switch off', async () => {
    SESSIONS_PER_IDENTITY.on = false
    await expect(show()).resolves.toBe('shared')
    expect(mockTaskAs).not.toHaveBeenCalled()
  })

  it('a switch that is not plainly on reads as off', async () => {
    Object.assign(SESSIONS_PER_IDENTITY, { on: 'yes' as unknown as boolean })
    await expect(listing()).resolves.toBe('shared')
  })
})

// QG4P-MQCT (11-17): a launch's first listing signed the shared session in as an identity whose own listener was a
// moment from listening; two sockets for one DID, one closed by the mediator, the answer lost for 43 s.
describe('the polls backend, with its identity’s own session still opening', () => {
  beforeEach(() => mockOwnOpen.mockImplementation(() => false))

  it('a listing waits for it and goes out on it, with no sign-in of the shared session as that identity', async () => {
    mockOnceOpen.mockImplementation(async () => true)
    await expect(listing()).resolves.toBe('own')
    expect(mockOnceOpen).toHaveBeenCalledWith(mockPersona?.did)
    expect(mockTaskAs).toHaveBeenCalledTimes(1)
    expect(mockHolding).not.toHaveBeenCalled()
  })

  it('a listing whose wait ends with no session (not opening, failed, or past its bound) goes the shared way, once', async () => {
    await expect(listing()).resolves.toBe('shared')
    expect(mockOnceOpen).toHaveBeenCalledTimes(1)
    expect(mockTaskAs).not.toHaveBeenCalled()
    expect(mockHolding).toHaveBeenCalledTimes(1)
  })

  it('a ticket request never waits: it goes the shared way at once, as before (control)', async () => {
    mockOnceOpen.mockImplementation(async () => true)
    await expect(ticket()).resolves.toBe('shared')
    expect(mockOnceOpen).not.toHaveBeenCalled()
    expect(mockCompletedAs).not.toHaveBeenCalled()
  })

  it('with the switch off, or turned off remotely, a listing does not wait either (control)', async () => {
    mockOnceOpen.mockImplementation(async () => true)
    SESSIONS_PER_IDENTITY.on = false
    await expect(listing()).resolves.toBe('shared')
    Object.assign(SESSIONS_PER_IDENTITY, { on: true, remoteOff: true })
    await expect(listing()).resolves.toBe('shared')
    expect(mockOnceOpen).not.toHaveBeenCalled()
    expect(mockTaskAs).not.toHaveBeenCalled()
  })
})

// agentLastKnownSwitch.ts: the polls service reads what the agent serves through the agent controller (its last answer,
// asked again behind), and a task the agent refuses is handed to it, which asks again when the refusal says "not served".
describe('the polls backend and what the agent serves', () => {
  beforeEach(() => {
    mockAgentTask.mockClear()
    mockServedRefused.mockClear()
  })

  it('reads it from the agent controller', async () => {
    await expect(createAgentPollsBackend(agent).agentServedTypes()).resolves.toEqual(['a'])
    expect(mockServedTypes).toHaveBeenCalledWith(agent)
  })

  it('hands a refused agent task to the agent controller, and the caller gets the same error', async () => {
    const refusal = new Error('unsupportedVersion')
    mockAgentTask.mockImplementationOnce(async () => {
      throw refusal
    })
    await expect(createAgentPollsBackend(agent).agentTask('t', { a: 1 })).rejects.toBe(refusal)
    expect(mockServedRefused).toHaveBeenCalledTimes(1)
    expect(mockServedRefused).toHaveBeenCalledWith(agent, refusal)
  })

  it('control: an answered agent task hands it nothing', async () => {
    await expect(createAgentPollsBackend(agent).agentTask('t', { a: 1 })).resolves.toEqual({ ok: true })
    expect(mockAgentTask).toHaveBeenCalledWith('t', { a: 1 })
    expect(mockServedRefused).not.toHaveBeenCalled()
  })
})
