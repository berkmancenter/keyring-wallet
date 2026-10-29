/**
 * A room's tab row at large text sizes: the tabs share the row equally while their words fit, a longer word widens
 * its tab and the row scrolls instead of cutting it to "Mem…", and the selected tab is scrolled into view.
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

describe('RoomTabs', () => {
  test('the row scrolls and keeps its height; while the words fit, each tab takes an equal share, as its least width, not its width', () => {
    const tree = render(show('chat'))
    const row = tree.getByTestId(id('RoomTabs'))
    expect(row.props.horizontal).toBe(true)
    // Its height is never given up to a tall tab below it.
    expect(StyleSheet.flatten(row.props.style).flexShrink).toBe(0)
    act(() => fireEvent(row, 'layout', layout(0, 360)))
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
    const row = tree.getByTestId(id('RoomTabs'))
    const scrollTo = tree.UNSAFE_getByType(ScrollView).instance.scrollTo as jest.Mock
    scrollTo.mockClear()
    // Large text: four words at 160 each in a 360 row, 8 padding at each end.
    act(() => {
      fireEvent(row, 'layout', layout(0, 360))
      fireEvent(row, 'contentSizeChange', 656, 44)
      TAB_ID.forEach((key, i) => fireEvent(tree.getByTestId(id(key)), 'layout', layout(8 + i * 160, 160)))
    })
    tree.rerender(show('notes'))
    // Notes at 328–488, centred: 328 - (360 - 160) / 2
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 228, animated: true })
    tree.rerender(show('members'))
    // Members centred would be 388; the row ends at 656 - 360
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 296, animated: true })
    tree.rerender(show('chat'))
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 0, animated: true })
  })
})
