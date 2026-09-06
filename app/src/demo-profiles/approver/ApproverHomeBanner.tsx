/**
 * The Approver demo's trigger + inbox, both embedded in the Wallet tab's
 * credential-list footer — per R5's own scope note
 * (docs/plans/reference-app-sdk-packaging/2026-09-03-bm.md: "a full picker
 * UI is out of scope"), this demo adds no navigator route. It has two jobs,
 * both driven by the same established VRC connection:
 *
 *  1. A button that sends an access request to the first connected contact —
 *     `proposeAccessRequest`, this profile's own ceremony function.
 *  2. Whenever `trustTaskPromptStore` surfaces a pending request (this
 *     wallet is the one being asked), render it via the generic
 *     `TrustTaskApprovalCard` and let the user answer —
 *     `respondToAccessRequest` on the button press.
 *
 * Registered on `TOKENS.COMPONENT_CRED_LIST_FOOTER` by `ApproverProfile` —
 * see that file's own comment on why this token (not `COMPONENT_HOME_HEADER`,
 * which turned out to render on a screen this fork's navigation never
 * reaches, and not `COMPONENT_CONTACT_CARD`, which the trading-card demo
 * already owns). `credentialsCount` is accepted because the token's type
 * requires it, and ignored — this component's own content doesn't depend on
 * the Wallet tab's credential count.
 */

import {
  CredentialListFooterProps,
  PendingTrustTaskPrompt,
  TrustTaskApprovalCard,
  testIdWithKey,
  trustTaskDisplayRegistry,
  trustTaskPromptStore,
  useAppAgent,
  useTheme,
} from '@bifold/core'
import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import {
  AccessRequestDecisionEvent,
  TYPE_URI,
  approverDecisionEvents,
  proposeAccessRequest,
  respondToAccessRequest,
} from './ceremony'

const ApproverHomeBanner: React.FC<CredentialListFooterProps> = () => {
  const { agent } = useAppAgent()
  const { ColorPalette, TextTheme } = useTheme()
  const [pending, setPending] = useState<PendingTrustTaskPrompt | undefined>(
    trustTaskPromptStore.list().find((p) => p.typeUri === TYPE_URI)
  )
  const [sending, setSending] = useState(false)
  // The requester side's own confirmation that a signed decision landed —
  // approverDecisionEvents is this demo's small analogue to
  // trustTaskPromptStore for the OTHER direction (see ceremony.ts).
  const [lastDecision, setLastDecision] = useState<AccessRequestDecisionEvent['decision'] | undefined>(undefined)

  useEffect(() => {
    const onPrompt = (prompt: PendingTrustTaskPrompt) => {
      if (prompt.typeUri === TYPE_URI) setPending(prompt)
    }
    const onCleared = ({ typeUri }: { typeUri: string }) => {
      if (typeUri === TYPE_URI) setPending(undefined)
    }
    const onDecision = (event: AccessRequestDecisionEvent) => setLastDecision(event.decision)
    trustTaskPromptStore.on('prompt', onPrompt)
    trustTaskPromptStore.on('promptCleared', onCleared)
    approverDecisionEvents.on('decision', onDecision)
    return () => {
      trustTaskPromptStore.off('prompt', onPrompt)
      trustTaskPromptStore.off('promptCleared', onCleared)
      approverDecisionEvents.off('decision', onDecision)
    }
  }, [])

  const styles = StyleSheet.create({
    container: {
      padding: 16,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    title: {
      ...TextTheme.headingThree,
      color: ColorPalette.brand.text,
    },
    subtitle: {
      ...TextTheme.normal,
      color: ColorPalette.brand.text,
      marginTop: 4,
      marginBottom: 12,
    },
    requestButton: {
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 6,
      backgroundColor: ColorPalette.brand.secondaryBackground,
      alignSelf: 'flex-start',
    },
    requestButtonText: {
      ...TextTheme.normal,
      color: ColorPalette.brand.text,
    },
  })

  const requestAccess = async () => {
    if (!agent || sending) return
    setSending(true)
    setLastDecision(undefined)
    try {
      const connections = await agent.modules.didcomm.connections.getAll()
      // Exclude the mediator's own connection — getAll() returns every
      // connection this agent holds, and the mediator's is typically
      // ready first, which would otherwise be picked as the "contact" to
      // ask (and immediately fail with no relationship DID on file).
      const target = connections.find((c) => c.isReady && !c.connectionTypes?.includes('mediator'))
      agent.config.logger.info(
        `[Approver] candidate connections: ${connections.length}, target found: ${Boolean(target)}`
      )
      if (!target) return
      await proposeAccessRequest(agent, target.id, "the shared photo album 'Family 2026'", 'planning a get-together')
    } finally {
      setSending(false)
    }
  }

  const decide = async (decision: 'approved' | 'denied') => {
    if (!agent || !pending) return
    await respondToAccessRequest(agent, pending.connectionId, decision)
  }

  return (
    <View style={styles.container} testID={testIdWithKey('ApproverHomeBanner')}>
      <Text style={styles.title}>Approver demo</Text>
      <Text style={styles.subtitle}>
        Ask a connected contact for access to something, or answer a request from them.
      </Text>
      {pending ? (
        <TrustTaskApprovalCard
          typeUri={pending.typeUri}
          document={pending.document}
          summary={pending.summary}
          counterpartyLabel={pending.counterpartyLabel}
          displayRegistry={trustTaskDisplayRegistry}
          onApprove={() => void decide('approved')}
          onDeny={() => void decide('denied')}
        />
      ) : (
        <TouchableOpacity
          style={styles.requestButton}
          onPress={() => void requestAccess()}
          disabled={sending}
          testID={testIdWithKey('ApproverRequestAccess')}
        >
          <Text style={styles.requestButtonText}>Request access from a contact</Text>
        </TouchableOpacity>
      )}
      {lastDecision && (
        <Text style={styles.subtitle} testID={testIdWithKey('ApproverLastDecision')}>
          Last decision: {lastDecision}
        </Text>
      )}
    </View>
  )
}

export default ApproverHomeBanner
