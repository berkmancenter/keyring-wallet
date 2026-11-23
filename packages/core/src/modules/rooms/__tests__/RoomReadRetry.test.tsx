/**
 * A room that could not be read is read again while it is in view, at the posts' pace. After an unlock the read could
 * land while the agent's session was still reopening, and the screen stayed on "Couldn't reach your agent" until Try
 * again: the posts poll waits for the room, and nothing else read it (#772, 10-30). Once per failed read, never while
 * one is out (the agent's client sends one task at a time), and not while another screen is on top.
 */
import { act, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { RoomsService } from '../types'
import { ROOM_POLL_MS } from '../useRoomPosts'

let mockService: RoomsService | undefined
let mockFocused = true
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => 100 }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useRoute: () => ({ params: { roomId: 'did:webvh:sample:planning' } }),
  useIsFocused: () => mockFocused,
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Room = require('../screens/Room').default

const id = (key: string) => testIdWithKey(key)
const failingOnce = () => {
  const sample = createSampleRoomsService()
  const getRoom = jest.spyOn(sample, 'getRoom').mockRejectedValueOnce(new Error('the agent did not answer'))
  mockService = sample
  return getRoom
}
const show = () =>
  render(
    <BasicAppContext>
      <Room />
    </BasicAppContext>
  )
const wait = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms))

beforeEach(() => {
  jest.useFakeTimers()
  mockFocused = true
})
afterEach(() => jest.useRealTimers())

describe('a room that could not be read', () => {
  test('is read again while in view, and shows once it answers', async () => {
    const getRoom = failingOnce()
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(id('RoomReadFailed'))).toBeTruthy())
    await wait(ROOM_POLL_MS)
    await waitFor(() => expect(tree.queryByTestId(id('RoomReadFailed'))).toBeNull())
    expect(getRoom).toHaveBeenCalledTimes(2)
    expect(tree.getAllByTestId(/RoomPost_/).length).toBeGreaterThan(0)
  })

  test('is not read again while a read is still out: one read at a time, not one per tick', async () => {
    const sample = createSampleRoomsService()
    const getRoom = jest
      .spyOn(sample, 'getRoom')
      .mockRejectedValueOnce(new Error('the agent did not answer'))
      .mockImplementationOnce(() => new Promise(() => undefined))
    mockService = sample
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(id('RoomReadFailed'))).toBeTruthy())
    await wait(ROOM_POLL_MS)
    expect(getRoom).toHaveBeenCalledTimes(2)
    await wait(3 * ROOM_POLL_MS)
    expect(getRoom).toHaveBeenCalledTimes(2)
  })

  test('is not read again while another screen is on top (control)', async () => {
    mockFocused = false
    const getRoom = failingOnce()
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(id('RoomReadFailed'))).toBeTruthy())
    await wait(3 * ROOM_POLL_MS)
    expect(getRoom).toHaveBeenCalledTimes(1)
    expect(tree.getByTestId(id('RoomReadFailed'))).toBeTruthy()
  })
})
