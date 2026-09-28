/**
 * "Also open as you" (new-phone-new-device-plan.md §F): another device of
 * this agent was seen recently, and two devices acting as one identity share
 * one mediator connection per persona, so messages may reach only one of
 * them. Said once per newly live device, as openvtc does
 * (openvtc-core/src/devices.rs `sibling_warning`); who counts as live and
 * the "once" live with the presence loop, not here.
 *
 * @module trust-tasks/screens/SiblingNotice
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

export const SiblingNotice: React.FC<{ names: string[]; onOpen: () => void; onDismiss: () => void }> = ({
  names,
  onOpen,
  onDismiss,
}) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  if (names.length === 0) return null

  const styles = StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 12 },
    actions: { flexDirection: 'row', gap: 12 },
    action: { flex: 1 },
  })
  const words =
    names.length === 1
      ? t('Devices.SiblingOne', { device: names[0], interpolation: { escapeValue: false } })
      : t('Devices.SiblingMany', {
          count: names.length,
          devices: names.join(', '),
          interpolation: { escapeValue: false },
        })

  return (
    <View style={styles.card} testID={testIdWithKey('SiblingNotice')} accessibilityRole="alert">
      <ThemedText>{words}</ThemedText>
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button
            title={t('Devices.SiblingOpen')}
            buttonType={ButtonType.Secondary}
            onPress={onOpen}
            testID={testIdWithKey('SiblingNoticeOpen')}
          />
        </View>
        <View style={styles.action}>
          <Button
            title={t('Devices.SiblingDismiss')}
            buttonType={ButtonType.Secondary}
            onPress={onDismiss}
            testID={testIdWithKey('SiblingNoticeDismiss')}
          />
        </View>
      </View>
    </View>
  )
}
