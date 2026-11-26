/**
 * "Also open as you" (new-phone-new-device-plan.md §F): another device of
 * this agent was seen recently, and two devices acting as one identity share
 * one mediator connection per persona, so messages may reach only one of
 * them. Said once per newly live device, as openvtc does
 * (openvtc-core/src/devices.rs `sibling_warning`); who counts as live and
 * the "once" live with the presence loop, not here.
 *
 * A slim strip under the screen's header (276.10: the card over the header
 * was too much): one line naming the device, which opens in place to say why
 * it matters, with My devices and OK.
 *
 * @module trust-tasks/screens/SiblingNotice
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

export const SiblingNotice: React.FC<{
  names: string[]
  open: boolean
  onToggle: () => void
  onOpen: () => void
  onDismiss: () => void
}> = ({ names, open, onToggle, onOpen, onDismiss }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  if (names.length === 0) return null

  const ink = ColorPalette.notification.infoText
  const accent = ColorPalette.brand.primary
  const styles = StyleSheet.create({
    strip: {
      backgroundColor: ColorPalette.notification.info,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: ColorPalette.grayscale.lightGrey,
    },
    row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
    headline: { flex: 1, fontSize: 16, color: ink },
    why: { fontSize: 16, color: ink, paddingLeft: 46, paddingRight: 16 },
    actions: { flexDirection: 'row', gap: 8, paddingLeft: 38, paddingBottom: 4 },
    action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
    actionText: { fontSize: 16, color: accent },
  })
  const one = names.length === 1
  const words = { device: names[0], count: names.length, interpolation: { escapeValue: false } }
  const headline = one ? t('Devices.SiblingStripOne', words) : t('Devices.SiblingStripMany', words)
  // The whole notice, for a screen reader, which reads the strip as one button.
  const whole = one ? t('Devices.SiblingOne', words) : t('Devices.SiblingMany', { ...words, devices: names.join(', ') })

  return (
    <View style={styles.strip} accessibilityLiveRegion="polite">
      <Pressable
        style={styles.row}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={whole}
        accessibilityState={{ expanded: open }}
        testID={testIdWithKey('SiblingNotice')}
      >
        <Icon name="devices" size={20} color={ColorPalette.notification.infoIcon} />
        <ThemedText style={styles.headline} numberOfLines={open ? undefined : 1}>
          {headline}
        </ThemedText>
        <Icon name={open ? 'expand-less' : 'expand-more'} size={22} color={ColorPalette.notification.infoIcon} />
      </Pressable>
      {open && (
        <>
          <ThemedText style={styles.why}>
            {one ? t('Devices.SiblingStripWhy') : t('Devices.SiblingStripWhyMany')}
          </ThemedText>
          <View style={styles.actions}>
            <Pressable
              style={styles.action}
              onPress={onOpen}
              accessibilityRole="button"
              testID={testIdWithKey('SiblingNoticeOpen')}
            >
              <ThemedText variant="bold" style={styles.actionText}>
                {t('Devices.SiblingOpen')}
              </ThemedText>
            </Pressable>
            <Pressable
              style={styles.action}
              onPress={onDismiss}
              accessibilityRole="button"
              testID={testIdWithKey('SiblingNoticeDismiss')}
            >
              <ThemedText variant="bold" style={styles.actionText}>
                {t('Devices.SiblingDismiss')}
              </ThemedText>
            </Pressable>
          </View>
        </>
      )}
    </View>
  )
}
