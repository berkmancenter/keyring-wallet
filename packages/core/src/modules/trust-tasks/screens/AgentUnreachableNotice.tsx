/**
 * A step that needs a persona's keys while the agent is away
 * (new-phone-new-device-plan.md §C, "Offline"): the keys stay with the agent
 * and this phone borrows them only while the app is open, so a step that
 * signs or decrypts before they are borrowed waits for it. Nothing is
 * queued; the step's own button is disabled while this shows, and it
 * carries on once the agent is back.
 *
 * @module trust-tasks/screens/AgentUnreachableNotice
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

export const AgentUnreachableNotice: React.FC<{
  state: 'ready' | 'agentUnreachable'
  onRetry: () => void
}> = ({ state, onRetry }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  if (state === 'ready') return null

  const styles = StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 12 },
  })

  return (
    <View style={styles.card} testID={testIdWithKey('AgentUnreachable')} accessibilityRole="alert">
      <ThemedText>{t('AgentKeys.Unreachable')}</ThemedText>
      <Button
        title={t('AgentKeys.TryAgain')}
        buttonType={ButtonType.Secondary}
        onPress={onRetry}
        testID={testIdWithKey('AgentUnreachableRetry')}
      />
    </View>
  )
}
