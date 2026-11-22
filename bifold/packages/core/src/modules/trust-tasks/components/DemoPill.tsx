/**
 * The small "Demo" pill shown beside a made-up state's name (stateRoots.ts, `demo: true`), so a demo or test state can
 * never read as a real one. It is shown only for a root this phone's own list marks as demo, never from the card's
 * word or the name. For a root the list marks `test` (the K0 preload) it reads "Test" on a filled grey ground instead
 * (Alberto, 2026-11-13), so the Developer test card can never pass for the state office's demo card.
 *
 * @module trust-tasks/components/DemoPill
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

export const DemoPill: React.FC<{ testID: string; test?: boolean }> = ({ testID, test }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const styles = StyleSheet.create({
    pill: {
      alignSelf: 'flex-start',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.mediumGrey,
      paddingHorizontal: 8,
      paddingVertical: 1,
      ...(test ? { backgroundColor: ColorPalette.grayscale.mediumGrey } : {}),
    },
    text: { fontSize: 12, color: test ? ColorPalette.grayscale.white : ColorPalette.grayscale.mediumGrey },
  })
  return (
    <View style={styles.pill} testID={testIdWithKey(testID)}>
      <ThemedText style={styles.text}>{t(test ? 'Approver.TestPill' : 'Approver.DemoPill')}</ThemedText>
    </View>
  )
}

export default DemoPill
