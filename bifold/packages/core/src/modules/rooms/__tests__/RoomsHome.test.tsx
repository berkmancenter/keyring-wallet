/**
 * Rooms: with the sample service, the "Sample data" banner and the rooms; with the rooms flag off (no
 * service), a line saying rooms are off and no list. An offer opens its consent screen, and coming back to the
 * list reads it again.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { RoomsService } from '../types'

let mockService: RoomsService | undefined
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
let mockFocused = true
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useIsFocused: () => mockFocused,
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RoomsHome = require('../screens/RoomsHome').default

const show = () =>
  render(
    <BasicAppContext>
      <RoomsHome />
    </BasicAppContext>
  )

// The mock's one navigation object, the same one the screen gets.
const navigation = jest.requireMock('@react-navigation/native').useNavigation() as { navigate: jest.Mock }

beforeEach(() => {
  mockService = undefined
  mockFocused = true
  navigation.navigate.mockClear()
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

  test('an offer opens its consent screen, named by its offerRef', async () => {
    mockService = createSampleRoomsService()
    const tree = show()
    const row = await waitFor(() => tree.getByTestId(testIdWithKey('RoomOfferRow_o1')))
    fireEvent.press(row)
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.RoomOffer, { offerRef: 'o1' })
  })

  test('coming back reads the list again; staying focused does not', async () => {
    mockService = createSampleRoomsService()
    const listOffers = jest.spyOn(mockService, 'listOffers')
    const tree = show()
    await waitFor(() => expect(tree.getByTestId(testIdWithKey('RoomOfferRow_o1'))).toBeTruthy())
    tree.rerender(
      <BasicAppContext>
        <RoomsHome />
      </BasicAppContext>
    )
    expect(listOffers).toHaveBeenCalledTimes(1)
    // Away (the offer screen hid the offer), then back.
    mockFocused = false
    tree.rerender(
      <BasicAppContext>
        <RoomsHome />
      </BasicAppContext>
    )
    await mockService.hideOffer('o1')
    mockFocused = true
    await act(async () => {
      tree.rerender(
        <BasicAppContext>
          <RoomsHome />
        </BasicAppContext>
      )
    })
    await waitFor(() => expect(tree.queryByTestId(testIdWithKey('RoomOfferRow_o1'))).toBeNull())
    expect(listOffers).toHaveBeenCalledTimes(2)
  })
})
