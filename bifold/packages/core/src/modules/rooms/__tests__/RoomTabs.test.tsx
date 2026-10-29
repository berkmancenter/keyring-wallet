/**
 * A room's tab row at large text sizes: the tabs share the row equally while their words fit, a longer word widens
 * its tab and the row scrolls instead of cutting it to "Mem…", a fade at an edge shows there are more tabs that way,
 * and the selected tab is scrolled into view, also when it is selected before the tabs are measured.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { ScrollView, StyleSheet } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { type RoomTab, RoomTabs } from '../components/RoomTabs'

const id = (key: string) => testIdWithKey(key)
const TABS: RoomTab[] = ['chat', 'files', 'notes', 'members']
const TAB_ID = ['RoomTabChat', 'RoomTabFiles', 'RoomTabNotes', 'RoomTabMembers']

const show = (selected: RoomTab) => (
  <BasicAppContext>
    <RoomTabs tabs={TABS} selected={selected} onSelect={() => undefined} />
  </BasicAppContext>
)

const layout = (x: number, width: number) => ({ nativeEvent: { layout: { x, y: 0, width, height: 44 } } })

type Tree = ReturnType<typeof render>

// Large text: four words at 160 each in a 360 row, 8 padding at each end, so the content is 656 wide. The tabs'
// places come last, as they may on a device: the row's sizes are known before them.
const measureLarge = (tree: Tree) => {
  const row = tree.getByTestId(id('RoomTabsScroll'))
  act(() => {
    fireEvent(row, 'layout', layout(0, 360))
    fireEvent(row, 'contentSizeChange', 656, 44)
  })
  act(() => {
    TAB_ID.forEach((key, i) => fireEvent(tree.getByTestId(id(key)), 'layout', layout(8 + i * 160, 160)))
  })
  return row
}

describe('RoomTabs', () => {
  test('the row scrolls and keeps its height; while the words fit, each tab takes an equal share, as its least width, not its width', () => {
    const tree = render(show('chat'))
    expect(tree.getByTestId(id('RoomTabsScroll')).props.horizontal).toBe(true)
    // Its height is never given up to a tall tab below it.
    expect(StyleSheet.flatten(tree.getByTestId(id('RoomTabs')).props.style).flexShrink).toBe(0)
    act(() => fireEvent(tree.getByTestId(id('RoomTabsScroll')), 'layout', layout(0, 360)))
    const tab = StyleSheet.flatten(tree.getByTestId(id('RoomTabMembers')).props.style)
    // (360 - 2 × 8 padding) / 4 tabs
    expect(tab.minWidth).toBe(86)
    expect(tab.flexGrow).toBe(1)
    expect(tab.width).toBeUndefined()
    expect(tab.flex).toBeUndefined()
    expect(tree.getByTestId(id('RoomTabMembers')).findByProps({ numberOfLines: 1 })).toBeTruthy()
  })

  test('a selected tab past the edge is scrolled to the middle, never past the row’s end', () => {
    const tree = render(show('chat'))
    const scrollTo = tree.UNSAFE_getByType(ScrollView).instance.scrollTo as jest.Mock
    measureLarge(tree)
    scrollTo.mockClear()
    tree.rerender(show('notes'))
    // Notes at 328–488, centred: 328 - (360 - 160) / 2
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 228, animated: true })
    tree.rerender(show('members'))
    // Members centred would be 388; the row ends at 656 - 360
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 296, animated: true })
    tree.rerender(show('chat'))
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 0, animated: true })
  })

  test('a tab selected before the tabs are measured is scrolled into view once they are', () => {
    const tree = render(show('members'))
    const scrollTo = tree.UNSAFE_getByType(ScrollView).instance.scrollTo as jest.Mock
    scrollTo.mockClear()
    // The row's sizes come first, then the tabs' places: nothing else changes, so their measuring must bring it.
    measureLarge(tree)
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 296, animated: true })
  })

  test('a fade shows at each edge with more tabs past it, and none while every tab fits', () => {
    const tree = render(show('chat'))
    const row = tree.getByTestId(id('RoomTabsScroll'))
    act(() => {
      fireEvent(row, 'layout', layout(0, 360))
      fireEvent(row, 'contentSizeChange', 360, 44)
    })
    expect(tree.queryByTestId(id('RoomTabsMoreLeft'))).toBeNull()
    expect(tree.queryByTestId(id('RoomTabsMoreRight'))).toBeNull()

    measureLarge(tree)
    expect(tree.queryByTestId(id('RoomTabsMoreLeft'))).toBeNull()
    expect(tree.getByTestId(id('RoomTabsMoreRight'))).toBeTruthy()

    act(() => fireEvent.scroll(row, { nativeEvent: { contentOffset: { x: 140, y: 0 } } }))
    expect(tree.getByTestId(id('RoomTabsMoreLeft'))).toBeTruthy()
    expect(tree.getByTestId(id('RoomTabsMoreRight'))).toBeTruthy()

    act(() => fireEvent.scroll(row, { nativeEvent: { contentOffset: { x: 296, y: 0 } } }))
    expect(tree.getByTestId(id('RoomTabsMoreLeft'))).toBeTruthy()
    expect(tree.queryByTestId(id('RoomTabsMoreRight'))).toBeNull()
    // Neither fade takes a touch from the tab under it.
    expect(tree.getByTestId(id('RoomTabsMoreLeft')).props.pointerEvents).toBe('none')
  })
})
