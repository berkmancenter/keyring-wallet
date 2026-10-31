/**
 * The Menu (Settings) in developer mode no longer shows the mediator: its value
 * is a whole invitation URL, and printed beside a row's title it wrapped over
 * many lines and distorted the menu. It lives in Developer options now (the
 * wallet's screen). And no value line on the Menu can do that again: each is
 * one line, shortened in the middle.
 */
import { act, render, within } from '@testing-library/react-native'
import React from 'react'
import { SectionList } from 'react-native'

import { useNavigation as mockedNavigation } from '../../__mocks__/@react-navigation/native'
import { StoreContext } from '../../src/contexts/store'
import Settings from '../../src/screens/Settings'
import { testIdWithKey } from '../../src/utils/testable'
import { testDefaultState } from '../contexts/store'
import { BasicAppContext } from '../helpers/app'
import { AuthContext } from '../../src/contexts/auth'
import authContext from '../contexts/auth'

const MEDIATOR =
  'https://mediator.example.org?c_i=eyJAdHlwZSI6Imh0dHBzOi8vZGlkY29tbS5vcmcvY29ubmVjdGlvbnMvMS4wL2ludml0YXRpb24iLCJAaWQiOiJhYmMifQ'

const show = async (developerModeEnabled: boolean) => {
  const state = {
    ...testDefaultState,
    preferences: { ...testDefaultState.preferences, developerModeEnabled, selectedMediator: MEDIATOR },
  }
  const tree = render(
    <StoreContext.Provider value={[state, () => undefined]}>
      <BasicAppContext>
        <AuthContext.Provider value={authContext}>
          <Settings navigation={mockedNavigation() as never} route={{} as never} />
        </AuthContext.Provider>
      </BasicAppContext>
    </StoreContext.Provider>
  )
  await act(async () => undefined)
  return tree
}

describe('the Menu in developer mode', () => {
  // Read from the rows the list is given, not from what it drew: a SectionList
  // renders only its first rows in a test, so the end of App Settings — where
  // the mediator sat — is never on screen to be found absent.
  test('offers Developer options, and not the mediator, whose URL is in no row', async () => {
    const tree = await show(true)
    const rows = (
      tree.UNSAFE_getByType(SectionList).props.sections as { data: { testID?: string; value?: unknown }[] }[]
    ).flatMap((section) => section.data)
    const ids = rows.map((row) => row.testID)
    expect(ids).toContain(testIdWithKey('DeveloperOptions'))
    expect(ids).toContain(testIdWithKey('Logout'))
    expect(ids).not.toContain(testIdWithKey('ConfigureMediator'))
    expect(rows.some((row) => row.value === MEDIATOR)).toBe(false)
  })
})

describe('a value on the Menu', () => {
  test('is one line, shortened in the middle, however long', async () => {
    const tree = await show(false)
    const value = within(tree.getByTestId(testIdWithKey('Lockout'))).getByText(/^(Never|\d+ min)$/)
    expect(value.props.numberOfLines).toBe(1)
    expect(value.props.ellipsizeMode).toBe('middle')
  })
})
