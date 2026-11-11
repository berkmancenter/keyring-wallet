/**
 * What the rooms backend hands the agent's client for a task. A batch read's wait and its refusal to sit waiting for
 * consent only mean something if they reach the client's own arguments.
 */
const mockTask = jest.fn(async (..._args: unknown[]) => ({}))

jest.mock('../../trust-tasks/module/vtaAgent', () => ({
  vtaAgent: { roomsClient: async () => ({ task: mockTask }), agentAddress: () => 'did:key:agent' },
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
  beforeEach(() => mockTask.mockClear())

  test('a timeout and waitForConsent reach the client where it reads them', async () => {
    await createAgentRoomsBackend(agent).agentTask('t', { a: 1 }, { timeoutMs: 60000, waitForConsent: false })
    expect(mockTask).toHaveBeenCalledWith('t', { a: 1 }, 60000, undefined, undefined, { waitForConsent: false })
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
