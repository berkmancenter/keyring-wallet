/**
 * A room's visibility tier as a small badge: Open (the host reads it), Attributed (encrypted; the host sees
 * who posted), Private. Nothing for `unknown`: a room whose details are not loaded is never shown as Open.
 *
 * @module rooms/components/TierBadge
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { RoomSummary } from '../types'

const TIER_KEY = { open: 'Rooms.TierOpen', attributed: 'Rooms.TierAttributed', private: 'Rooms.TierPrivate' } as const

export const TierBadge: React.FC<{ tier: RoomSummary['tier'] }> = ({ tier }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  if (tier === 'unknown') return null
  const styles = StyleSheet.create({
    badge: {
      alignSelf: 'flex-start',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 12,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
  })
  return (
    <View style={styles.badge} testID={testIdWithKey('RoomTier')}>
      <ThemedText variant="caption">{t(TIER_KEY[tier])}</ThemedText>
    </View>
  )
}

export default TierBadge
