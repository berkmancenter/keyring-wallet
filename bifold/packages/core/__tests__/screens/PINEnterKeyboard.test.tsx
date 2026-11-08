import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { container } from 'tsyringe'
import { AccessibilityInfo, Keyboard, StyleSheet, type ViewStyle } from 'react-native'

import { KEEP_VISIBLE } from '../../src/components/views/KeyboardPaddedView'
import { ContainerProvider } from '../../src/container-api'
import { MainContainer } from '../../src/container-impl'
import { AuthContext } from '../../src/contexts/auth'
import { StoreProvider, defaultState } from '../../src/contexts/store'
import PINEnter from '../../src/screens/PINEnter'
import { testIdWithKey } from '../../src/utils/testable'
import authContext from '../contexts/auth'

// IN-525 showed iOS can report the keyboard so that React Native's
// KeyboardAvoidingView pads a view by its whole height (plus its offset). The
// PIN screens sit in the shared KeyboardView, whose offset is the header height
// or 100 without one: the same report would hide the PIN entry and lock
// someone out of the app.

const VIEW_HEIGHT = 795
const KEYBOARD_HEIGHT = 336

// The view that pads for the keyboard: the nearest ancestor of Enter that fills its parent and has a bottom padding.
const spacerOf = (node: ReturnType<ReturnType<typeof render>['getByTestId']>) => {
  let at = node.parent
  while (at) {
    const style = StyleSheet.flatten(at.props.style) as ViewStyle | undefined
    if (typeof at.type === 'string' && style?.flex === 1 && style.paddingBottom !== undefined) return at
    at = at.parent
  }
  throw new Error('no keyboard spacer above Enter')
}

describe('the PIN screen when the keyboard opens', () => {
  beforeEach(() => {
    ;(Keyboard.addListener as jest.Mock).mockClear()
    jest.spyOn(AccessibilityInfo, 'prefersCrossFadeTransitions').mockResolvedValue(false)
  })
  afterEach(() => jest.restoreAllMocks())

  const open = () => {
    const main = new MainContainer(container.createChildContainer()).init()
    return render(
      <ContainerProvider value={main}>
        <StoreProvider initialState={{ ...defaultState }}>
          <AuthContext.Provider value={authContext}>
            <PINEnter setAuthenticated={jest.fn()} />
          </AuthContext.Provider>
        </StoreProvider>
      </ContainerProvider>
    )
  }
  const layOut = async (tree: ReturnType<typeof render>) => {
    const spacer = spacerOf(await tree.findByTestId(testIdWithKey('Enter')))
    await act(async () => {
      fireEvent(spacer, 'layout', {
        persist: () => undefined,
        nativeEvent: { layout: { x: 0, y: 0, width: 430, height: VIEW_HEIGHT } },
      })
    })
  }
  // The keyboard as IN-525's and IN-551's phone reports it: its top edge at the top of the screen.
  const reportKeyboardAtTop = async () => {
    const willShow = (Keyboard.addListener as jest.Mock).mock.calls
      .filter(([name]) => name === 'keyboardWillShow')
      .map(([, listener]) => listener)
    expect(willShow.length).toBeGreaterThan(0)
    await act(async () => {
      for (const listener of willShow)
        await listener({
          duration: 250,
          easing: 'keyboard',
          endCoordinates: { screenX: 0, screenY: 0, width: 430, height: KEYBOARD_HEIGHT },
          startCoordinates: { screenX: 0, screenY: 932, width: 430, height: KEYBOARD_HEIGHT },
          isEventFromThisApp: true,
        })
    })
  }
  const expectPinEntryInSight = (tree: ReturnType<typeof render>) => {
    const padding = (StyleSheet.flatten(spacerOf(tree.getByTestId(testIdWithKey('Enter'))).props.style) as ViewStyle)
      .paddingBottom as number
    expect(padding).toBeGreaterThan(0)
    expect(padding).toBeLessThanOrEqual(KEYBOARD_HEIGHT)
    expect(VIEW_HEIGHT - padding).toBeGreaterThanOrEqual(KEEP_VISIBLE)
  }

  it('a keyboard reported at the top of the screen leaves the PIN entry in sight', async () => {
    const tree = open()
    await layOut(tree)
    await reportKeyboardAtTop()
    expectPinEntryInSight(tree)
  })

  // IN-551: after the app has been closed a while, the PIN screen opened blank every time; a quick reopen usually
  // didn't. A cold start can bring the keyboard's report before the screen has laid itself out.
  it('and so it does when that report comes before the screen has laid itself out (a cold start)', async () => {
    const tree = open()
    // Keep this wait: until the screen has mounted, its keyboard listener isn't subscribed, so the report below would
    // reach no one and the row would pass without testing the order.
    await tree.findByTestId(testIdWithKey('Enter'))
    await reportKeyboardAtTop()
    await layOut(tree)
    expectPinEntryInSight(tree)
  })
})
