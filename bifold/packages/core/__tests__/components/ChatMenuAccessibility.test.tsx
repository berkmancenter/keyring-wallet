/**
 * The chat header's menu (InfoIcon): iOS treats an accessible element as one, so anything inside it is out of
 * VoiceOver's reach and the e2e driver's. The RC found the menu read as one merged element while its overlay
 * Pressable wrapped the items. The walk is the one the message actions sheet uses (ChatActions.test.tsx).
 */
import { fireEvent, render } from '@testing-library/react-native'
import i18next from 'i18next'
import React from 'react'

import en from '../../src/localization/en/en.json'
import InfoIcon from '../../src/modules/vrc/components/InfoIcon'
import { testIdWithKey } from '../../src/utils/testable'
import { BasicAppContext } from '../helpers/app'

type Node = { parent: Node | null; props: Record<string, unknown> }
// Above the item itself: a touchable is several nodes (host View, Animated View, the touchable), all carrying its
// testID or its own accessible flag, so the walk starts above the outermost node that still carries the testID.
const insideAnAccessibleElement = (node: Node) => {
  let top = node
  while (top.parent && top.parent.props?.testID === node.props.testID) top = top.parent
  for (let at = top.parent; at; at = at.parent) {
    if (at.props?.accessible === true) return true
  }
  return false
}

// The menu opens where its button is, measured first; jest's native methods are bare mocks that never answer, so the
// menu would never open. Answer with a position.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nativeMethods = require('react-native/jest/MockNativeMethods').default
beforeEach(() => {
  nativeMethods.measureInWindow.mockImplementation((answer: (x: number, y: number, w: number, h: number) => void) =>
    answer(300, 40, 44, 44)
  )
})

const id = (key: string) => testIdWithKey(key)
const openMenu = () => {
  const tree = render(
    <BasicAppContext>
      <InfoIcon connectionId="1" />
    </BasicAppContext>
  )
  fireEvent.press(tree.getByTestId(id('ContactMenu')))
  // Opened: a test that never opens the menu would find nothing to check.
  expect(tree.getByTestId(id('ContactMenuDisappearing'))).toBeTruthy()
  return tree
}

test('every menu item is its own element: none sits inside an accessible element', () => {
  const tree = openMenu()
  for (const key of ['ContactMenuDisappearing', 'ContactMenuClearChat', 'ContactMenuRemoveContact']) {
    expect(insideAnAccessibleElement(tree.getByTestId(id(key)) as never)).toBe(false)
  }
})

test('the menu still closes when the overlay behind it is tapped', () => {
  const tree = openMenu()
  fireEvent.press(tree.getByTestId(id('ContactMenuOverlay')))
  expect(tree.queryByTestId(id('ContactMenuDisappearing'))).toBeNull()
})

// The jest mock of react-i18next returns keys, so the label is checked as its key, and the key as what it reads.
test('the overlay says what tapping it does: "Close"', async () => {
  const tree = openMenu()
  const key = tree.getByTestId(id('ContactMenuOverlay')).props.accessibilityLabel
  expect(key).toBe('Global.Close')
  const i18n = i18next.createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: en } } })
  expect(i18n.t(key)).toBe('Close')
})
