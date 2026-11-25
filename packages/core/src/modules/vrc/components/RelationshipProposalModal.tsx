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
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, View } from 'react-native'
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
  const { t } = useTranslation()
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
      // Past a large text size the words and buttons are taller than the screen: the sheet stops at its top and they
      // scroll, so the buttons are reached only past the words (as sign-in's review).
      flexShrink: 1,
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
    card: {
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
      borderRadius: 12,
      padding: 14,
      gap: 10,
      marginBottom: 12,
    },
    row: { gap: 2 },
    mono: { fontFamily: 'Menlo', fontSize: 13 },
    hint: { textAlign: 'center', marginBottom: 16, color: ColorPalette.grayscale.mediumGrey },
  })

  return (
    <SafeAreaModal visible transparent animationType="slide">
      <SafeAreaView style={styles.overlay} edges={['top']}>
        <SafeAreaView style={styles.safeAreaView} edges={['bottom']}>
          <ScrollView bounces={false} contentContainerStyle={styles.container}>
            {prompt.sharedConnect ? (
              // Someone scanned this phone's shared-connect code (WP9). The request carries no name, so the sheet
              // says plainly that Keyring can't tell who this is: the same honesty as the scanner's "Is this name
              // checked?". Only the address prefix is shown; nothing the other side wrote (WP12).
              <View testID={testIdWithKey('ProposalSharedConnect')}>
                <ThemedText variant="headingThree" style={styles.title}>
                  {t('SharedConnectInvite.ConsentTitle')}
                </ThemedText>
                <ThemedText style={styles.body}>{t('SharedConnectInvite.ConsentBody')}</ThemedText>
                <View style={styles.card}>
                  <View style={styles.row}>
                    <ThemedText variant="labelSubtitle">{t('SharedConnectInvite.ConsentWho')}</ThemedText>
                    <ThemedText testID={testIdWithKey('ProposalWho')}>
                      {t('SharedConnectInvite.ConsentWhoUnknown')}
                    </ThemedText>
                  </View>
                  <View style={styles.row}>
                    <ThemedText variant="labelSubtitle">{t('SharedConnectInvite.ConsentAddress')}</ThemedText>
                    <ThemedText style={styles.mono} testID={testIdWithKey('ProposalAddress')}>
                      {prompt.sharedConnect.didShort}
                    </ThemedText>
                  </View>
                </View>
                <ThemedText style={styles.hint}>{t('SharedConnectInvite.ConsentHint')}</ThemedText>
              </View>
            ) : prompt.upgrade ? (
              // An existing relationship asking to sign again: says what it adds, and nothing more.
              <>
                <ThemedText variant="headingThree" style={styles.title}>
                  {t('Relationship.RequestTitle')}
                </ThemedText>
                <ThemedText style={styles.body}>
                  {t(prompt.upgrade === 'witness' ? 'Relationship.RequestWitness' : 'Relationship.RequestResign', {
                    name: prompt.counterpartyLabel,
                    interpolation: { escapeValue: false },
                  })}
                </ThemedText>
              </>
            ) : (
              <>
                <ThemedText variant="headingThree" style={styles.title}>
                  Relationship request
                </ThemedText>
                <ThemedText style={styles.body}>
                  {prompt.counterpartyLabel} wants to form a relationship with you. Accepting exchanges relationship
                  credentials in both directions.
                </ThemedText>
              </>
            )}
            <Button
              title={prompt.sharedConnect ? t('Global.Accept') : 'Accept'}
              accessibilityLabel={prompt.sharedConnect ? t('Global.Accept') : 'Accept'}
              testID={testIdWithKey('ProposalAccept')}
              buttonType={ButtonType.Primary}
              onPress={() => respond(true)}
              disabled={busy}
            />
            <View style={styles.buttonSpacer} />
            <Button
              title={prompt.sharedConnect ? t('Global.Decline') : 'Decline'}
              accessibilityLabel={prompt.sharedConnect ? t('Global.Decline') : 'Decline'}
              testID={testIdWithKey('ProposalDecline')}
              buttonType={ButtonType.Secondary}
              onPress={() => respond(false)}
              disabled={busy}
            />
          </ScrollView>
        </SafeAreaView>
      </SafeAreaView>
    </SafeAreaModal>
  )
}

export default RelationshipProposalModal
