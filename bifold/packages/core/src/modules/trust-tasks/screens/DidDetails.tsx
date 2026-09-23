/**
 * A DID kept behind "Details" (#12): a person sees words, and a power user who
 * needs the identifier — to compare it, or to give it to an admin — opens it.
 * Selectable once shown.
 *
 * @module trust-tasks/screens/DidDetails
 */

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

export interface DidDetailsProps {
  did: string
  /** The testID stem: `<stem>Toggle` and `<stem>Did`. */
  testIdStem: string
}

export const DidDetails: React.FC<DidDetailsProps> = ({ did, testIdStem }) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const [open, setOpen] = useState(false)
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
        <ThemedText style={styles.muted}>{t('VtaLink.Details')}</ThemedText>
      </Pressable>
      {open ? (
        <ThemedText style={styles.mono} selectable testID={testIdWithKey(`${testIdStem}Did`)}>
          {did}
        </ThemedText>
      ) : null}
    </View>
  )
}

export default DidDetails
