/**
 * The rooms a screen shows are read again when the linked agent changes. An Add given up passes through "no agent":
 * coming back to My Agent read the rooms then, and the agent came back after, so the card said "Link your agent
 * first" until the screen was left (nightly 10-30, add-then-back). A read for another agent than the last read's asks
 * its services afresh (A, then B, then A must not read B's). Nothing changing reads nothing.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { DeviceEventEmitter } from 'react-native'

import { WALLET_LOCKED_EVENT } from '../../../utils/walletLocked'

import { deriveCapabilities, ROOMS_OPERATIONS, ROOMS_REQUIREMENTS } from '../capabilities'
import { toInertText } from '../inertText'
import { RoomsUnavailable, type RoomsService, type RoomSummary } from '../types'
import { forgetMyRooms, MY_ROOMS_RETRY_MS, ROOMS_LEFT_EVENT, useMyRooms } from '../useMyRooms'

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

// What says how the last read went, and a read that isn't a refresh, whatever came before it.
describe('how the last read went', () => {
  test('failures count in a row, and a read that answers clears them', async () => {
    const rooms = service()
    const failing = rooms.listMyRooms as unknown as jest.Mock
    failing.mockRejectedValueOnce(new Error('not connected')).mockRejectedValueOnce(new Error('not connected'))
    const { result } = renderHook(() => useMyRooms(rooms))
    await waitFor(() => expect(result.current.failures).toBe(1))
    expect(result.current.failed).toBe(true)
    act(() => result.current.reread())
    await waitFor(() => expect(result.current.failures).toBe(2))
    act(() => result.current.reread())
    await waitFor(() => expect(result.current.failures).toBe(0))
    expect(result.current.failed).toBe(false)
  })

  test('a reread is quiet, even after a reload; the reload itself refreshes (control)', async () => {
    const rooms = service()
    const { result } = renderHook(() => useMyRooms(rooms))
    await waitFor(() => expect(rooms.capabilities).toHaveBeenCalledTimes(1))

    act(() => result.current.reload())
    await waitFor(() => expect(rooms.capabilities).toHaveBeenCalledTimes(2))
    expect(rooms.capabilities).toHaveBeenLastCalledWith({ refresh: true })
    await waitFor(() => expect(result.current.refreshing).toBe(false))

    act(() => result.current.reread())
    expect(result.current.refreshing).toBe(false)
    await waitFor(() => expect(rooms.capabilities).toHaveBeenCalledTimes(3))
    expect(rooms.capabilities).toHaveBeenLastCalledWith({ refresh: false })
  })
})

// A tester's 277.4 log (11-02): First VTC left its offers unanswered for minutes. The list waited for each 30 s ask,
// and on the community's own screen failed as "Couldn't reach your agent", whose Try again joined the same ask.
describe('the rooms never wait on the offers, and a failed read says so and tries again', () => {
  const LAB = 'did:webvh:QmLab:lab.example'
  const room: RoomSummary = {
    roomId: 'did:webvh:r:planning',
    name: toInertText('Planning'),
    nameFrom: 'community',
    source: 'community',
    communityDid: LAB,
    tier: 'open',
    standing: 'member',
  }
  const never = () => new Promise<never>(() => undefined)
  beforeEach(() => forgetMyRooms())

  test('the rooms show as soon as they are listed, while the offers are still asked (control: then they come)', async () => {
    const s = service()
    let answer: (offers: never[]) => void = () => undefined
    ;(s.listMyRooms as jest.Mock).mockResolvedValue([room])
    ;(s.listOffers as jest.Mock).mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { result } = renderHook(() => useMyRooms(s, LAB))
    await waitFor(() => expect(result.current.rooms).toEqual([room]))
    expect(result.current.offers).toBeUndefined()
    await act(async () => answer([]))
    expect(result.current.offers).toEqual([])
  })

  test("offers a community didn't answer leave its rooms shown, not failed, and say so", async () => {
    const s = Object.assign(service(), { note: jest.fn() })
    ;(s.listMyRooms as jest.Mock).mockResolvedValue([room])
    // The offers give up after the rooms are shown, as a 30 s wait does.
    let giveUp: (e: Error) => void = () => undefined
    ;(s.listOffers as jest.Mock).mockReturnValue(new Promise((_, reject) => (giveUp = reject)))
    const { result } = renderHook(() => useMyRooms(s, LAB))
    await waitFor(() => expect(result.current.rooms).toEqual([room]))
    await act(async () => giveUp(new Error('vtiAgent: sent vtc/rooms/offers/list; the community has not answered yet')))
    expect(result.current.offersFailed).toBe(true)
    expect(result.current.rooms).toEqual([room])
    expect(result.current.failed).toBe(false)
    expect(s.note).toHaveBeenCalledWith(expect.stringMatching(/the offers for the rooms of .* were not read/))
  })

  test('opened again, the screen shows the last listing at once, while it is read again', async () => {
    const s = service()
    ;(s.listMyRooms as jest.Mock).mockResolvedValue([room])
    const first = renderHook(() => useMyRooms(s, LAB))
    await waitFor(() => expect(first.result.current.rooms).toEqual([room]))
    first.unmount()
    ;(s.listMyRooms as jest.Mock).mockReturnValue(never())
    const again = renderHook(() => useMyRooms(s, LAB))
    expect(again.result.current.rooms).toEqual([room])
    expect(again.result.current.capabilities).toBeDefined()
    // Control: another community's screen remembers nothing of this one.
    expect(renderHook(() => useMyRooms(s, 'did:webvh:QmOther:x')).result.current.rooms).toBeUndefined()
  })

  test('a lock forgets what was remembered: reopened after it, the screen shows nothing until it reads (control above)', async () => {
    const s = service()
    ;(s.listMyRooms as jest.Mock).mockResolvedValue([room])
    const first = renderHook(() => useMyRooms(s, LAB))
    await waitFor(() => expect(first.result.current.rooms).toEqual([room]))
    first.unmount()
    act(() => void DeviceEventEmitter.emit(WALLET_LOCKED_EVENT))
    ;(s.listMyRooms as jest.Mock).mockReturnValue(never())
    const again = renderHook(() => useMyRooms(s, LAB))
    expect(again.result.current.rooms).toBeUndefined()
    expect(again.result.current.capabilities).toBeUndefined()
  })

  test('a failed read is tried once more after MY_ROOMS_RETRY_MS, as "trying again", and logged; a second failure waits', async () => {
    jest.useFakeTimers()
    try {
      const s = Object.assign(service(), { note: jest.fn() })
      ;(s.listMyRooms as jest.Mock).mockRejectedValue(
        new RoomsUnavailable('listMyRooms', 'communityUnreachable', 'no community answered')
      )
      const { result } = renderHook(() => useMyRooms(s, LAB))
      await act(async () => undefined)
      expect(result.current).toMatchObject({ failed: true, failures: 1, failure: { reason: 'communityUnreachable' } })
      expect(s.note).toHaveBeenCalledWith(
        expect.stringMatching(/the rooms of .* were not read \(\d+ ms\): .*no community answered/)
      )
      expect(s.listMyRooms).toHaveBeenCalledTimes(1)
      await act(async () => void (await jest.advanceTimersByTimeAsync(MY_ROOMS_RETRY_MS - 1)))
      expect(s.listMyRooms).toHaveBeenCalledTimes(1)
      await act(async () => void (await jest.advanceTimersByTimeAsync(1)))
      expect(s.listMyRooms).toHaveBeenCalledTimes(2)
      expect(s.note).toHaveBeenCalledWith(expect.stringMatching(/trying the rooms of .* again/))
      expect(result.current).toMatchObject({ failures: 2, refreshing: false })
      await act(async () => void (await jest.advanceTimersByTimeAsync(MY_ROOMS_RETRY_MS * 3)))
      expect(s.listMyRooms).toHaveBeenCalledTimes(2)
    } finally {
      jest.useRealTimers()
    }
  })

  test("the member's Try again shows as refreshing until it answers, and is logged", async () => {
    const s = Object.assign(service(), { note: jest.fn() })
    ;(s.listMyRooms as jest.Mock).mockRejectedValueOnce(new Error('the agent did not answer'))
    const { result } = renderHook(() => useMyRooms(s, LAB))
    await waitFor(() => expect(result.current.failed).toBe(true))
    let answer: (rooms: RoomSummary[]) => void = () => undefined
    ;(s.listMyRooms as jest.Mock).mockReturnValue(new Promise((resolve) => (answer = resolve)))
    act(() => result.current.reload())
    expect(result.current.refreshing).toBe(true)
    expect(s.note).toHaveBeenCalledWith(expect.stringMatching(/asked to try the rooms again/))
    await act(async () => answer([room]))
    expect(result.current).toMatchObject({ failed: false, refreshing: false, rooms: [room] })
  })

  test('an unmounted screen tries nothing again (control: a mounted one does, above)', async () => {
    jest.useFakeTimers()
    try {
      const s = service()
      ;(s.listMyRooms as jest.Mock).mockRejectedValue(new Error('down'))
      const { unmount } = renderHook(() => useMyRooms(s, LAB))
      await act(async () => undefined)
      unmount()
      await act(async () => void (await jest.advanceTimersByTimeAsync(MY_ROOMS_RETRY_MS * 2)))
      expect(s.listMyRooms).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })
})

// Left from the community's own screen, its room stayed in My Agent's count and in the Rooms list (277.7, 11-03).
describe('a community left goes from every rooms list at once', () => {
  const LEFT = 'did:webvh:QmLeft:left.example'
  const STAYS = 'did:webvh:QmStays:stays.example'
  const roomOf = (communityDid: string, id: string): RoomSummary => ({
    roomId: `did:webvh:r:${id}`,
    name: toInertText(id),
    nameFrom: 'community',
    source: 'community',
    communityDid,
    tier: 'open',
    standing: 'member',
  })
  const left = roomOf(LEFT, 'left')
  const stays = roomOf(STAYS, 'stays')
  beforeEach(() => forgetMyRooms())

  test("its rooms go before the read after says so, and the other community's stay (control)", async () => {
    const s = service()
    ;(s.listMyRooms as jest.Mock).mockResolvedValue([left, stays])
    const { result } = renderHook(() => useMyRooms(s))
    await waitFor(() => expect(result.current.rooms).toEqual([left, stays]))
    ;(s.listMyRooms as jest.Mock).mockReturnValue(new Promise<never>(() => undefined))
    act(() => void DeviceEventEmitter.emit(ROOMS_LEFT_EVENT, LEFT))
    expect(result.current.rooms).toEqual([stays])
    // And it reads again, for whatever else the leave changed.
    await waitFor(() => expect(s.listMyRooms).toHaveBeenCalledTimes(2))
  })

  test('a screen opened after the leave does not show the rooms remembered before it (control: before, it does)', async () => {
    const s = service()
    ;(s.listMyRooms as jest.Mock).mockResolvedValue([left, stays])
    const first = renderHook(() => useMyRooms(s))
    await waitFor(() => expect(first.result.current.rooms).toEqual([left, stays]))
    first.unmount()
    ;(s.listMyRooms as jest.Mock).mockReturnValue(new Promise<never>(() => undefined))
    const before = renderHook(() => useMyRooms(s))
    expect(before.result.current.rooms).toEqual([left, stays])
    before.unmount()
    act(() => void DeviceEventEmitter.emit(ROOMS_LEFT_EVENT, LEFT))
    const after = renderHook(() => useMyRooms(s))
    expect(after.result.current.rooms).toBeUndefined()
  })

  test("the left community's own list empties", async () => {
    const s = service()
    ;(s.listMyRooms as jest.Mock).mockResolvedValue([left, stays])
    const { result } = renderHook(() => useMyRooms(s, LEFT))
    await waitFor(() => expect(result.current.rooms).toEqual([left]))
    ;(s.listMyRooms as jest.Mock).mockResolvedValue([stays])
    act(() => void DeviceEventEmitter.emit(ROOMS_LEFT_EVENT, LEFT))
    expect(result.current.rooms).toEqual([])
    await waitFor(() => expect(s.listMyRooms).toHaveBeenCalledTimes(2))
    expect(result.current.rooms).toEqual([])
  })
})
