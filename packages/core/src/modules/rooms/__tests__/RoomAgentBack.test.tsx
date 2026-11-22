/**
 * A room read while the agent is being reached again (#772, 276.9). After the PIN the room said "Couldn't reach your
 * agent" for 10–20 s, until the retry tick: the session reopens behind a link still shown online. Now a failed read
 * waits while the agent is being reached, is read again the moment a session opens, and the failure is said only
 * when nothing is reaching the agent. Once per session opened, never a loop.
 */
import { act, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { AgentSession } from '../agentSession'
import type { RoomsService } from '../types'
import { ROOM_POLL_MS } from '../useRoomPosts'

let mockService: RoomsService | undefined
let mockSession: AgentSession = { reconnecting: false }
const mockSessionListeners = new Set<() => void>()
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
jest.mock('../agentSession', () => {
  const { useSyncExternalStore } = jest.requireActual('react')
  return {
    useAgentSession: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          mockSessionListeners.add(listener)
          return () => mockSessionListeners.delete(listener)
        },
        () => mockSession
      ),
  }
})
jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => 100 }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useRoute: () => ({ params: { roomId: 'did:webvh:sample:planning' } }),
  useIsFocused: () => true,
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Room = require('../screens/Room').default
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RoomInfo = require('../screens/RoomInfo').default

const id = (key: string) => testIdWithKey(key)
const unanswered = () => new Error('the agent did not answer')
const show = (Screen: React.FC = Room) =>
  render(
    <BasicAppContext>
      <Screen />
    </BasicAppContext>
  )
const wait = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms))
const sessionIs = (next: Partial<AgentSession>) =>
  act(() => {
    mockSession = { ...mockSession, ...next }
    mockSessionListeners.forEach((listener) => listener())
  })
const sample = () => {
  const service = createSampleRoomsService()
  mockService = service
  return service
}

beforeEach(() => {
  jest.useFakeTimers()
  mockSession = { reconnecting: false, openedAt: 1 }
})
afterEach(() => jest.useRealTimers())

describe('a room read while the agent is being reached again', () => {
  test('waits, not "Couldn\'t reach your agent", and is read again the moment the agent is back, before the retry tick', async () => {
    mockSession = { reconnecting: true, openedAt: 1 }
    const getRoom = jest.spyOn(sample(), 'getRoom').mockRejectedValueOnce(unanswered())
    const tree = show()
    await waitFor(() => expect(getRoom).toHaveBeenCalledTimes(1))
    await wait(1000)
    expect(tree.queryByTestId(id('RoomReadFailed'))).toBeNull()
    expect(tree.getByTestId(id('RoomReading'))).toBeTruthy()

    await sessionIs({ reconnecting: false, openedAt: 2 })
    await waitFor(() => expect(tree.getAllByTestId(/RoomPost_/).length).toBeGreaterThan(0))
    expect(getRoom).toHaveBeenCalledTimes(2)
    expect(tree.queryByTestId(id('RoomReadFailed'))).toBeNull()
  })

  test('says the failure once nothing is reaching the agent (control: no session opened, so no read yet)', async () => {
    mockSession = { reconnecting: true, openedAt: 1 }
    const getRoom = jest.spyOn(sample(), 'getRoom').mockRejectedValueOnce(unanswered())
    const tree = show()
    await waitFor(() => expect(getRoom).toHaveBeenCalledTimes(1))
    await sessionIs({ reconnecting: false })
    await waitFor(() => expect(tree.getByTestId(id('RoomReadFailed'))).toBeTruthy())
    expect(getRoom).toHaveBeenCalledTimes(1)
  })

  test('a read sent before the agent came back, failing after, is read again', async () => {
    let fail!: (e: Error) => void
    const getRoom = jest
      .spyOn(sample(), 'getRoom')
      .mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
    mockSession = { reconnecting: true, openedAt: 1 }
    const tree = show()
    await waitFor(() => expect(getRoom).toHaveBeenCalledTimes(1))
    await sessionIs({ reconnecting: false, openedAt: 2 })
    await act(async () => fail(unanswered()))
    await waitFor(() => expect(tree.getAllByTestId(/RoomPost_/).length).toBeGreaterThan(0))
    expect(getRoom).toHaveBeenCalledTimes(2)
  })

  test('once per session opened: a read failing on the new session is said, and not read again at once', async () => {
    const getRoom = jest
      .spyOn(sample(), 'getRoom')
      .mockRejectedValueOnce(unanswered())
      .mockRejectedValueOnce(unanswered())
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(id('RoomReadFailed'))).toBeTruthy())
    expect(getRoom).toHaveBeenCalledTimes(1)

    await sessionIs({ openedAt: 2 })
    await waitFor(() => expect(getRoom).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(tree.getByTestId(id('RoomReadFailed'))).toBeTruthy())
    await wait(ROOM_POLL_MS - 1000)
    expect(getRoom).toHaveBeenCalledTimes(2)
  })

  test("the room's details wait for the agent too, and read again when it is back", async () => {
    mockSession = { reconnecting: true, openedAt: 1 }
    const getRoom = jest.spyOn(sample(), 'getRoom').mockRejectedValueOnce(unanswered())
    const tree = show(RoomInfo)
    await waitFor(() => expect(getRoom).toHaveBeenCalledTimes(1))
    await wait(1000)
    expect(tree.queryByTestId(id('RoomReadFailed'))).toBeNull()
    await sessionIs({ reconnecting: false, openedAt: 2 })
    await waitFor(() => expect(tree.getByTestId(id('RoomInfoFiles'))).toBeTruthy())
    expect(getRoom).toHaveBeenCalledTimes(2)
  })
})

describe("a room's posts while the agent is being reached again", () => {
  test('a first listing that failed waits, and is listed again when the agent is back', async () => {
    mockSession = { reconnecting: true, openedAt: 1 }
    const listNotes = jest.spyOn(sample(), 'listNotes').mockRejectedValueOnce(unanswered())
    const tree = show()
    await waitFor(() => expect(listNotes).toHaveBeenCalledTimes(1))
    await wait(1000)
    expect(tree.queryByTestId(id('RoomPostsFailed'))).toBeNull()
    expect(tree.getByTestId(id('RoomPostsReading'))).toBeTruthy()

    await sessionIs({ reconnecting: false, openedAt: 2 })
    await waitFor(() => expect(tree.getAllByTestId(/RoomPost_/).length).toBeGreaterThan(0))
    expect(listNotes).toHaveBeenCalledTimes(2)
  })

  test('a first listing that failed is said when nothing is reaching the agent (control)', async () => {
    const listNotes = jest.spyOn(sample(), 'listNotes').mockRejectedValueOnce(unanswered())
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(id('RoomPostsFailed'))).toBeTruthy())
    expect(listNotes).toHaveBeenCalledTimes(1)
  })

  test('a poll that failed while reconnecting is not said, and polls again the moment the agent is back', async () => {
    const service = sample()
    const tree = show()
    await waitFor(() => expect(tree.getAllByTestId(/RoomPost_/).length).toBeGreaterThan(0))
    const listNotes = jest.spyOn(service, 'listNotes').mockRejectedValueOnce(unanswered())
    await sessionIs({ reconnecting: true })
    await wait(ROOM_POLL_MS)
    expect(listNotes).toHaveBeenCalledTimes(1)
    expect(tree.queryByTestId(id('RoomPollFailed'))).toBeNull()

    await sessionIs({ reconnecting: false, openedAt: 2 })
    await waitFor(() => expect(listNotes).toHaveBeenCalledTimes(2))
    expect(tree.queryByTestId(id('RoomPollFailed'))).toBeNull()
  })
})
