/**
 * The Approver demo's trigger + inbox for ONE contact, rendered at the
 * bottom of that contact's detail screen via
 * `TOKENS.COMPONENT_CONTACT_DETAILS_FOOTER` — see `ApproverProfile.ts`'s own
 * comment on why this replaced the earlier Wallet-tab-footer placement. It
 * has the same two jobs as before, both driven by the established VRC
 * connection this specific contact screen is already showing:
 *
 *  1. A button that sends an access request to THIS contact —
 *     `proposeAccessRequest`, this profile's own ceremony function.
 *  2. Whenever `trustTaskPromptStore` surfaces a pending request FROM this
 *     contact, render it via the generic `TrustTaskApprovalModal` (a
 *     bottom-sheet, not the inline `TrustTaskApprovalCard` — this section
 *     already sits inside a scrollable contact-details page, and a free-text
 *     `resource`/`reason` value needs more room than an inline card gets) and
 *     let the user answer — `respondToAccessRequest` on the button press.
 *
 * Renders nothing when `connectionId` is null: the ceremony requires an
 * established relationship DID on this connection, and ContactDetails only
 * resolves a connectionId once one is on file.
 *
 * Every store/event lookup below is filtered to this contact's own
 * `connectionId` — unlike the old Wallet-tab banner, which showed whichever
 * single pending request existed across ALL contacts, this component only
 * ever needs to care about the one contact its screen is already scoped to.
 */

import {
  ContactDetailsFooterProps,
  PendingTrustTaskPrompt,
  TrustTaskApprovalModal,
  testIdWithKey,
  trustTaskDisplayRegistry,
  trustTaskPromptStore,
  useAppAgent,
  useTheme,
} from '@bifold/core'
import React, { useEffect, useState } from 'react'
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import {
  AccessRequestDecisionEvent,
  TYPE_URI,
  approverDecisionEvents,
  proposeAccessRequest,
  respondToAccessRequest,
} from './ceremony'

const ApproverContactSection: React.FC<ContactDetailsFooterProps> = ({ connectionId }) => {
  const { agent } = useAppAgent()
  const { ColorPalette, TextTheme } = useTheme()
  const [pending, setPending] = useState<PendingTrustTaskPrompt | undefined>(undefined)
  const [sending, setSending] = useState(false)
  // True from the moment `proposeAccessRequest` resolves until either a
  // signed decision lands (approverDecisionEvents) or the person cancels.
  // Cancel here is LOCAL ONLY: it stops this wallet's own "waiting" display,
  // it does not send anything — the counterparty's pending prompt, if they
  // haven't answered yet, is untouched and they can still approve/deny it.
  const [awaitingResponse, setAwaitingResponse] = useState(false)
  const [lastDecision, setLastDecision] = useState<AccessRequestDecisionEvent['decision'] | undefined>(undefined)

  useEffect(() => {
    if (!connectionId) return
    // `connectionId` starts null and resolves asynchronously (ContactDetails'
    // own lookup effect) — often AFTER the request already arrived, e.g. via
    // ApproverGlobalListener's toast landing here straight from the pending
    // 'prompt' event. Sync with whatever's already in the store for this
    // connection right now, not just events that fire from this point on.
    setPending(trustTaskPromptStore.getPending(connectionId, TYPE_URI))
    const onPrompt = (prompt: PendingTrustTaskPrompt) => {
      if (prompt.typeUri === TYPE_URI && prompt.connectionId === connectionId) setPending(prompt)
    }
    const onCleared = ({ typeUri, connectionId: clearedId }: { typeUri: string; connectionId: string }) => {
      if (typeUri === TYPE_URI && clearedId === connectionId) setPending(undefined)
    }
    const onDecision = (event: AccessRequestDecisionEvent) => {
      if (event.connectionId !== connectionId) return
      setAwaitingResponse(false)
      setLastDecision(event.decision)
    }
    trustTaskPromptStore.on('prompt', onPrompt)
    trustTaskPromptStore.on('promptCleared', onCleared)
    approverDecisionEvents.on('decision', onDecision)
    return () => {
      trustTaskPromptStore.off('prompt', onPrompt)
      trustTaskPromptStore.off('promptCleared', onCleared)
      approverDecisionEvents.off('decision', onDecision)
    }
  }, [connectionId])

  const styles = StyleSheet.create({
    container: {
      marginTop: 8,
      marginBottom: 20,
      padding: 16,
      borderRadius: 12,
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
      paddingVertical: 12,
      paddingHorizontal: 18,
      borderRadius: 8,
      backgroundColor: ColorPalette.brand.primary,
      alignSelf: 'flex-start',
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.15,
          shadowRadius: 3,
        },
        android: {
          elevation: 2,
        },
      }),
    },
    requestButtonText: {
      ...TextTheme.normal,
      color: ColorPalette.brand.buttonText,
      fontWeight: '600',
    },
    awaitingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    awaitingText: {
      ...TextTheme.normal,
      color: ColorPalette.brand.text,
      fontStyle: 'italic',
    },
    cancelButton: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: ColorPalette.brand.text,
    },
    cancelButtonText: {
      ...TextTheme.normal,
      color: ColorPalette.brand.text,
    },
    lastDecision: {
      ...TextTheme.normal,
      color: ColorPalette.brand.text,
      marginTop: 16,
    },
  })

  const requestAccess = async () => {
    if (!agent || !connectionId || sending) return
    setSending(true)
    setLastDecision(undefined)
    try {
      await proposeAccessRequest(agent, connectionId, "the shared photo album 'Family 2026'", 'planning a get-together')
      setAwaitingResponse(true)
    } finally {
      setSending(false)
    }
  }

  const cancelRequest = () => {
    setAwaitingResponse(false)
  }

  const decide = async (decision: 'approved' | 'denied') => {
    if (!agent || !connectionId || !pending) return
    await respondToAccessRequest(agent, connectionId, decision)
  }

  if (!connectionId) return null

  return (
    <View style={styles.container} testID={testIdWithKey('ApproverContactSection')}>
      <Text style={styles.title}>Approver demo</Text>
      <Text style={styles.subtitle}>Ask this contact for access to something, or answer a request from them.</Text>
      {awaitingResponse ? (
        <View style={styles.awaitingRow} testID={testIdWithKey('ApproverAwaitingResponse')}>
          <Text style={styles.awaitingText}>Waiting for a response…</Text>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={cancelRequest}
            testID={testIdWithKey('ApproverCancelRequest')}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.requestButton}
          onPress={() => void requestAccess()}
          disabled={sending}
          testID={testIdWithKey('ApproverRequestAccess')}
        >
          <Text style={styles.requestButtonText}>Request access from this contact</Text>
        </TouchableOpacity>
      )}
      {lastDecision && (
        <Text style={styles.lastDecision} testID={testIdWithKey('ApproverLastDecision')}>
          Last decision: {lastDecision}
        </Text>
      )}
      {pending && (
        <TrustTaskApprovalModal
          typeUri={pending.typeUri}
          document={pending.document}
          summary={pending.summary}
          counterpartyLabel={pending.counterpartyLabel}
          displayRegistry={trustTaskDisplayRegistry}
          onApprove={() => void decide('approved')}
          onDeny={() => void decide('denied')}
        />
      )}
    </View>
  )
}

export default ApproverContactSection
