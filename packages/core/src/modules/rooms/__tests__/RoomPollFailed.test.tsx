/**
 * The room chat's "Couldn't refresh · Try again": shown at the bottom of the posts (the header of the list drawn bottom
 * up) only while the last poll failed and there are posts; Try again asks at once. The hook's side, when it flips and
 * how often it redraws, is in useRoomPosts.test.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { RoomsService } from '../types'

let mockService: RoomsService | undefined
let mockPollFailed = false
const mockPollNow = jest.fn()
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => 100 }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useRoute: () => ({ params: { roomId: 'did:webvh:sample:planning' } }),
}))
// The real feed, with only the poll's outcome set by the test.
jest.mock('../useRoomPosts', () => {
  const actual = jest.requireActual('../useRoomPosts')
  return {
    ...actual,
    useRoomPosts: (...args: unknown[]) => ({
      ...actual.useRoomPosts(...args),
      pollFailed: mockPollFailed,
      pollNow: mockPollNow,
    }),
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Room = require('../screens/Room').default

const id = (key: string) => testIdWithKey(key)
const show = () =>
  render(
    <BasicAppContext>
      <Room />
    </BasicAppContext>
  )

beforeEach(() => {
  mockService = createSampleRoomsService()
  mockPollFailed = false
  mockPollNow.mockReset()
})

describe('a poll that failed', () => {
  test('says "Couldn\'t refresh · Try again" at the bottom of the posts, and Try again asks at once', async () => {
    mockPollFailed = true
    const tree = show()
    await waitFor(() => expect(tree.getAllByTestId(/RoomPost_/).length).toBeGreaterThan(0))
    const list = tree.getByTestId(id('RoomPosts'))
    // Drawn bottom up, the list's header is its bottom, under the newest post.
    expect(list.props.inverted).toBe(true)
    expect(list.props.ListHeaderComponent.props.testID).toBe(id('RoomPollFailed'))
    expect(tree.getByTestId(id('RoomPollFailed'))).toHaveTextContent(/Rooms\.RefreshFailed.*Rooms\.TryAgain/)
    fireEvent.press(tree.getByTestId(id('RoomPollTryAgain')))
    expect(mockPollNow).toHaveBeenCalledTimes(1)
  })

  test('nothing is said while the last poll succeeded', async () => {
    const tree = show()
    await waitFor(() => expect(tree.getAllByTestId(/RoomPost_/).length).toBeGreaterThan(0))
    expect(tree.queryByTestId(id('RoomPollFailed'))).toBeNull()
  })

  test('nothing is said in a room with no posts, where pull to refresh is the way to try again', async () => {
    mockPollFailed = true
    const sample = createSampleRoomsService()
    jest.spyOn(sample, 'listNotes').mockResolvedValue({
      notes: [],
      complete: true,
      check: { verdict: 'consistent', detail: '' },
    })
    mockService = sample
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(id('RoomPostsNone'))).toBeTruthy())
    expect(tree.queryByTestId(id('RoomPollFailed'))).toBeNull()
  })
})
