/**
 * "List me in the community's public member directory?" (VTI-Q14) — asked
 * where an application is sent, off unless the person turns it on.
 *
 * The community publishes a member only while this consent stands (vti #1682,
 * #1691), but after admission only its admin can change it: no task lets a
 * member withdraw it themselves. The note says so, and says what they can do.
 *
 * @module trust-tasks/screens/DirectoryConsent
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Switch, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { communityLabelOf } from './communityName'

export interface DirectoryConsentProps {
  communityDid: string
  value: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}

export const DirectoryConsent: React.FC<DirectoryConsentProps> = ({ communityDid, value, onChange, disabled }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    label: { flex: 1 },
    note: { color: ColorPalette.grayscale.mediumGrey, marginTop: 4 },
  })
  const question = t('Registry.ListMe', {
    community: communityLabelOf(communityDid, t),
    interpolation: { escapeValue: false },
  })
  return (
    <View testID={testIdWithKey('DirectoryConsent')}>
      <View style={styles.row}>
        <ThemedText style={styles.label}>{question}</ThemedText>
        <Switch
          trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
          thumbColor={value ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
          ios_backgroundColor={ColorPalette.grayscale.lightGrey}
          onValueChange={onChange}
          value={value}
          disabled={disabled}
          accessibilityLabel={question}
          testID={testIdWithKey('DirectoryConsentSwitch')}
        />
      </View>
      <ThemedText style={styles.note} testID={testIdWithKey('DirectoryConsentNote')}>
        {t('Registry.Note')}
      </ThemedText>
    </View>
  )
}

export default DirectoryConsent
