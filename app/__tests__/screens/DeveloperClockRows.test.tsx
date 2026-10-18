/**
 * The gate's linkwait legs read the clocks in force from four rows on the Developer screen (bifold E2EClockRows). This
 * app shows its own Developer screen in place of bifold's, so it renders them itself: in a test build only (E2E_CLOCKS
 * set, to short or real), never in a store build, which never sets it (the staging workflow refuses it).
 */
import { AuthProvider } from '@bifold/core'
import { render } from '@testing-library/react-native'
import React from 'react'
import Config from 'react-native-config'

import Developer from '../../src/screens/Developer'
import { BasicAppContext } from '../../__mocks__/helpers/app'

jest.mock('react-native-config', () => ({ __esModule: true, default: {} }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => jest.fn(),
}))

const config = Config as Record<string, string | undefined>
const ROWS = ['E2EClocksMode', 'E2EGrantWindowSeconds', 'E2EPhoneGrantWindowSeconds', 'E2EAutoLockMinutes']
const id = (key: string) => `com.ariesbifold:id/${key}`
/** A row's text, as the app's tests read it (the jest-native matchers have no types here). */
const textOf = (tree: ReturnType<typeof show>, key: string) => String(tree.getByTestId(id(key)).props.children)
const show = () =>
  render(
    <BasicAppContext>
      <AuthProvider>
        <Developer />
      </AuthProvider>
    </BasicAppContext>
  )

describe("the app's Developer screen and the e2e clock rows", () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => null)
  })
  afterEach(() => {
    delete config.E2E_CLOCKS
    jest.restoreAllMocks()
  })

  test('a store build (E2E_CLOCKS unset) shows no clock rows', () => {
    const tree = show()
    for (const key of ROWS) expect(tree.queryByTestId(id(key))).toBeNull()
  })

  test('a short-clock test build shows the short clocks, under the testIDs the gate reads', () => {
    config.E2E_CLOCKS = 'short'
    const tree = show()
    expect(textOf(tree, 'E2EClocksMode')).toBe('short')
    expect(textOf(tree, 'E2EGrantWindowSeconds')).toBe('60')
    expect(textOf(tree, 'E2EPhoneGrantWindowSeconds')).toBe('60')
    expect(textOf(tree, 'E2EAutoLockMinutes')).toBe('0.5')
  })

  test('a real-clocks test build shows the real clocks', () => {
    config.E2E_CLOCKS = 'real'
    const tree = show()
    expect(textOf(tree, 'E2EClocksMode')).toBe('real')
    expect(textOf(tree, 'E2EGrantWindowSeconds')).toBe('600')
    expect(textOf(tree, 'E2EAutoLockMinutes')).toBe('5')
  })
})
