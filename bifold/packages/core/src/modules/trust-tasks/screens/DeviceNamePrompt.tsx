/**
 * Naming this phone (new-phone-new-device-plan.md §A): the name the person's
 * other devices show. It starts from the short dated default ("iPhone · added
 * 28 Sep"), never the model string, and saves trimmed; a blank name can't be
 * saved.
 *
 * @module trust-tasks/screens/DeviceNamePrompt
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, TextInput, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

/** Long enough for "Sam's work phone (old)", short enough to fit a row. */
const NAME_LIMIT = 40

/**
 * The name field alone, for a screen whose own button saves it (the link
 * screen's Continue): one filled button per step.
 */
export const DeviceNameField: React.FC<{ value: string; onChange: (name: string) => void; onSubmit?: () => void }> = ({
  value,
  onChange,
  onSubmit,
}) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const styles = StyleSheet.create({
    muted: { color: ColorPalette.grayscale.mediumGrey },
    input: {
      ...TextTheme.normal,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.mediumGrey,
      borderRadius: 6,
      padding: 12,
      minHeight: 48,
    },
  })
  return (
    <View style={{ gap: 8 }}>
      <ThemedText variant="bold">{t('Devices.NameTitle')}</ThemedText>
      <ThemedText style={styles.muted}>{t('Devices.NameHint')}</ThemedText>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        maxLength={NAME_LIMIT}
        returnKeyType="done"
        onSubmitEditing={onSubmit}
        accessibilityLabel={t('Devices.NameTitle')}
        testID={testIdWithKey('DeviceNameInput')}
      />
    </View>
  )
}

export const DeviceNamePrompt: React.FC<{ initial: string; onSave: (name: string) => void; busy?: boolean }> = ({
  initial,
  onSave,
  busy,
}) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const [name, setName] = useState(initial)
  const trimmed = name.trim()

  const styles = StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
  })

  const save = () => {
    if (trimmed && !busy) onSave(trimmed)
  }

  return (
    <View style={styles.card}>
      <DeviceNameField value={name} onChange={setName} onSubmit={save} />
      <Button
        title={t('Devices.NameSave')}
        buttonType={ButtonType.Primary}
        onPress={save}
        disabled={!trimmed || busy}
        testID={testIdWithKey('DeviceNameSave')}
      />
    </View>
  )
}
