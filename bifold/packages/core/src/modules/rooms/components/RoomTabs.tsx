/**
 * A room's parts as tabs under its header (data rooms mock): Chat, then the room's library of files, then its notes
 * and members as those land. A plain row of tabs, not a navigator: switching keeps the chat's composer draft and a
 * running download, which a tab navigator's unmounting would drop.
 *
 * The tabs share the row's width equally while their words fit. A word that doesn't fit, at the largest text sizes or
 * in a language with longer words, widens its tab and the row scrolls, so a tab is never cut to "Mem…"; the selected
 * tab is scrolled into view.
 *
 * @module rooms/components/RoomTabs
 */
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

export type RoomTab = 'chat' | 'files' | 'notes' | 'members'

const LABEL: Record<RoomTab, string> = {
  chat: 'Rooms.Chat',
  files: 'Rooms.Files',
  notes: 'Rooms.Notes',
  members: 'Rooms.Members',
}
const TEST_ID: Record<RoomTab, string> = {
  chat: 'RoomTabChat',
  files: 'RoomTabFiles',
  notes: 'RoomTabNotes',
  members: 'RoomTabMembers',
}
const ROW_PADDING = 8

type Place = { x: number; width: number }

export const RoomTabs: React.FC<{ tabs: RoomTab[]; selected: RoomTab; onSelect: (tab: RoomTab) => void }> = ({
  tabs,
  selected,
  onSelect,
}) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const [rowWidth, setRowWidth] = useState(0)
  const scroll = useRef<ScrollView>(null)
  const contentWidth = useRef(0)
  const places = useRef<Partial<Record<RoomTab, Place>>>({})

  // Centre the selected tab where the row scrolls, within the row's ends.
  useEffect(() => {
    const place = places.current[selected]
    if (!place || !rowWidth) return
    const end = Math.max(0, contentWidth.current - rowWidth)
    const x = Math.min(end, Math.max(0, place.x - (rowWidth - place.width) / 2))
    scroll.current?.scrollTo({ x, animated: true })
  }, [selected, rowWidth])

  const styles = StyleSheet.create({
    // A ScrollView may shrink, a View may not: without flexShrink 0 a tall tab below (Members at large text) squeezed
    // the row's height and cut its words through.
    row: {
      flexGrow: 0,
      flexShrink: 0,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: ColorPalette.grayscale.lightGrey,
    },
    content: { flexGrow: 1, paddingHorizontal: ROW_PADDING },
    // An equal share of the row is each tab's least width, not its width: a longer word widens its tab.
    tab: {
      flexGrow: 1,
      minWidth: rowWidth ? (rowWidth - 2 * ROW_PADDING) / tabs.length : undefined,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
    },
    on: { borderBottomWidth: 2, borderBottomColor: ColorPalette.brand.primary },
    label: { color: ColorPalette.grayscale.mediumGrey },
    onLabel: { color: ColorPalette.brand.primary, fontWeight: '600' },
  })
  return (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.row}
      contentContainerStyle={styles.content}
      onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
      onContentSizeChange={(width) => {
        contentWidth.current = width
      }}
      accessibilityRole="tablist"
      testID={testIdWithKey('RoomTabs')}
    >
      {tabs.map((tab) => {
        const on = tab === selected
        return (
          <Pressable
            key={tab}
            style={[styles.tab, on ? styles.on : undefined]}
            onPress={() => onSelect(tab)}
            onLayout={(e) => {
              places.current[tab] = e.nativeEvent.layout
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            testID={testIdWithKey(TEST_ID[tab])}
          >
            <ThemedText style={on ? styles.onLabel : styles.label} numberOfLines={1} maxFontSizeMultiplier={1.6}>
              {t(LABEL[tab])}
            </ThemedText>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

export default RoomTabs
