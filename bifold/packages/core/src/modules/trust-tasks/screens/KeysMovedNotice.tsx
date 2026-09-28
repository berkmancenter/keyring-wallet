/**
 * The one-time notice on an upgraded phone (new-phone-new-device-plan.md §E):
 * this phone used to keep its own copies of the persona keys, and no longer
 * does. Copies already on old backups or other phones can't be recalled, so
 * it points to My devices, where changing the agent's keys makes them useless.
 * Shown once, after the move; while the move runs, it says so.
 *
 * @module trust-tasks/screens/KeysMovedNotice
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

export const KeysMovedNotice: React.FC<{
  migration: 'notNeeded' | 'inProgress' | 'done'
  /** The person has already read it. */
  seen: boolean
  onOk: () => void
  onDevices: () => void
}> = ({ migration, seen, onOk, onDevices }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  if (migration === 'notNeeded' || (migration === 'done' && seen)) return null

  const styles = StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 12 },
    actions: { flexDirection: 'row', gap: 12 },
    action: { flex: 1 },
  })

  return (
    <View style={styles.card} testID={testIdWithKey('KeysMoved')}>
      {migration === 'inProgress' ? (
        <ThemedText>{t('AgentKeys.Moving')}</ThemedText>
      ) : (
        <>
          <ThemedText variant="bold" accessibilityRole="header">
            {t('AgentKeys.MovedTitle')}
          </ThemedText>
          <ThemedText>{t('AgentKeys.MovedBody')}</ThemedText>
          <View style={styles.actions}>
            <View style={styles.action}>
              <Button
                title={t('AgentKeys.MovedDevices')}
                buttonType={ButtonType.Secondary}
                onPress={onDevices}
                testID={testIdWithKey('KeysMovedDevices')}
              />
            </View>
            <View style={styles.action}>
              <Button
                title={t('AgentKeys.MovedOk')}
                buttonType={ButtonType.Secondary}
                onPress={onOk}
                testID={testIdWithKey('KeysMovedOk')}
              />
            </View>
          </View>
        </>
      )}
    </View>
  )
}
