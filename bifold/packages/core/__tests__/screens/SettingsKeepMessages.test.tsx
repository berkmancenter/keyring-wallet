/**
 * Keep messages in Settings (rich-messaging-plan.md §4.6): Forever until the person chooses otherwise, and a shorter
 * period, which deletes messages for good, only after they confirm it.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { Alert } from 'react-native'

import { StoreContext } from '../../src/contexts/store'
import { AuthContext } from '../../src/contexts/auth'
import { DispatchAction } from '../../src/contexts/reducers/store'
import Settings from '../../src/screens/Settings'
import { testIdWithKey } from '../../src/utils/testable'
import authContext from '../contexts/auth'
import { testDefaultState } from '../contexts/store'
import { BasicAppContext } from '../helpers/app'

async function show(keepMessages?: string) {
  const dispatch = jest.fn()
  const state = {
    ...testDefaultState,
    preferences: { ...testDefaultState.preferences, ...(keepMessages ? { keepMessages } : {}) },
  }
  const tree = render(
    <StoreContext.Provider value={[state as never, dispatch]}>
      <BasicAppContext>
        <AuthContext.Provider value={authContext}>
          <Settings navigation={{ navigate: jest.fn() } as any} route={{} as any} />
        </AuthContext.Provider>
      </BasicAppContext>
    </StoreContext.Provider>
  )
  await act(async () => {})
  return { tree, dispatch }
}

const open = async (tree: Awaited<ReturnType<typeof show>>['tree']) => {
  await act(async () => {
    fireEvent.press(tree.getByTestId(testIdWithKey('KeepMessages')))
  })
}

describe('Settings › Keep messages', () => {
  beforeEach(() => jest.spyOn(Alert, 'alert').mockImplementation(() => undefined))
  afterEach(() => jest.restoreAllMocks())

  test('a new install says Forever', async () => {
    const { tree } = await show()
    expect(tree.getByTestId(testIdWithKey('KeepMessages'))).toHaveTextContent(/KeepMessagesOptions\.forever/)
  })

  test('a shorter period asks first, says it deletes for good, and is saved only when confirmed', async () => {
    const { tree, dispatch } = await show()
    await open(tree)
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('KeepMessages_30d')))
    })
    expect(dispatch).not.toHaveBeenCalled()
    expect(Alert.alert).toHaveBeenCalledWith(
      'Settings.KeepMessagesConfirmTitle',
      'Settings.KeepMessagesConfirm',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Settings.KeepMessagesConfirmDelete', style: 'destructive' }),
      ])
    )
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[]
    await act(async () => {
      buttons.find((b) => b.text === 'Settings.KeepMessagesConfirmDelete')?.onPress?.()
    })
    expect(dispatch).toHaveBeenCalledWith({ type: DispatchAction.KEEP_MESSAGES, payload: ['30d'] })
  })

  test('Forever deletes nothing, so it is saved without asking', async () => {
    const { tree, dispatch } = await show('30d')
    await open(tree)
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('KeepMessages_forever')))
    })
    expect(Alert.alert).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith({ type: DispatchAction.KEEP_MESSAGES, payload: ['forever'] })
  })
})
