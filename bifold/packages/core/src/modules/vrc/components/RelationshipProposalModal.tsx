/**
 * RelationshipProposalModal
 *
 * The trust-task dialect's consent moment: when a v4 peer proposes a
 * relationship (vrc/relationships/propose), this bottom-sheet asks the user
 * to accept or decline THE RELATIONSHIP — replacing the legacy flow's
 * per-credential accept. On Accept, both signed VRCs then flow automatically
 * as trust-task issue legs; on Decline a trust-task-error (declined) answers
 * the proposal and nothing is issued.
 *
 * Self-contained container: subscribes to vrcFlowStore's proposalPrompt
 * events, so it can be mounted once at the root (beside the other VRC
 * modals). Uses the same bottom-sheet pattern as BiometricConfirmationModal
 * for visual consistency.
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
import { respondToRelationshipProposal } from '../../trust-tasks/ceremony'
import { vrcFlowStore, RelationshipProposalPrompt } from '../witnessStatusStore'

const RelationshipProposalModal: React.FC = () => {
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const [prompt, setPrompt] = useState<RelationshipProposalPrompt | undefined>(() =>
    vrcFlowStore.getAnyProposalPrompt()
  )
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const refresh = () => setPrompt(vrcFlowStore.getAnyProposalPrompt())
    vrcFlowStore.on('proposalPrompt', refresh)
    vrcFlowStore.on('proposalPromptCleared', refresh)
    return () => {
      vrcFlowStore.off('proposalPrompt', refresh)
      vrcFlowStore.off('proposalPromptCleared', refresh)
    }
  }, [])

  const respond = useCallback(
    async (accept: boolean) => {
      if (!agent || !prompt || busy) return
      setBusy(true)
      try {
        await respondToRelationshipProposal(agent, prompt.connectionId, accept)
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
              Relationship request
            </ThemedText>
            <ThemedText style={styles.body}>
              {prompt.counterpartyLabel} wants to form a relationship with you. Accepting exchanges relationship
              credentials in both directions.
            </ThemedText>
            <Button
              title="Accept"
              accessibilityLabel="Accept"
              testID={testIdWithKey('ProposalAccept')}
              buttonType={ButtonType.Primary}
              onPress={() => respond(true)}
              disabled={busy}
            />
            <View style={styles.buttonSpacer} />
            <Button
              title="Decline"
              accessibilityLabel="Decline"
              testID={testIdWithKey('ProposalDecline')}
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

export default RelationshipProposalModal
