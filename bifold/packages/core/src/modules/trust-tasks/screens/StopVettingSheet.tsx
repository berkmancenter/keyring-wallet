/**
 * "Stop your vetting for <community>?" (row V, frame V4, Alberto 11-17): the confirm for Stop this vetting, from the
 * vetting screen's step 3 and from My Agent's "not finished" card. Stopping forgets the vetting and the identity made
 * for it (`stopVetting`), only while nothing has gone to the community; the sheet says so, and that the vetter is not
 * told by the app. Keep it closes the sheet and changes nothing.
 *
 * @module trust-tasks/screens/StopVettingSheet
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

/** What a Stop that did not stop says (stopVetting's outcome): sent, unreadable (nothing removed), or partial. */
export const STOP_REFUSED_WORDS = {
  sent: 'Vetting.StopAlreadySent',
  unreadable: 'Vetting.StopUnreadable',
  partial: 'Vetting.StopPartial',
} as const

export const StopVettingSheetIds = {
  sheet: 'StopVettingSheet',
  stop: 'StopVettingSheetStop',
  keep: 'StopVettingSheetKeep',
  backdrop: 'StopVettingSheetBackdrop',
} as const

interface Props {
  visible: boolean
  /** The community's name, as the screens show it. */
  community: string
  busy?: boolean
  onStop: () => void
  onKeep: () => void
}

const StopVettingSheet: React.FC<Props> = ({ visible, community, busy, onStop, onKeep }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  if (!visible) return null
  const words = { community, interpolation: { escapeValue: false } }
  const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    backdrop: { flex: 1 },
    safeAreaView: {
      backgroundColor: ColorPalette.brand.modalPrimaryBackground,
      borderTopRightRadius: 20,
      borderTopLeftRadius: 20,
    },
    container: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 20, gap: 12 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  return (
    <SafeAreaModal
      visible
      transparent
      animationType="slide"
      onRequestClose={onKeep}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.overlay}>
        {/* A tap above the sheet keeps the vetting, for sighted use only; a screen reader starts at the title. */}
        <Pressable
          style={styles.backdrop}
          onPress={onKeep}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          testID={testIdWithKey(StopVettingSheetIds.backdrop)}
        />
        <SafeAreaView style={styles.safeAreaView} edges={['bottom']} accessibilityViewIsModal>
          <View style={styles.container} testID={testIdWithKey(StopVettingSheetIds.sheet)}>
            <ThemedText variant="headingFour" accessibilityRole="header">
              {t('Vetting.StopTitle', words)}
            </ThemedText>
            <ThemedText>{t('Vetting.StopBody')}</ThemedText>
            <ThemedText style={styles.muted}>{t('Vetting.StopNote', words)}</ThemedText>
            <Button
              title={t('Vetting.StopVetting')}
              buttonType={ButtonType.Critical}
              onPress={onStop}
              disabled={busy}
              testID={testIdWithKey(StopVettingSheetIds.stop)}
            >
              {busy ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : undefined}
            </Button>
            <Button
              title={t('Vetting.StopKeep')}
              buttonType={ButtonType.Secondary}
              onPress={onKeep}
              disabled={busy}
              testID={testIdWithKey(StopVettingSheetIds.keep)}
            />
          </View>
        </SafeAreaView>
      </View>
    </SafeAreaModal>
  )
}

export default StopVettingSheet
