/**
 * The composer stays above the keyboard. Its view is keyboard-controller's, which lifts on both platforms, and its
 * offset is where its parent starts on screen, measured: on iOS 26 the header height a screen is told is the status bar
 * alone, and the composer sat under the keyboard (simulator, iPhone 17). The measurement itself is tested with its
 * hook (trust-tasks keyboardOffset.test.ts).
 */
import { render, waitFor, within } from '@testing-library/react-native'
import React from 'react'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { RoomsService } from '../types'

const HEADER_TOLD = 62
const MEASURED = 106

let mockService: RoomsService | undefined
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => HEADER_TOLD }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useRoute: () => ({ params: { roomId: 'did:webvh:sample:planning' } }),
}))
jest.mock('../../trust-tasks/screens/keyboardOffset', () => ({
  useMeasuredKeyboardOffset: () => ({ ref: { current: null }, onLayout: jest.fn(), offset: MEASURED }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Room = require('../screens/Room').default

beforeEach(() => {
  mockService = createSampleRoomsService()
})

test('the composer is inside a view that lifts it on both platforms, by the measured offset', async () => {
  const tree = render(
    <BasicAppContext>
      <Room />
    </BasicAppContext>
  )
  await waitFor(() => tree.getByTestId(testIdWithKey('RoomComposer')))
  // (The jest mock draws keyboard-controller's view as a View: find it by type, then by what it holds.)
  const avoiding = tree
    .UNSAFE_getAllByType(KeyboardAvoidingView)
    .find((v) => within(v).queryByTestId(testIdWithKey('RoomComposer')))
  expect(avoiding).toBeTruthy()
  expect(avoiding!.props.behavior).toBe('padding')
  expect(avoiding!.props.keyboardVerticalOffset).toBe(MEASURED)
})
