/**
 * The small "Demo" pill shown beside a made-up state's name (stateRoots.ts, `demo: true`), so a demo or test state can
 * never read as a real one. It is shown only for a root this phone's own list marks as demo, never from the card's
 * word or the name.
 *
 * @module trust-tasks/components/DemoPill
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

export const DemoPill: React.FC<{ testID: string }> = ({ testID }) => {
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
    },
    text: { fontSize: 12, color: ColorPalette.grayscale.mediumGrey },
  })
  return (
    <View style={styles.pill} testID={testIdWithKey(testID)}>
      <ThemedText style={styles.text}>{t('Approver.DemoPill')}</ThemedText>
    </View>
  )
}

export default DemoPill
