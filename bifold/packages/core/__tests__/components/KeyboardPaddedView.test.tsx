import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { AccessibilityInfo, Keyboard, StyleSheet, type ViewStyle } from 'react-native'
import { Agent, W3cCredentialRepository } from '@credo-ts/core'

import { KEEP_VISIBLE, keyboardPadding } from '../../src/components/views/KeyboardPaddedView'
import { StoreProvider, defaultReducer } from '../../src/contexts/store'
import EditRCard from '../../src/modules/vrc/screens/EditRCard'
import RCardOnboarding from '../../src/modules/vrc/screens/RCardOnboarding'
import { buildRCardTemplate } from '../../src/modules/vrc/types/rcard'
import * as rCardCredentialService from '../../src/modules/vrc/services/rCardCredential'
import { testIdWithKey } from '../../src/utils/testable'
import { testDefaultState } from '../contexts/store'
import { BasicAppContext } from '../helpers/app'

// IN-525: on a first run, the R-card form's keyboard padding grew as tall as
// the whole view (iPhone 15 Pro Max, iOS 26.7.2): the form vanished, Continue
// was squashed under the header, and the keyboard could not be closed.

// An iPhone 15 Pro Max: 932 points tall; the form sits below a 103-point header, above a 34-point home indicator.
const WINDOW = 932
const FORM = { top: 103, height: 795 }
const KEYBOARD = { screenY: WINDOW - 336, height: 336 }

describe('keyboardPadding', () => {
  it('pads by what the keyboard covers of the view, when iOS reports it truly', () => {
    expect(keyboardPadding(FORM, KEYBOARD, WINDOW)).toBe(FORM.top + FORM.height - KEYBOARD.screenY)
  })

  it('a keyboard top reported at the top of the screen pads by the keyboard, not the whole view', () => {
    expect(keyboardPadding(FORM, { screenY: 0, height: 336 }, WINDOW)).toBe(302)
  })

  it('a keyboard top reported near the top pads no more than the keyboard is tall', () => {
    expect(keyboardPadding(FORM, { screenY: 90, height: 336 }, WINDOW)).toBe(302)
  })

  it('a keyboard reported as tall as the screen still leaves part of the view in sight', () => {
    expect(keyboardPadding(FORM, { screenY: 0, height: WINDOW }, WINDOW)).toBe(FORM.height - KEEP_VISIBLE)
  })

  it('nothing when the keyboard is hidden, off the screen, or not yet laid out', () => {
    expect(keyboardPadding(FORM, undefined, WINDOW)).toBe(0)
    expect(keyboardPadding(FORM, { screenY: WINDOW, height: 336 }, WINDOW)).toBe(0)
    expect(keyboardPadding({ height: 0 }, KEYBOARD, WINDOW)).toBe(0)
  })

  it('a view not yet measured counts as reaching the bottom of the screen', () => {
    expect(keyboardPadding({ height: FORM.height }, KEYBOARD, WINDOW)).toBe(336)
  })

  it('a view measured as reaching below the screen pads no more than the keyboard is tall', () => {
    expect(keyboardPadding({ top: 300, height: FORM.height }, KEYBOARD, WINDOW)).toBe(336)
  })

  it('a view above the keyboard gets no padding', () => {
    expect(keyboardPadding({ top: 0, height: 400 }, KEYBOARD, WINDOW)).toBe(0)
  })
})

const mockRepository = {
  save: jest.fn().mockResolvedValue(undefined),
  findByQuery: jest.fn().mockResolvedValue([]),
} as unknown as W3cCredentialRepository
const mockAgent = {
  dependencyManager: { resolve: jest.fn().mockReturnValue(mockRepository) },
  context: {},
} as unknown as Agent

const profile = buildRCardTemplate({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', organization: '' })

// The form is the same on a first run (onboarding) and for anyone editing their R-card later.
const screens: [string, () => React.ReactElement][] = [
  [
    'on a first run',
    () => (
      <StoreProvider initialState={testDefaultState} reducer={defaultReducer}>
        <BasicAppContext>
          <RCardOnboarding agent={mockAgent} />
        </BasicAppContext>
      </StoreProvider>
    ),
  ],
  [
    'when editing an R-card',
    () => (
      <StoreProvider
        initialState={{
          ...testDefaultState,
          rCard: { profiles: [profile], activeProfileId: profile.id, lastSyncedAt: new Date().toISOString() },
        }}
        reducer={defaultReducer}
      >
        <BasicAppContext>
          <EditRCard
            route={{ key: 'EditRCard', name: 'Edit Profile' as never, params: undefined }}
            navigation={{ goBack: jest.fn(), setOptions: jest.fn() } as never}
          />
        </BasicAppContext>
      </StoreProvider>
    ),
  ],
]

describe('the R-card form when the keyboard opens', () => {
  beforeEach(() => {
    ;(Keyboard.addListener as jest.Mock).mockClear()
    jest.spyOn(rCardCredentialService, 'loadRCardTemplate').mockResolvedValue(undefined)
    jest.spyOn(AccessibilityInfo, 'prefersCrossFadeTransitions').mockResolvedValue(false)
  })
  afterEach(() => jest.restoreAllMocks())

  // The view that pads for the keyboard: the nearest ancestor of Continue that fills its parent and has a bottom padding.
  const spacerOf = (node: ReturnType<ReturnType<typeof render>['getByTestId']>) => {
    let at = node.parent
    while (at) {
      const style = StyleSheet.flatten(at.props.style) as ViewStyle | undefined
      if (typeof at.type === 'string' && style?.flex === 1 && style.paddingBottom !== undefined) return at
      at = at.parent
    }
    throw new Error('no keyboard spacer above Continue')
  }
  const paddingOf = (node: ReturnType<typeof spacerOf>) =>
    (StyleSheet.flatten(node.props.style) as ViewStyle).paddingBottom as number

  it.each(screens)('%s, a keyboard reported at the top of the screen leaves the form in sight', async (_, screen) => {
    const tree = render(screen())
    const spacer = spacerOf(await tree.findByTestId(testIdWithKey('RCardSubmit')))
    await act(async () => {
      fireEvent(spacer, 'layout', {
        persist: () => undefined,
        nativeEvent: { layout: { x: 0, y: 0, width: 430, height: FORM.height } },
      })
    })
    const willShow = (Keyboard.addListener as jest.Mock).mock.calls
      .filter(([name]) => name === 'keyboardWillShow')
      .map(([, listener]) => listener)
    expect(willShow.length).toBeGreaterThan(0)
    await act(async () => {
      for (const listener of willShow)
        await listener({
          duration: 250,
          easing: 'keyboard',
          endCoordinates: { screenX: 0, screenY: 0, width: 430, height: 336 },
          startCoordinates: { screenX: 0, screenY: WINDOW, width: 430, height: 336 },
          isEventFromThisApp: true,
        })
    })
    const padding = paddingOf(spacerOf(tree.getByTestId(testIdWithKey('RCardSubmit'))))
    expect(padding).toBeGreaterThan(0)
    expect(padding).toBeLessThanOrEqual(336)
    expect(FORM.height - padding).toBeGreaterThanOrEqual(KEEP_VISIBLE)
  })
})
