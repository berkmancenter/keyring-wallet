/**
 * What the rooms backend hands the agent's client for a task. A batch read's wait and its refusal to sit waiting for
 * consent only mean something if they reach the client's own arguments.
 */
const mockTask = jest.fn(async (..._args: unknown[]) => ({}))
const mockServedRefused = jest.fn()
const mockServedTypes = jest.fn(async (..._args: unknown[]) => ['a'])
const mockServedTypesStamp = jest.fn(() => 7)

jest.mock('../../trust-tasks/module/vtaAgent', () => ({
  vtaAgent: {
    roomsClient: async () => ({ task: mockTask }),
    agentAddress: () => 'did:key:agent',
    servedRefused: (...args: unknown[]) => mockServedRefused(...args),
    servedTypes: (...args: unknown[]) => mockServedTypes(...args),
    servedTypesStamp: () => mockServedTypesStamp(),
  },
}))
jest.mock('../../trust-tasks/module/vtiAgent', () => ({ vtiAgent: {}, VtiRefusal: class extends Error {} }))
jest.mock('../../trust-tasks/module/vtiJoin', () => ({ leaveCommunity: jest.fn() }))
jest.mock('../../trust-tasks/module/keyedRecords', () => ({ listKeyed: jest.fn(), putKeyed: jest.fn() }))
jest.mock('../../trust-tasks/module/VtiIdentityStore', () => ({ GenericRecordsIdentityStore: class {} }))
jest.mock('../../trust-tasks/module/VtiCommunityStore', () => ({ GenericRecordsCommunityStore: class {} }))
jest.mock('../../trust-tasks/module/vtiVetting', () => ({ GenericRecordsVettingStore: class {} }))
jest.mock('../../trust-tasks/module/vtiTsp', () => ({ GenericRecordsTspPeerRevisionStore: class {} }))
jest.mock('../roomsLeave', () => ({ afterLeavingCommunity: jest.fn() }))
// AsyncStorage as it is: Promises, and null for a key never written (the shared __mocks__ double answers plain values
// and undefined, which the consent-hold store would read as unreadable, and so as held).
jest.mock('@react-native-async-storage/async-storage', () => {
  const kept = new Map<string, string>()
  return {
    __esModule: true,
    default: {
      getItem: async (key: string) => kept.get(key) ?? null,
      setItem: async (key: string, value: string) => void kept.set(key, value),
    },
  }
})

import { createAgentRoomsBackend } from '../real/agentRoomsBackend'

const agent = { config: { logger: { warn: jest.fn() } } } as never

describe('agentTask', () => {
  beforeEach(() => {
    mockTask.mockClear()
    mockServedRefused.mockClear()
  })

  // agentLastKnownSwitch.ts: a task refused as unserved has the agent's kept answer asked for again. Which refusals
  // count is the agent controller's to say (vtaAgentLastKnown.test.ts); the backend hands it every one, and the
  // caller still gets the same error.
  test('a refused task is handed to the agent controller, and the caller gets the same error', async () => {
    const refusal = new Error('unsupportedVersion')
    mockTask.mockImplementationOnce(async () => {
      throw refusal
    })
    await expect(createAgentRoomsBackend(agent).agentTask('t', { a: 1 })).rejects.toBe(refusal)
    expect(mockServedRefused).toHaveBeenCalledTimes(1)
    expect(mockServedRefused).toHaveBeenCalledWith(agent, refusal)
  })

  test('an answered task hands it nothing (control)', async () => {
    await expect(createAgentRoomsBackend(agent).agentTask('t', { a: 1 })).resolves.toEqual({})
    expect(mockServedRefused).not.toHaveBeenCalled()
  })

  test('what the agent serves, and its stamp, come from the agent controller', async () => {
    const backend = createAgentRoomsBackend(agent)
    await expect(backend.agentServedTypes()).resolves.toEqual(['a'])
    expect(mockServedTypes).toHaveBeenCalledWith(agent)
    expect(backend.agentServedStamp?.()).toBe(7)
  })

  test('a timeout and waitForConsent reach the client where it reads them', async () => {
    await createAgentRoomsBackend(agent).agentTask('t', { a: 1 }, { timeoutMs: 60000, waitForConsent: false })
    expect(mockTask).toHaveBeenCalledWith('t', { a: 1 }, 60000, undefined, undefined, { waitForConsent: false })
  })

  test("the open room's read reaches the client as in view, its other options beside it", async () => {
    await createAgentRoomsBackend(agent).agentTask('t', { a: 1 }, { inView: true })
    expect(mockTask).toHaveBeenLastCalledWith('t', { a: 1 }, undefined, undefined, undefined, {
      priority: { first: false, inView: true },
    })
    await createAgentRoomsBackend(agent).agentTask(
      't',
      { a: 1 },
      { timeoutMs: 60000, waitForConsent: false, inView: true }
    )
    expect(mockTask).toHaveBeenLastCalledWith('t', { a: 1 }, 60000, undefined, undefined, {
      waitForConsent: false,
      priority: { first: false, inView: true },
    })
  })

  test("a task with no options keeps the client's own defaults (control)", async () => {
    await createAgentRoomsBackend(agent).agentTask('t', { a: 1 })
    expect(mockTask).toHaveBeenCalledWith('t', { a: 1 }, undefined, undefined, undefined, undefined)
  })
})

describe('consentHolds', () => {
  // The back-off is optional on RoomsBackend and reads as "not held" where it is absent, so losing this wiring would
  // quietly return a held batch read to stopping for one session only. This row is what notices.
  const READ02 = 'https://trusttasks.org/spec/rooms/keys/read/0.2'
  const T0 = Date.parse('2026-11-10T20:00:00Z')

  test('the real backend keeps a hold, and a new backend (the next launch) reads it back', async () => {
    const first = createAgentRoomsBackend(agent).consentHolds
    expect(first).toBeDefined()
    expect(await first?.heldRecently(READ02, T0)).toBe(false)
    await first?.noteHeld(READ02, T0)
    expect(await createAgentRoomsBackend(agent).consentHolds?.heldRecently(READ02, T0 + 1)).toBe(true)
  })
})

describe('liveDelivery', () => {
  // Off unless the backend says true (agentRoomsService), so losing this wiring would turn live delivery off for
  // everyone, quietly: every room would poll. And the release's kill must reach it.
  const { ROOMS_LIVE_DELIVERY } = jest.requireActual('../liveDeliverySwitch') as {
    ROOMS_LIVE_DELIVERY: { on: boolean; remoteOff: boolean }
  }
  afterEach(() => {
    ROOMS_LIVE_DELIVERY.on = true
    ROOMS_LIVE_DELIVERY.remoteOff = false
  })

  test('the real backend says on, as the release ships it', () => {
    expect(createAgentRoomsBackend(agent).liveDelivery).toBe(true)
  })

  test("the release's remote off turns it off, read at each ask, whatever on says", () => {
    const backend = createAgentRoomsBackend(agent)
    ROOMS_LIVE_DELIVERY.remoteOff = true
    expect(backend.liveDelivery).toBe(false)
  })

  test('a release that switches it off: off', () => {
    ROOMS_LIVE_DELIVERY.on = false
    expect(createAgentRoomsBackend(agent).liveDelivery).toBe(false)
  })
})
