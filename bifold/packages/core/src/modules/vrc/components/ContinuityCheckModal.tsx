/**
 * "Is this you?" — the other phone's half of a continuity check (contacts/continuity.ts). Shown only when a contact's
 * challenge opened with the key of one of this phone's EARLIER relationships: they are asking to show the two as one
 * contact. Confirm sends the challenge back and nothing else; Not now sends nothing.
 *
 * Self-contained: listens to continuityPromptStore, mounted once at the root beside RelationshipProposalModal. Once
 * the agent is up it brings back the prompts kept on the phone, so one that arrived before a restart is still asked.
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import {
  continuityPromptStore,
  respondToContinuityPrompt,
  restoreContinuityPrompts,
  type ContinuityPrompt,
} from '../contacts/continuity'

const ContinuityCheckModal: React.FC = () => {
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState<ContinuityPrompt | undefined>(() => continuityPromptStore.getAny())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!agent) return
    restoreContinuityPrompts(agent).catch((error: unknown) =>
      agent.config.logger.warn(
        `[VRC:Contacts] could not restore continuity prompts: ${(error as Error)?.message ?? error}`
      )
    )
  }, [agent])

  useEffect(() => {
    const refresh = () => setPrompt(continuityPromptStore.getAny())
    continuityPromptStore.on('prompt', refresh)
    continuityPromptStore.on('promptCleared', refresh)
    return () => {
      continuityPromptStore.off('prompt', refresh)
      continuityPromptStore.off('promptCleared', refresh)
    }
  }, [])

  const respond = useCallback(
    async (confirm: boolean) => {
      if (!agent || !prompt || busy) return
      setBusy(true)
      try {
        await respondToContinuityPrompt(agent, prompt.connectionId, confirm)
      } catch (error) {
        agent.config.logger.warn(`[VRC:Contacts] continuity answer failed: ${(error as Error)?.message ?? error}`)
      } finally {
        setBusy(false)
      }
    },
    [agent, prompt, busy]
  )

  if (!prompt) return null

  const unnamed = t('ContactDetails.UnnamedContact')
  const words = {
    asker: prompt.asker || unnamed,
    earlier: prompt.earlier || unnamed,
    interpolation: { escapeValue: false },
  }
  const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    safeAreaView: {
      backgroundColor: ColorPalette.brand.modalPrimaryBackground,
      borderTopRightRadius: 20,
      borderTopLeftRadius: 20,
    },
    container: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 24, gap: 12 },
    centred: { textAlign: 'center' },
  })

  return (
    <SafeAreaModal visible transparent animationType="slide">
      <View style={styles.overlay}>
        <SafeAreaView style={styles.safeAreaView} edges={['bottom']}>
          <View style={styles.container} testID={testIdWithKey('ContinuityCheck')}>
            <ThemedText variant="headingThree" style={styles.centred}>
              {t('Relationship.ContinuityTitle')}
            </ThemedText>
            <ThemedText style={styles.centred} testID={testIdWithKey('ContinuityCheckBody')}>
              {t('Relationship.ContinuityBody', words)}
            </ThemedText>
            <Button
              title={t('Relationship.ContinuityConfirm')}
              buttonType={ButtonType.Primary}
              onPress={() => void respond(true)}
              disabled={busy}
              testID={testIdWithKey('ContinuityConfirm')}
            />
            <Button
              title={t('Relationship.ContinuityNotNow')}
              buttonType={ButtonType.Secondary}
              onPress={() => void respond(false)}
              disabled={busy}
              testID={testIdWithKey('ContinuityNotNow')}
            />
          </View>
        </SafeAreaView>
      </View>
    </SafeAreaModal>
  )
}

export default ContinuityCheckModal
