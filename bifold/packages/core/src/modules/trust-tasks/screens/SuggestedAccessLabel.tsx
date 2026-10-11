/**
 * The name to give this phone on the agent's access list, shown beside the key
 * on the screens where someone else grants it (IN-200). An agent refuses any
 * change to the caller's own entry (VTI-ACL-052), so the phone cannot name
 * itself after the key swap; the entry keeps whatever label it was granted
 * with, and the swap carries it over. Whoever grants the key can use this one.
 *
 * @module trust-tasks/screens/SuggestedAccessLabel
 */

import Clipboard from '@react-native-clipboard/clipboard'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

/** The label suggested for this phone's access entry: "Keyring — <device name>". */
export const suggestedAccessLabel = (deviceName: string): string =>
  deviceName.trim() ? `Keyring — ${deviceName.trim()}` : 'Keyring'

export interface SuggestedAccessLabelProps {
  /** The device name this phone will go by: the one its name field later starts with. */
  deviceName: string
  /** The testID stem: `<stem>`, `<stem>Value`, `<stem>Copy` and `<stem>Hint`. */
  testIdStem: string
}

export const SuggestedAccessLabel: React.FC<SuggestedAccessLabelProps> = ({ deviceName, testIdStem }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const [copied, setCopied] = useState(false)
  const label = suggestedAccessLabel(deviceName)
  const styles = StyleSheet.create({
    box: { gap: 6 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  return (
    <View style={styles.box} testID={testIdWithKey(testIdStem)}>
      <ThemedText style={styles.muted}>{t('VtaLink.SuggestedLabelTitle')}</ThemedText>
      <ThemedText variant="bold" selectable testID={testIdWithKey(`${testIdStem}Value`)}>
        {label}
      </ThemedText>
      <Pressable
        style={styles.row}
        onPress={() => {
          Clipboard.setString(label)
          setCopied(true)
        }}
        accessibilityRole="button"
        accessibilityLabel={copied ? t('VtaLink.SuggestedLabelCopied') : t('VtaLink.SuggestedLabelCopy')}
        testID={testIdWithKey(`${testIdStem}Copy`)}
      >
        <Icon name={copied ? 'check' : 'content-copy'} size={16} color={ColorPalette.brand.link} />
        <ThemedText style={{ color: ColorPalette.brand.link }}>
          {copied ? t('VtaLink.SuggestedLabelCopied') : t('VtaLink.SuggestedLabelCopy')}
        </ThemedText>
      </Pressable>
      <ThemedText style={styles.muted} testID={testIdWithKey(`${testIdStem}Hint`)}>
        {t('VtaLink.SuggestedLabelHint')}
      </ThemedText>
    </View>
  )
}
