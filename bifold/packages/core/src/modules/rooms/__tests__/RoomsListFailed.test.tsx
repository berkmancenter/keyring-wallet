/**
 * When a community's rooms can't be read, the screen names who didn't answer, says it is trying again while it is,
 * and shows the rooms whenever only the offers failed (a tester's 277.4 log, 11-02: "Couldn't reach your agent" on the
 * community's screen while the agent was fine, and a Try again that changed nothing on screen).
 */
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { deriveCapabilities, ROOMS_OPERATIONS, ROOMS_REQUIREMENTS } from '../capabilities'
import { roomHandle } from '../components/RoomRow'
import { RoomsListBody } from '../components/RoomsListBody'
import { toInertText } from '../inertText'
import type { RoomSummary } from '../types'
import type { MyRooms } from '../useMyRooms'

const id = (key: string) => testIdWithKey(key)
const SERVED = Object.values(ROOMS_REQUIREMENTS).flatMap((need) => ('anyOf' in need ? need.anyOf : []))
const capabilities = deriveCapabilities({ agentLinked: true, servedTypes: SERVED, built: new Set(ROOMS_OPERATIONS) })
const room: RoomSummary = {
  roomId: 'did:webvh:r:planning',
  name: toInertText('Planning'),
  nameFrom: 'community',
  source: 'community',
  communityDid: 'did:webvh:c',
  tier: 'open',
  standing: 'member',
}

const rooms = (over: Partial<MyRooms>): MyRooms => ({
  failed: false,
  offersFailed: false,
  failures: 0,
  offersNotShown: '',
  refreshing: false,
  reload: jest.fn(),
  reread: jest.fn(),
  ...over,
})
const show = (myRooms: MyRooms, communityName?: string) =>
  render(
    <BasicAppContext>
      <RoomsListBody myRooms={myRooms} acrossCommunities={false} communityName={communityName} />
    </BasicAppContext>
  )

const UNREACHABLE = { status: 'unavailable', reason: 'communityUnreachable', detail: '' } as const

describe("a community's rooms that couldn't be read", () => {
  test('the community is named, with when its rooms will show; Try again asks again', () => {
    const myRooms = rooms({ failed: true, failures: 1, failure: UNREACHABLE })
    const tree = show(myRooms, 'First VTC')
    expect(tree.getByTestId(id('RoomsReadFailed'))).toHaveTextContent('Rooms.CommunityNotAnswering')
    expect(tree.getByText('Rooms.ShowWhenItAnswers')).toBeTruthy()
    fireEvent.press(tree.getByTestId(id('RoomsTryAgain')))
    expect(myRooms.reload).toHaveBeenCalledTimes(1)
  })

  test('with no name to give (the Rooms list across communities), the reason as before (control)', () => {
    const tree = show(rooms({ failed: true, failures: 1, failure: UNREACHABLE }))
    expect(tree.getByTestId(id('RoomsReadFailed'))).toHaveTextContent('Rooms.CommunityUnreachable')
    expect(tree.queryByText('Rooms.ShowWhenItAnswers')).toBeNull()
  })

  test('while trying again it says so, with no button to tap again (control: the button when not)', () => {
    const tree = show(rooms({ failed: true, failures: 1, failure: UNREACHABLE, refreshing: true }), 'First VTC')
    expect(tree.getByTestId(id('RoomsTryingAgain'))).toHaveTextContent('Rooms.TryingAgain')
    expect(tree.queryByTestId(id('RoomsTryAgain'))).toBeNull()
  })
})

describe('offers that could not be read', () => {
  test('leave the rooms shown, with one quiet line (control: none when they were read)', () => {
    const shown = show(rooms({ capabilities, rooms: [room], offers: [], offersFailed: true }))
    expect(shown.getByTestId(id('RoomOffersFailed'))).toHaveTextContent('Rooms.OffersNotRead')
    expect(shown.getByTestId(id(`RoomRow_${roomHandle(room.roomId)}`))).toBeTruthy()
    const read = show(rooms({ capabilities, rooms: [room], offers: [] }))
    expect(read.queryByTestId(id('RoomOffersFailed'))).toBeNull()
  })
})
