/**
 * The way into My devices (own_agent_subtask.md §4), as a card of its own and
 * not a link inside another: a person looking for "where do I add my other
 * phone" or "remove my lost one" finds it at a glance (decided 2026-09-25,
 * after the first real-device run found the link too easy to miss). Used on
 * My Agent and on the agent screen, with one testID for both.
 *
 * @module trust-tasks/screens/DevicesCard
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

export const DevicesCard: React.FC<{ onPress: () => void }> = ({ onPress }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const styles = StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      backgroundColor: ColorPalette.brand.secondaryBackground,
      borderRadius: 8,
      padding: 16,
    },
    text: { flex: 1, gap: 2 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  return (
    <Pressable
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('Devices.Title')}
      accessibilityHint={t('Devices.CardHint')}
      testID={testIdWithKey('AgentDevices')}
    >
      <Icon name="cellphone-link" size={28} color={ColorPalette.brand.primary} />
      <View style={styles.text}>
        <ThemedText variant="bold">{t('Devices.Title')}</ThemedText>
        <ThemedText style={styles.muted}>{t('Devices.CardHint')}</ThemedText>
      </View>
      <Icon name="chevron-right" size={24} color={ColorPalette.grayscale.mediumGrey} />
    </Pressable>
  )
}
