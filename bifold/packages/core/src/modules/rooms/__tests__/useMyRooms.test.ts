/**
 * The rooms a screen shows are read again when the linked agent changes. An Add given up passes through "no agent":
 * coming back to My Agent read the rooms then, and the agent came back after, so the card said "Link your agent
 * first" until the screen was left (nightly 10-30, add-then-back). A read for another agent than the last read's asks
 * its services afresh (A, then B, then A must not read B's). Nothing changing reads nothing.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native'

import { deriveCapabilities, ROOMS_OPERATIONS, ROOMS_REQUIREMENTS } from '../capabilities'
import type { RoomsService } from '../types'
import { useMyRooms } from '../useMyRooms'

let mockAgent: string | undefined
const mockListeners = new Set<() => void>()
jest.mock('../../trust-tasks/module/vtaAgent', () => ({
  vtaAgent: {
    subscribe: (listener: () => void) => {
      mockListeners.add(listener)
      return () => mockListeners.delete(listener)
    },
    agentAddress: () => mockAgent,
  },
}))

const agentIs = (vtaDid: string | undefined) =>
  act(() => {
    mockAgent = vtaDid
    mockListeners.forEach((listener) => listener())
  })

// Every service the rooms ask an agent for: the agent serves them all.
const SERVED = Object.values(ROOMS_REQUIREMENTS).flatMap((need) => ('anyOf' in need ? need.anyOf : []))

// The real service's rule: whether an agent is linked is read at the call.
const service = () => {
  const capabilities = jest.fn(async (_options?: { refresh?: boolean }) =>
    deriveCapabilities({
      agentLinked: mockAgent !== undefined,
      servedTypes: SERVED,
      built: new Set(ROOMS_OPERATIONS),
    })
  )
  return {
    capabilities,
    listMyRooms: jest.fn(async () => []),
    listOffers: jest.fn(async () => []),
  } as unknown as RoomsService & { capabilities: typeof capabilities }
}

beforeEach(() => {
  mockAgent = 'did:webvh:QmA:agent.example'
  mockListeners.clear()
})

describe('rooms read again when the agent changes', () => {
  test('a read made while the agent was away is made again when it comes back', async () => {
    const rooms = service()
    const { result } = renderHook(() => useMyRooms(rooms))
    await waitFor(() => expect(result.current.capabilities?.listMyRooms.reason).toBe('ok'))

    // Add, then Back: the agent is away, and coming back into view reads while it is.
    agentIs(undefined)
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.capabilities?.listMyRooms.reason).toBe('noAgentLinked'))

    agentIs('did:webvh:QmA:agent.example')
    await waitFor(() => expect(result.current.capabilities?.listMyRooms.reason).toBe('ok'))
    expect(rooms.listMyRooms).toHaveBeenCalledTimes(2)
  })

  test("another agent's services are asked afresh; the first read is not (control)", async () => {
    const rooms = service()
    renderHook(() => useMyRooms(rooms))
    await waitFor(() => expect(rooms.capabilities).toHaveBeenCalledTimes(1))
    expect(rooms.capabilities).toHaveBeenLastCalledWith({ refresh: false })

    agentIs('did:webvh:QmB:other.example')
    await waitFor(() => expect(rooms.capabilities).toHaveBeenCalledTimes(2))
    expect(rooms.capabilities).toHaveBeenLastCalledWith({ refresh: true })
  })

  test("back to the first agent after another, its services are asked afresh, not the other's kept", async () => {
    const rooms = service()
    renderHook(() => useMyRooms(rooms))
    await waitFor(() => expect(rooms.capabilities).toHaveBeenCalledTimes(1))
    agentIs('did:webvh:QmB:other.example')
    await waitFor(() => expect(rooms.capabilities).toHaveBeenCalledTimes(2))
    agentIs('did:webvh:QmA:agent.example')
    await waitFor(() => expect(rooms.capabilities).toHaveBeenCalledTimes(3))
    expect(rooms.capabilities).toHaveBeenLastCalledWith({ refresh: true })
  })

  test('a change that leaves the same agent reads nothing (control)', async () => {
    const rooms = service()
    renderHook(() => useMyRooms(rooms))
    await waitFor(() => expect(rooms.capabilities).toHaveBeenCalledTimes(1))
    agentIs('did:webvh:QmA:agent.example')
    await act(async () => undefined)
    expect(rooms.capabilities).toHaveBeenCalledTimes(1)
  })
})

// 10-31: a community skipped because a step kept the community session is read again once it is free — the same read,
// not a refresh: no pull spinner, and the agent's services are not asked again.
describe('rooms read again when a skipped community can be read', () => {
  const readableService = () => {
    const s = service()
    const listeners = new Set<() => void>()
    const onReadable = jest.fn((listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    })
    Object.assign(s, { onReadable })
    return { s, listeners, readable: () => act(() => listeners.forEach((listener) => listener())) }
  }

  test('reads again, without a refresh', async () => {
    const { s, readable } = readableService()
    const { result } = renderHook(() => useMyRooms(s, 'did:webvh:community:b'))
    await waitFor(() => expect(s.listOffers).toHaveBeenCalledTimes(1))
    await readable()
    await waitFor(() => expect(s.listOffers).toHaveBeenCalledTimes(2))
    expect(s.listOffers).toHaveBeenLastCalledWith('did:webvh:community:b')
    expect(s.capabilities.mock.calls.map(([options]) => options?.refresh)).toEqual([false, false])
    expect(result.current.refreshing).toBe(false)
    expect(result.current.failed).toBe(false)
  })

  test('stops listening when the screen goes', async () => {
    const { s, listeners } = readableService()
    const { unmount } = renderHook(() => useMyRooms(s))
    await waitFor(() => expect(listeners.size).toBe(1))
    unmount()
    expect(listeners.size).toBe(0)
  })
})
