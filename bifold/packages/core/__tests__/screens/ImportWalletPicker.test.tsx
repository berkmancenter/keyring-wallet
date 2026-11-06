import { fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { Alert } from 'react-native'
import { pick } from 'react-native-document-picker'

import ImportWallet from '../../src/screens/ImportWallet'
import { testIdWithKey } from '../../src/utils/testable'
import { BasicAppContext } from '../helpers/app'

// IN-537: the Import screen says what to do when the picker hasn't settled.
// The wait is shortened here so the screen can run on real timers.

jest.mock('../../src/screens/importPickerWatch', () => ({
  ...jest.requireActual('../../src/screens/importPickerWatch'),
  IMPORT_PICKER_SLOW_MS: 50,
}))

jest.mock('react-native-document-picker', () => ({
  pick: jest.fn(),
  types: { allFiles: '*/*' },
}))

jest.mock('@bifold/react-hooks', () => ({
  useAgent: jest.fn(() => ({ agent: { isInitialized: true } })),
}))

const pickMock = pick as jest.Mock
const NOTE = testIdWithKey('ImportPickerNotOpened')
const ROW = 'Settings.ImportWalletNoFileSelected'
const pickerError = (code: string) => Object.assign(new Error(code), { code })

const renderScreen = () =>
  render(
    <BasicAppContext>
      <ImportWallet navigation={{}} />
    </BasicAppContext>
  )

describe('ImportWallet: a picker that does not settle', () => {
  let alertSpy: jest.SpyInstance

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => null)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  test('a picker that never settles: the screen shows the note, and no error alert', async () => {
    pickMock.mockImplementation(() => new Promise(() => undefined))
    const { getByText, findByTestId, queryByTestId } = renderScreen()
    expect(queryByTestId(NOTE)).toBeNull()

    fireEvent.press(getByText(ROW))

    expect(await findByTestId(NOTE)).not.toBeNull()
    expect(alertSpy).not.toHaveBeenCalled()
  })

  test("a second tap: the first call's ASYNC_OP_IN_PROGRESS rejection shows no error alert", async () => {
    let rejectFirst: (e: unknown) => void = () => undefined
    pickMock
      .mockImplementationOnce(() => new Promise((_, reject) => (rejectFirst = reject)))
      .mockImplementationOnce(() => {
        rejectFirst(pickerError('ASYNC_OP_IN_PROGRESS'))
        return new Promise(() => undefined)
      })
    const { getByText, findByTestId } = renderScreen()

    fireEvent.press(getByText(ROW))
    fireEvent.press(getByText(ROW))

    expect(await findByTestId(NOTE)).not.toBeNull()
    expect(alertSpy).not.toHaveBeenCalled()
  })

  test('tapping again while the note shows: the note goes, then comes back after its own wait', async () => {
    pickMock.mockImplementation(() => new Promise(() => undefined))
    const { getByText, findByTestId, queryByTestId } = renderScreen()

    fireEvent.press(getByText(ROW))
    expect(await findByTestId(NOTE)).not.toBeNull()

    fireEvent.press(getByText(ROW))
    await waitFor(() => expect(queryByTestId(NOTE)).toBeNull())

    expect(await findByTestId(NOTE)).not.toBeNull()
    expect(pickMock).toHaveBeenCalledTimes(2)
    expect(alertSpy).not.toHaveBeenCalled()
  })

  test('a picker that returns (nothing chosen): no note afterwards, and no alert', async () => {
    pickMock.mockResolvedValue([])
    const { getByText, queryByTestId } = renderScreen()

    fireEvent.press(getByText(ROW))

    await waitFor(() => expect(pickMock).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 150))
    expect(queryByTestId(NOTE)).toBeNull()
    expect(alertSpy).not.toHaveBeenCalled()
  })

  test('control: a real picker error on the current call still shows the error alert, and no note', async () => {
    pickMock.mockRejectedValue(pickerError('INVALID_DATA_RETURNED'))
    const { getByText, queryByTestId } = renderScreen()

    fireEvent.press(getByText(ROW))

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1))
    expect(alertSpy.mock.calls[0][0]).toBe('Error')
    await new Promise((r) => setTimeout(r, 150))
    expect(queryByTestId(NOTE)).toBeNull()
  })
})
