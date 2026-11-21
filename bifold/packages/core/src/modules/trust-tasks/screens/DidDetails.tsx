/**
 * A DID kept behind "Details" (#12): a person sees words, and a power user who
 * needs the identifier — to compare it, or to give it to an admin — opens it.
 * Selectable once shown.
 *
 * @module trust-tasks/screens/DidDetails
 */

import Clipboard from '@react-native-clipboard/clipboard'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

export interface DidDetailsProps {
  did: string
  /** The testID stem: `<stem>Toggle`, `<stem>Did`, `<stem>Hint` and `<stem>Copy`. */
  testIdStem: string
  /** What the toggle says, in words ("Your identity here"); "Details" when not given. */
  label?: string
  /** One plain line said above the identifier once open: whose it is and who sees it. */
  hint?: string
  /** Offer Copy beside the identifier, for giving it to an admin (IN-120). */
  copy?: boolean
}

export const DidDetails: React.FC<DidDetailsProps> = ({ did, testIdStem, label, hint, copy = false }) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    mono: { ...TextTheme.normal, fontFamily: 'Menlo', fontSize: 12 },
  })
  return (
    <View>
      <Pressable
        style={styles.row}
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID={testIdWithKey(`${testIdStem}Toggle`)}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={18} color={ColorPalette.grayscale.mediumGrey} />
        <ThemedText style={styles.muted}>{label ?? t('VtaLink.Details')}</ThemedText>
      </Pressable>
      {open && hint ? (
        <ThemedText style={styles.muted} testID={testIdWithKey(`${testIdStem}Hint`)}>
          {hint}
        </ThemedText>
      ) : null}
      {open ? (
        <ThemedText style={styles.mono} selectable testID={testIdWithKey(`${testIdStem}Did`)}>
          {did}
        </ThemedText>
      ) : null}
      {open && copy ? (
        <Pressable
          style={styles.row}
          onPress={() => {
            Clipboard.setString(did)
            setCopied(true)
          }}
          accessibilityRole="button"
          testID={testIdWithKey(`${testIdStem}Copy`)}
        >
          <Icon name={copied ? 'check' : 'content-copy'} size={16} color={ColorPalette.brand.link} />
          <ThemedText style={{ color: ColorPalette.brand.link }}>
            {copied ? t('VtaLink.KeyCopied') : t('VtaLink.CopyKey')}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  )
}

export default DidDetails
