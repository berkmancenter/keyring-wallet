/**
 * RequestCard — one request the agent sent for this phone's decision: who
 * asks and what, when it expires, what approving would do, the code to
 * compare, and Approve / Decline while it waits.
 *
 * A request past its expiry says so and has no buttons: the agent would
 * refuse the answer, so offering it would only mislead. A decided request
 * says what was decided. Neither repeats what approving would do or the code
 * to compare, which only serve a decision still to make.
 *
 * Each card and its controls also carry the request's own handle in their
 * test ids, so a test with several requests waiting acts on its own.
 *
 * @module trust-tasks/screens/RequestCard
 */
import React, { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent, type VtiApproval } from '../module/vtaAgent'

import { ApprovalDetails } from './ApprovalDetails'
import { DidDetails } from './DidDetails'
import { localDateTime } from './localTime'
import { requestLine } from './requestWords'

/** The task URI without the part every task shares. */
export const shortTask = (uri: string) => uri.replace('https://trusttasks.org/spec/', '')

/**
 * What names a request in test ids: its payload digest, which is the "approve
 * code" the agent's own tools print for the host (the match code on the card
 * is that digest's first characters), so host and phone can be matched exactly.
 */
export const requestHandle = (approval: Pick<VtiApproval, 'id' | 'payloadDigest'>) =>
  String(approval.payloadDigest || approval.id).replace(/[^A-Za-z0-9_-]/g, '')

export interface RequestCardProps {
  approval: VtiApproval
  /** `waiting`: to decide. `expired`: undecided, past its expiry. `earlier`: decided, or the answer failed to send. */
  shows: 'waiting' | 'expired' | 'earlier'
  /** A decision is being sent: the buttons wait. */
  busy: boolean
  onDecide: (id: string, decision: 'approve' | 'deny') => void
}

export const RequestCard: React.FC<RequestCardProps> = ({ approval, shows, busy, onDecide }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const styles = StyleSheet.create({
    card: { gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    decisions: { flexDirection: 'row', gap: 12 },
    decision: { flex: 1 },
    answer: {
      minHeight: 48,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: ColorPalette.brand.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    approve: { backgroundColor: ColorPalette.brand.primary },
    decline: { backgroundColor: 'transparent' },
    answerBusy: { opacity: 0.5 },
    approveText: { color: ColorPalette.brand.buttonText, textAlign: 'center' },
    declineText: { color: ColorPalette.brand.primary, textAlign: 'center' },
  })
  // Who asked is named from what this phone knows of the agent's devices.
  const state = useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)
  const handle = requestHandle(approval)
  const [detailOpen, setDetailOpen] = useState(false)
  return (
    <View testID={testIdWithKey(`AgentApprovalCard_${handle}`)}>
      <View style={styles.card} testID={testIdWithKey('AgentApprovalCard')}>
        <ThemedText testID={testIdWithKey('RequestAsks')}>
          {requestLine(approval, { managerDid: state.managerDid, knownDevices: state.knownDevices }, t)}
        </ThemedText>
        {/* The task's technical name, for whoever needs it — never in the sentence. */}
        <DidDetails did={shortTask(approval.taskType)} label={t('Requests.TaskName')} testIdStem="RequestTask" />
        {shows === 'expired' ? (
          <ThemedText testID={testIdWithKey('RequestExpired')}>{t('Requests.Expired')}</ThemedText>
        ) : null}
        {shows === 'waiting' ? (
          <>
            <ThemedText style={styles.muted}>
              {t('MyAgent.ApprovalExpires', { when: localDateTime(approval.expiresAt) })}
            </ThemedText>
            {/* What approving would do and the code to compare are for deciding:
                not repeated under a request that can no longer be decided. */}
            <ApprovalDetails approval={approval} />
            <DidDetails did={approval.requester} testIdStem="AgentApprovalRequester" />
          </>
        ) : null}
        {/* The answer did not go through: said in words, the agent's own
            reason behind Details, and the buttons are live to answer again
            (al-phone, 10-05: they stayed dimmed and nothing was said). */}
        {shows === 'waiting' && approval.status === 'failed' ? (
          <View style={{ gap: 4 }} testID={testIdWithKey(`RequestNotTaken_${handle}`)}>
            <ThemedText style={{ color: ColorPalette.semantic.error }} testID={testIdWithKey('RequestNotTaken')}>
              {t('Requests.NotTaken')}
            </ThemedText>
            {approval.error ? (
              <>
                <Pressable
                  onPress={() => setDetailOpen(!detailOpen)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: detailOpen }}
                  testID={testIdWithKey('RequestNotTakenDetailsToggle')}
                >
                  <ThemedText style={styles.muted}>{t('Errors.ShowDetails')}</ThemedText>
                </Pressable>
                {detailOpen ? (
                  <ThemedText style={styles.muted} selectable testID={testIdWithKey('RequestNotTakenDetail')}>
                    {approval.error}
                  </ThemedText>
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}
        {shows === 'waiting' ? (
          // One shape for both answers, side by side and the same size: the
          // theme's primary and secondary buttons differ in padding and border,
          // so Approve and Decline read as two kinds of control (Alberto, 10-06).
          <View style={styles.decisions}>
            <View style={styles.decision} testID={testIdWithKey(`ApproveConsentButton_${handle}`)}>
              <Pressable
                style={[styles.answer, styles.approve, busy ? styles.answerBusy : undefined]}
                disabled={busy}
                onPress={() => onDecide(approval.id, 'approve')}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                testID={testIdWithKey('ApproveConsentButton')}
              >
                <ThemedText variant="bold" style={styles.approveText}>
                  {t('MyAgent.Approve')}
                </ThemedText>
              </Pressable>
            </View>
            <View style={styles.decision} testID={testIdWithKey(`DenyConsentButton_${handle}`)}>
              <Pressable
                style={[styles.answer, styles.decline, busy ? styles.answerBusy : undefined]}
                disabled={busy}
                onPress={() => onDecide(approval.id, 'deny')}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                testID={testIdWithKey('DenyConsentButton')}
              >
                <ThemedText variant="bold" style={styles.declineText}>
                  {t('MyAgent.Deny')}
                </ThemedText>
              </Pressable>
            </View>
          </View>
        ) : null}
        {shows === 'earlier' ? (
          <View testID={testIdWithKey(`AgentApprovalDecided_${handle}`)}>
            <ThemedText style={styles.muted} testID={testIdWithKey('AgentApprovalDecided')}>
              {approval.status === 'approved'
                ? t('MyAgent.Approved')
                : approval.status === 'denied'
                  ? t('MyAgent.Denied')
                  : (approval.error ?? approval.status)}
            </ThemedText>
          </View>
        ) : null}
      </View>
    </View>
  )
}

export default RequestCard
