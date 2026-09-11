/**
 * CredentialExchangeQueryModal
 *
 * The trust-task dialect's consent moment for `credential-exchange/query`:
 * a verifier asks to see a credential, stating why (payload.purpose). This
 * bottom-sheet surfaces that request; on Share, the wallet builds and sends
 * `credential-exchange/present` with the matching credential — on Decline,
 * nothing is sent (the spec defines no `#response`/error for `query`).
 *
 * Self-contained container: subscribes to credentialExchangeStore's
 * queryPrompt events, so it can be mounted once at the root (beside
 * RelationshipProposalModal). Uses the same bottom-sheet pattern for visual
 * consistency.
 */

import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { respondToCredentialExchangeQuery } from '../ceremony'
import { credentialExchangeStore, CredentialExchangeQueryPrompt } from '../credentialExchangeStore'

const CredentialExchangeQueryModal: React.FC = () => {
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const [prompt, setPrompt] = useState<CredentialExchangeQueryPrompt | undefined>(() =>
    credentialExchangeStore.getAnyQueryPrompt()
  )
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const refresh = () => setPrompt(credentialExchangeStore.getAnyQueryPrompt())
    credentialExchangeStore.on('queryPrompt', refresh)
    credentialExchangeStore.on('queryPromptCleared', refresh)
    return () => {
      credentialExchangeStore.off('queryPrompt', refresh)
      credentialExchangeStore.off('queryPromptCleared', refresh)
    }
  }, [])

  const respond = useCallback(
    async (accept: boolean) => {
      if (!agent || !prompt || busy) return
      setBusy(true)
      try {
        await respondToCredentialExchangeQuery(agent, prompt.queryId, accept)
      } finally {
        setBusy(false)
      }
    },
    [agent, prompt, busy]
  )

  if (!prompt) return null

  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    safeAreaView: {
      backgroundColor: ColorPalette.brand.modalPrimaryBackground,
      borderTopRightRadius: 20,
      borderTopLeftRadius: 20,
    },
    container: {
      paddingHorizontal: 24,
      paddingBottom: 24,
      paddingTop: 24,
    },
    title: {
      textAlign: 'center',
      marginBottom: 12,
    },
    body: {
      textAlign: 'center',
      marginBottom: 24,
    },
    buttonSpacer: {
      height: 12,
    },
  })

  return (
    <SafeAreaModal visible transparent animationType="slide">
      <View style={styles.overlay}>
        <SafeAreaView style={styles.safeAreaView} edges={['bottom']}>
          <View style={styles.container}>
            <ThemedText variant="headingThree" style={styles.title}>
              Credential request
            </ThemedText>
            <ThemedText style={styles.body}>
              {prompt.verifierLabel} wants to see one of your credentials. Reason given: {prompt.purpose}
            </ThemedText>
            <Button
              title="Share"
              accessibilityLabel="Share"
              testID={testIdWithKey('CredentialExchangeQueryShare')}
              buttonType={ButtonType.Primary}
              onPress={() => respond(true)}
              disabled={busy}
            />
            <View style={styles.buttonSpacer} />
            <Button
              title="Decline"
              accessibilityLabel="Decline"
              testID={testIdWithKey('CredentialExchangeQueryDecline')}
              buttonType={ButtonType.Secondary}
              onPress={() => respond(false)}
              disabled={busy}
            />
          </View>
        </SafeAreaView>
      </View>
    </SafeAreaModal>
  )
}

export default CredentialExchangeQueryModal
