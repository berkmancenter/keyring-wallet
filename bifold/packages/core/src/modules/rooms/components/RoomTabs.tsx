/**
 * A room's parts as tabs under its header (data rooms mock): Chat, then the room's library of files, then its notes
 * and members as those land. A plain row of tabs, not a navigator: switching keeps the chat's composer draft and a
 * running download, which a tab navigator's unmounting would drop.
 *
 * @module rooms/components/RoomTabs
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

export type RoomTab = 'chat' | 'files'

const LABEL: Record<RoomTab, string> = { chat: 'Rooms.Chat', files: 'Rooms.Files' }
const TEST_ID: Record<RoomTab, string> = { chat: 'RoomTabChat', files: 'RoomTabFiles' }

export const RoomTabs: React.FC<{ tabs: RoomTab[]; selected: RoomTab; onSelect: (tab: RoomTab) => void }> = ({
  tabs,
  selected,
  onSelect,
}) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const styles = StyleSheet.create({
    row: {
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: ColorPalette.grayscale.lightGrey,
      paddingHorizontal: 8,
    },
    tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
    on: { borderBottomWidth: 2, borderBottomColor: ColorPalette.brand.primary },
    label: { color: ColorPalette.grayscale.mediumGrey },
    onLabel: { color: ColorPalette.brand.primary, fontWeight: '600' },
  })
  return (
    <View style={styles.row} accessibilityRole="tablist" testID={testIdWithKey('RoomTabs')}>
      {tabs.map((tab) => {
        const on = tab === selected
        return (
          <Pressable
            key={tab}
            style={[styles.tab, on ? styles.on : undefined]}
            onPress={() => onSelect(tab)}
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
    </View>
  )
}

export default RoomTabs
