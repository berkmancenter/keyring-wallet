/**
 * A room hidden from Messages says so where the member looks for it, its row in the Rooms list: Messages no longer
 * shows it, and its Room info has the way back (tester feedback, 11-02).
 */
import { render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { RoomRow } from '../components/RoomRow'
import { toInertText } from '../inertText'
import type { RoomSummary } from '../types'

let mockHidden = false
jest.mock('../useRoomRows', () => ({ useRoomHidden: () => mockHidden }))

const ROOM: RoomSummary = {
  roomId: 'did:webvh:r:planning',
  name: toInertText('Planning'),
  nameFrom: 'community',
  source: 'community',
  communityDid: 'did:webvh:c',
  communityName: toInertText('Keyring Lab'),
  tier: 'attributed',
  standing: 'member',
  validUntil: '2027-01-30T00:00:00Z',
}

const row = () =>
  render(
    <BasicAppContext>
      <RoomRow room={ROOM} onPress={() => undefined} />
    </BasicAppContext>
  ).getByTestId(testIdWithKey('RoomRow_hrplanning'))

describe('a room hidden from Messages, in the Rooms list', () => {
  test('its row says it is hidden, after where the member stands (control: not hidden, not said)', () => {
    expect(row()).not.toHaveTextContent(/Rooms\.HiddenFromMessages/)
    mockHidden = true
    expect(row()).toHaveTextContent(/Rooms\.Until.*Rooms\.HiddenFromMessages/)
  })
})
