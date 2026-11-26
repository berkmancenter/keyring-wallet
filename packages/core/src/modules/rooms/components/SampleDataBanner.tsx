/**
 * "Sample data" across the top of every rooms screen fed by the sample service, so nothing faked is ever
 * mistaken for a real room. Shown exactly when the service says it is the sample; nothing otherwise.
 *
 * @module rooms/components/SampleDataBanner
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { RoomsService } from '../types'

export const SampleDataBanner: React.FC<{ service?: Pick<RoomsService, 'isSample'> }> = ({ service }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  if (!service?.isSample) return null
  const styles = StyleSheet.create({
    banner: {
      backgroundColor: ColorPalette.notification.warn,
      borderColor: ColorPalette.notification.warnBorder,
      borderWidth: 1,
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    text: { color: ColorPalette.notification.warnText, fontWeight: '600' },
  })
  return (
    <View style={styles.banner} accessibilityRole="alert" testID={testIdWithKey('RoomsSampleDataBanner')}>
      <ThemedText style={styles.text}>{t('Rooms.SampleData')}</ThemedText>
    </View>
  )
}

export default SampleDataBanner
