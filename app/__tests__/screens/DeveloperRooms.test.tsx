/**
 * Rooms are on by default from 276, so the app's own Developer screen carries their off switch: in every build, store
 * ones included (this app shows its own Developer screen, never bifold's, where the switch used to be).
 */
import { AuthProvider } from '@bifold/core'
import { fireEvent, render, within } from '@testing-library/react-native'
import React from 'react'
import { Switch } from 'react-native'

import Developer from '../../src/screens/Developer'
import { BasicAppContext } from '../../__mocks__/helpers/app'

jest.mock('react-native-config', () => ({ __esModule: true, default: {} }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => jest.fn(),
}))

const id = (key: string) => `com.ariesbifold:id/${key}`
const show = () =>
  render(
    <BasicAppContext>
      <AuthProvider>
        <Developer />
      </AuthProvider>
    </BasicAppContext>
  )
const roomsSwitch = (tree: ReturnType<typeof show>) =>
  within(tree.getByTestId(id('ToggleFeatureRooms'))).UNSAFE_getByType(Switch)

describe("the app's Developer screen and the rooms switch", () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => null)
  })
  afterEach(() => jest.restoreAllMocks())

  test('a store build (no build settings) shows the rooms switch', () => {
    const tree = show()
    expect(tree.getByTestId(id('ToggleFeatureRooms'))).toBeTruthy()
  })

  test('the switch shows the saved choice and changes it', () => {
    const tree = show()
    const before = roomsSwitch(tree).props.value as boolean
    fireEvent(roomsSwitch(tree), 'valueChange', !before)
    expect(roomsSwitch(tree).props.value).toBe(!before)
  })
})
