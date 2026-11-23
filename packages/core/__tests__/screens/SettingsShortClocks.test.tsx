/**
 * A test build with E2E_CLOCKS=short defaults the auto-lock to half a minute (bifold e2eClocks). Settings reads the
 * lock as minutes, and its choices are whole ones: the row must still say what is in force, no choice may claim to
 * be it, and choosing one saves that whole value, which then wins over the default.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import Config from 'react-native-config'

import { StoreContext } from '../../src/contexts/store'
import { AuthContext } from '../../src/contexts/auth'
import { DispatchAction } from '../../src/contexts/reducers/store'
import Settings from '../../src/screens/Settings'
import { testIdWithKey } from '../../src/utils/testable'
import authContext from '../contexts/auth'
import { testDefaultState } from '../contexts/store'
import { BasicAppContext } from '../helpers/app'

jest.mock('react-native-config', () => ({ __esModule: true, default: {} }))

const config = Config as Record<string, string | undefined>
const OPTIONS = ['OneHour', 'FiveMinutes', 'ThreeMinutes', 'OneMinute', 'Never']

async function show(autoLockTime?: number) {
  const dispatch = jest.fn()
  const state = { ...testDefaultState, preferences: { ...testDefaultState.preferences, autoLockTime } }
  const tree = render(
    <StoreContext.Provider value={[state, dispatch]}>
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

/** The auto-lock choices that show as the one in force (a check beside them). */
function checked(tree: Awaited<ReturnType<typeof show>>['tree']): string[] {
  return OPTIONS.filter(
    (id) => tree.getByTestId(testIdWithKey(`AutoLockTime${id}`)).findAll((n) => n.props.name === 'check').length > 0
  )
}

describe('Settings, in a test build with E2E_CLOCKS=short', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    config.E2E_CLOCKS = 'short'
  })
  afterEach(() => {
    delete config.E2E_CLOCKS
  })

  test('the auto-lock row says 0.5 min, and no whole-minute choice claims to be it', async () => {
    const { tree } = await show()
    const row = tree.getByTestId(testIdWithKey('Lockout'))
    expect(row).toHaveTextContent(/0\.5 min/)
    await act(async () => {
      fireEvent.press(row)
    })
    expect(checked(tree)).toEqual([])
  })

  test('choosing one saves that whole value', async () => {
    const { tree, dispatch } = await show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('Lockout')))
    })
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('AutoLockTimeOneMinute')))
    })
    expect(dispatch).toHaveBeenCalledWith({ type: DispatchAction.AUTO_LOCK_TIME, payload: [1] })
  })

  test('a time the person saved wins over the half-minute default, and shows as chosen', async () => {
    const { tree } = await show(3)
    const row = tree.getByTestId(testIdWithKey('Lockout'))
    expect(row).toHaveTextContent(/3 min/)
    await act(async () => {
      fireEvent.press(row)
    })
    expect(checked(tree)).toEqual(['ThreeMinutes'])
  })

  test('without the switch, the default is the real five minutes', async () => {
    delete config.E2E_CLOCKS
    const { tree } = await show()
    const row = tree.getByTestId(testIdWithKey('Lockout'))
    expect(row).toHaveTextContent(/5 min/)
    await act(async () => {
      fireEvent.press(row)
    })
    expect(checked(tree)).toEqual(['FiveMinutes'])
  })
})
