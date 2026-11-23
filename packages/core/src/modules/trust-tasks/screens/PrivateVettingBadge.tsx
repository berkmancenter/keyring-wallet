/**
 * The one mark for private (hidden) vetting, the same everywhere it applies:
 * the Join way, the applicant's vetting steps, the vetter's request and attest
 * step, and the membership it led to. The flow is the ordinary one; this is
 * how the person can tell it is private (Alberto, 2026-10-15). With `explain`,
 * the one plain line about what private means, said where the mark first
 * appears rather than on every card.
 *
 * @module trust-tasks/screens/PrivateVettingBadge
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import { View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

export const PrivateVettingBadge: React.FC<{
  /** The community it is private from, for the explaining line. */
  community?: string
  /** Say once what private means, under the mark. */
  explain?: boolean
  /** The badge's own words, when a place says it differently ("Joined with private vetting"). */
  label?: string
  /** The testID stem: `<stem>` on the mark, `<stem>Explain` on the line. */
  testIdStem?: string
}> = ({ community, explain = false, label, testIdStem = 'PrivateVettingBadge' }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  return (
    <View style={{ gap: 4 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: 4,
          paddingHorizontal: 8,
          paddingVertical: 2,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: ColorPalette.brand.primary,
        }}
        accessible
        accessibilityLabel={label ?? (t('Vetting.Private.Badge') as string)}
        testID={testIdWithKey(testIdStem)}
      >
        <Icon name="shield-lock-outline" size={14} color={ColorPalette.brand.primary} />
        <ThemedText variant="caption" style={{ color: ColorPalette.brand.primary }}>
          {label ?? t('Vetting.Private.Badge')}
        </ThemedText>
      </View>
      {explain ? (
        <ThemedText
          variant="caption"
          style={{ color: ColorPalette.grayscale.mediumGrey }}
          testID={testIdWithKey(`${testIdStem}Explain`)}
        >
          {t('Vetting.Private.Explain', { community, interpolation: { escapeValue: false } })}
        </ThemedText>
      ) : null}
    </View>
  )
}
