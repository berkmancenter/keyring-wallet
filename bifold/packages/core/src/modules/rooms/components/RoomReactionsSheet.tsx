/**
 * Who reacted to a post, opened from its chips: each value once and whole, since a chip cuts a long one short, with the
 * people who chose it. A value is plain text from another member, so a web address here is words and can't be opened.
 * The list scrolls, so Close stays on screen at any text size.
 *
 * @module rooms/components/RoomReactionsSheet
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

export interface RoomReactionRow {
  value: string
  /** Who chose it, in the words the room uses for them. */
  names: string[]
}

export const RoomReactionsSheet: React.FC<{
  rows: readonly RoomReactionRow[] | undefined
  onClose: () => void
}> = ({ rows, onClose }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { top } = useSafeAreaInsets()
  const styles = StyleSheet.create({
    layout: { flex: 1, justifyContent: 'flex-end' },
    sheet: {
      flexShrink: 1,
      backgroundColor: ColorPalette.brand.primaryBackground,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 12,
      gap: 12,
    },
    list: { flexShrink: 1 },
    row: { paddingVertical: 10, gap: 2, borderTopWidth: 1, borderTopColor: ColorPalette.grayscale.lightGrey },
    first: { borderTopWidth: 0 },
    value: { fontWeight: '600' },
    names: { color: ColorPalette.grayscale.mediumGrey, fontSize: 16 },
  })
  return (
    <Modal visible={!!rows} transparent animationType="fade" onRequestClose={onClose}>
      {/*
       * At the largest text the sheet reaches the top of the screen: it stops at the safe area, clear of the camera. By
       * the inset's value: a SafeAreaView inside a Modal didn't apply it (render, iPhone 17, largest text).
       */}
      <View style={[styles.layout, { paddingTop: top }]} testID={testIdWithKey('RoomReactionsLayout')}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 0, 0, 0.35)' }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('Global.Close') as string}
          testID={testIdWithKey('RoomReactionsBackdrop')}
        />
        <SafeAreaView edges={['bottom']} style={styles.sheet} testID={testIdWithKey('RoomReactionsSheet')}>
          <ThemedText variant="headingFour" accessibilityRole="header">
            {t('Rooms.ReactionsTitle')}
          </ThemedText>
          <ScrollView style={styles.list} testID={testIdWithKey('RoomReactionsList')}>
            {(rows ?? []).map((row, index) => (
              <View key={row.value} style={[styles.row, index === 0 && styles.first]}>
                <ThemedText style={styles.value} testID={testIdWithKey('RoomReactionsValue')}>
                  {row.names.length > 1 ? `${row.value} ${row.names.length}` : row.value}
                </ThemedText>
                <ThemedText style={styles.names}>{row.names.join(', ')}</ThemedText>
              </View>
            ))}
          </ScrollView>
          <Button
            title={t('Global.Close')}
            accessibilityLabel={t('Global.Close')}
            buttonType={ButtonType.Secondary}
            onPress={onClose}
            testID={testIdWithKey('RoomReactionsClose')}
          />
        </SafeAreaView>
      </View>
    </Modal>
  )
}

export default RoomReactionsSheet
