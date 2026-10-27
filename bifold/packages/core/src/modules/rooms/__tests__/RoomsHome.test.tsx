/**
 * Rooms: with the sample service, the "Sample data" banner and the rooms; with the rooms flag off (no
 * service), a line saying rooms are off and no list.
 */
import { render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { RoomsService } from '../types'

let mockService: RoomsService | undefined
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RoomsHome = require('../screens/RoomsHome').default

const show = () =>
  render(
    <BasicAppContext>
      <RoomsHome />
    </BasicAppContext>
  )

beforeEach(() => {
  mockService = undefined
})

describe('Rooms', () => {
  test('on sample data: the banner, then the rooms across communities', async () => {
    mockService = createSampleRoomsService()
    const tree = show()
    expect(tree.getByTestId(testIdWithKey('RoomsSampleDataBanner'))).toBeTruthy()
    await waitFor(() => expect(tree.getByText('Planning')).toBeTruthy())
    expect(tree.getByText('Rooms.CommunityNotKnown')).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('RoomsOff'))).toBeNull()
  })

  test('rooms flag off: says so, with no list and no banner (control above)', () => {
    const tree = show()
    expect(tree.getByTestId(testIdWithKey('RoomsOff'))).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('RoomsSampleDataBanner'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('RoomsReading'))).toBeNull()
  })
})
