/**
 * A room's parts as tabs under its header (data rooms mock): Chat, then the room's library of files, then its notes
 * and members as those land. A plain row of tabs, not a navigator: switching keeps the chat's composer draft and a
 * running download, which a tab navigator's unmounting would drop.
 *
 * The tabs share the row's width equally while their words fit. A word that doesn't fit, at the largest text sizes or
 * in a language with longer words, widens its tab and the row scrolls, so a tab is never cut to "Mem…". Where the row
 * scrolls, a fade at an edge shows there are more tabs that way, and the selected tab is scrolled into view.
 *
 * @module rooms/components/RoomTabs
 */
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dimensions, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

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
const FADE = 32

type Place = { x: number; width: number }
type Edges = { left: boolean; right: boolean }

const fadeStyle = StyleSheet.create({ fade: { position: 'absolute', top: 0, bottom: 0, width: FADE } })

/** Fades the row into the background at one edge, over the tabs that run past it. */
const EdgeFade: React.FC<{ side: 'left' | 'right'; color: string }> = ({ side, color }) => (
  <View
    pointerEvents="none"
    style={[fadeStyle.fade, side === 'left' ? { left: 0 } : { right: 0 }]}
    testID={testIdWithKey(side === 'left' ? 'RoomTabsMoreLeft' : 'RoomTabsMoreRight')}
  >
    <Svg width={FADE} height="100%">
      <Defs>
        <LinearGradient id={`roomTabsFade-${side}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor={color} stopOpacity={side === 'left' ? 1 : 0} />
          <Stop offset="100%" stopColor={color} stopOpacity={side === 'left' ? 0 : 1} />
        </LinearGradient>
      </Defs>
      <Rect width={FADE} height="100%" fill={`url(#roomTabsFade-${side})`} />
    </Svg>
  </View>
)

export const RoomTabs: React.FC<{ tabs: RoomTab[]; selected: RoomTab; onSelect: (tab: RoomTab) => void }> = ({
  tabs,
  selected,
  onSelect,
}) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  // The window's width until the row is measured: the row spans the screen, so the tabs open at their shares rather
  // than at their words' widths and then jump.
  const [rowWidth, setRowWidth] = useState(() => Dimensions.get('window').width)
  const [contentWidth, setContentWidth] = useState(0)
  // Bumped as each tab is measured: a tab's place may be known only after the row's width is.
  const [placed, setPlaced] = useState(0)
  const [edges, setEdges] = useState<Edges>({ left: false, right: false })
  const scroll = useRef<ScrollView>(null)
  const sizes = useRef({ x: 0, row: rowWidth, content: 0 })
  const places = useRef<Partial<Record<RoomTab, Place>>>({})

  const showEdges = (next: Partial<typeof sizes.current>) => {
    const { x, row, content } = Object.assign(sizes.current, next)
    const more = { left: x > 1, right: x + row < content - 1 }
    setEdges((now) => (now.left === more.left && now.right === more.right ? now : more))
  }

  // Centre the selected tab where the row scrolls, within the row's ends.
  useEffect(() => {
    const place = places.current[selected]
    if (!place || !rowWidth) return
    const end = Math.max(0, contentWidth - rowWidth)
    const x = Math.min(end, Math.max(0, place.x - (rowWidth - place.width) / 2))
    scroll.current?.scrollTo({ x, animated: true })
  }, [selected, rowWidth, contentWidth, placed])

  const styles = StyleSheet.create({
    // A ScrollView may shrink, a View may not: without flexShrink 0 a tall tab below (Members at large text) squeezed
    // the row's height and cut its words through.
    bar: {
      flexShrink: 0,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: ColorPalette.grayscale.lightGrey,
    },
    row: { flexGrow: 0 },
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
    <View style={styles.bar} testID={testIdWithKey('RoomTabs')}>
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.row}
        contentContainerStyle={styles.content}
        onLayout={(e) => {
          setRowWidth(e.nativeEvent.layout.width)
          showEdges({ row: e.nativeEvent.layout.width })
        }}
        onContentSizeChange={(width) => {
          setContentWidth(width)
          showEdges({ content: width })
        }}
        onScroll={(e) => showEdges({ x: e.nativeEvent.contentOffset.x })}
        scrollEventThrottle={16}
        accessibilityRole="tablist"
        testID={testIdWithKey('RoomTabsScroll')}
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
                setPlaced((n) => n + 1)
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
      {edges.left ? <EdgeFade side="left" color={ColorPalette.brand.primaryBackground} /> : null}
      {edges.right ? <EdgeFade side="right" color={ColorPalette.brand.primaryBackground} /> : null}
    </View>
  )
}

export default RoomTabs
