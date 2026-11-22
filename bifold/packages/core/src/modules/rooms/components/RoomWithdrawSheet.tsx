/**
 * Asked before a member withdraws a message of theirs (frame 9): what everyone in the room will see instead, what
 * happens to its reactions and replies, and that a copy may already have been kept. Withdraw and "Keep it" stay with
 * the words at every text size: the words scroll, the two buttons don't.
 *
 * @module rooms/components/RoomWithdrawSheet
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

export const RoomWithdrawSheet: React.FC<{
  visible: boolean
  onWithdraw: () => void
  onKeep: () => void
}> = ({ visible, onWithdraw, onKeep }) => {
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
    words: { flexShrink: 1 },
    wordsInside: { gap: 10 },
    kept: { color: ColorPalette.grayscale.mediumGrey, fontSize: 16 },
    buttons: { gap: 8 },
  })
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onKeep}>
      {/* Clear of the camera at the largest text, by the inset's value, as RoomReactionsSheet. */}
      <View style={[styles.layout, { paddingTop: top }]} testID={testIdWithKey('RoomWithdrawLayout')}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 0, 0, 0.35)' }]}
          onPress={onKeep}
          accessibilityRole="button"
          accessibilityLabel={t('Rooms.WithdrawKeep') as string}
          testID={testIdWithKey('RoomWithdrawBackdrop')}
        />
        <SafeAreaView edges={['bottom']} style={styles.sheet} testID={testIdWithKey('RoomWithdrawSheet')}>
          <ScrollView style={styles.words} contentContainerStyle={styles.wordsInside}>
            <ThemedText variant="headingFour" accessibilityRole="header">
              {t('Rooms.WithdrawTitle')}
            </ThemedText>
            <ThemedText>
              {t('Rooms.WithdrawWhat', { line: t('Rooms.PostWithdrawn'), interpolation: { escapeValue: false } })}
            </ThemedText>
            <ThemedText style={styles.kept}>{t('Rooms.WithdrawKept')}</ThemedText>
          </ScrollView>
          <View style={styles.buttons}>
            <Button
              title={t('Rooms.WithdrawConfirm')}
              accessibilityLabel={t('Rooms.WithdrawConfirm')}
              buttonType={ButtonType.Critical}
              onPress={onWithdraw}
              testID={testIdWithKey('RoomWithdrawConfirm')}
            />
            <Button
              title={t('Rooms.WithdrawKeep')}
              accessibilityLabel={t('Rooms.WithdrawKeep')}
              buttonType={ButtonType.Secondary}
              onPress={onKeep}
              testID={testIdWithKey('RoomWithdrawKeep')}
            />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  )
}

export default RoomWithdrawSheet
