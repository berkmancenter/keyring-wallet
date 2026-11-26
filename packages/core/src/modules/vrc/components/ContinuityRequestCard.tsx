/**
 * "Is this you?" in the chat with the person asking: the same question as the prompt (ContinuityCheckModal), kept in
 * their chat until it is answered, so a request that arrived while the app was closed is not lost behind a
 * notification. Confirm sends the challenge back and nothing else; Not now sends nothing. Either answer clears both.
 *
 * @module vrc/components/ContinuityRequestCard
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { respondToContinuityPrompt } from '../contacts/continuity'
import { useContinuityPrompt } from '../contacts/useContinuityPrompt'

export const ContinuityRequestCard: React.FC<{ connectionId: string }> = ({ connectionId }) => {
  const { agent } = useAgent()
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const prompt = useContinuityPrompt(connectionId)
  const [busy, setBusy] = useState(false)

  if (!prompt) return null

  const respond = async (confirm: boolean) => {
    if (!agent || busy) return
    setBusy(true)
    try {
      await respondToContinuityPrompt(agent, connectionId, confirm)
    } catch (error) {
      agent.config.logger.warn(`[VRC:Contacts] continuity answer failed: ${(error as Error)?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const unnamed = t('ContactDetails.UnnamedContact')
  const words = {
    asker: prompt.asker || unnamed,
    earlier: prompt.earlier || unnamed,
    interpolation: { escapeValue: false },
  }
  const styles = StyleSheet.create({
    card: {
      margin: 12,
      padding: 16,
      gap: 10,
      borderRadius: 12,
      backgroundColor: ColorPalette.brand.secondaryBackground,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
    },
  })

  return (
    <View style={styles.card} testID={testIdWithKey('ContinuityRequestCard')} accessibilityRole="summary">
      <ThemedText variant="headingFour">{t('Relationship.ContinuityTitle')}</ThemedText>
      <ThemedText>{t('Relationship.ContinuityBody', words)}</ThemedText>
      <Button
        title={t('Relationship.ContinuityConfirm')}
        buttonType={ButtonType.Primary}
        onPress={() => void respond(true)}
        disabled={busy}
        testID={testIdWithKey('ContinuityRequestConfirm')}
      />
      <Button
        title={t('Relationship.ContinuityNotNow')}
        buttonType={ButtonType.Secondary}
        onPress={() => void respond(false)}
        disabled={busy}
        testID={testIdWithKey('ContinuityRequestNotNow')}
      />
    </View>
  )
}

export default ContinuityRequestCard
