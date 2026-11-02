/**
 * A room's visibility tier as a small badge: Open (the host reads it), Attributed (encrypted; the host sees
 * who posted), Private. Nothing for `unknown`: a room whose details are not loaded is never shown as Open.
 *
 * An outlined chip in the brand's colour (header B): filled with the screen's own grey, it did not show (276.6).
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
      alignSelf: 'center',
      flexShrink: 0,
      paddingHorizontal: 10,
      paddingVertical: 2,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: ColorPalette.brand.primary,
    },
    words: { fontSize: 13, fontWeight: '700', color: ColorPalette.brand.primary },
  })
  return (
    <View style={styles.badge} testID={testIdWithKey('RoomTier')}>
      <ThemedText variant="caption" style={styles.words}>
        {t(TIER_KEY[tier])}
      </ThemedText>
    </View>
  )
}

export default TierBadge
