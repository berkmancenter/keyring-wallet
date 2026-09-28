/**
 * A lost phone (new-phone-new-device-plan.md §D): remove it first, then
 * change the agent's keys so any copy it kept stops working. The change is
 * offered only when the agent keeps its key ids through it (VTI 83492acf
 * onwards); an older agent would break existing relationships, so it gets
 * words, not a button. An agent Keyring can't read is treated the same, in
 * softer words.
 *
 * @module trust-tasks/screens/LostPhoneCard
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

export type RotationSupport = 'yes' | 'agentTooOld' | 'unknown'

export const LostPhoneCard: React.FC<{
  /** Undefined while Keyring is still asking the agent. */
  rotation?: RotationSupport
  onRotate: () => Promise<void>
  /** Words for a refusal; undefined says nothing (a cancelled confirmation). */
  errorOf: (e: unknown) => string | undefined
}> = ({ rotation, onRotate, errorOf }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const styles = StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    error: { color: ColorPalette.semantic.error },
  })

  const rotate = async () => {
    setError(undefined)
    setBusy(true)
    try {
      await onRotate()
      setDone(true)
    } catch (e) {
      setError(errorOf(e))
    } finally {
      setBusy(false)
    }
  }

  const state = done
    ? t('AgentKeys.Rotated')
    : (error ??
      (rotation === 'agentTooOld'
        ? t('AgentKeys.RotateTooOld')
        : rotation === 'unknown'
          ? t('AgentKeys.RotateUnknown')
          : undefined))

  return (
    <View style={styles.card} testID={testIdWithKey('LostPhone')}>
      <ThemedText variant="bold" accessibilityRole="header">
        {t('AgentKeys.LostTitle')}
      </ThemedText>
      <ThemedText>{t('AgentKeys.LostStep1')}</ThemedText>
      <ThemedText>{t('AgentKeys.LostStep2')}</ThemedText>
      {state ? (
        <ThemedText style={error && !done ? styles.error : undefined} testID={testIdWithKey('LostPhoneState')}>
          {state}
        </ThemedText>
      ) : null}
      {rotation === 'yes' && !done ? (
        <Button
          title={t(busy ? 'AgentKeys.Rotating' : 'AgentKeys.Rotate')}
          buttonType={ButtonType.Secondary}
          onPress={() => void rotate()}
          disabled={busy}
          testID={testIdWithKey('LostPhoneRotate')}
        >
          {busy ? <ActivityIndicator color={ColorPalette.brand.primary} /> : null}
        </Button>
      ) : null}
    </View>
  )
}
