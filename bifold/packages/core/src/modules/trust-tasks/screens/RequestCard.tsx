/**
 * RequestCard — one request the agent sent for this phone's decision: who
 * asks and what, when it expires, what approving would do, the code to
 * compare, and Approve / Decline while it waits.
 *
 * A request past its expiry says so and has no buttons: the agent would
 * refuse the answer, so offering it would only mislead. A decided request
 * says what was decided.
 *
 * Each card and its controls also carry the request's own handle in their
 * test ids, so a test with several requests waiting acts on its own.
 *
 * @module trust-tasks/screens/RequestCard
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { VtiApproval } from '../module/vtaAgent'

import { ApprovalDetails } from './ApprovalDetails'
import { partyLabelStartOf } from './communityName'
import { DidDetails } from './DidDetails'
import { localDateTime } from './localTime'

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
  })
  const handle = requestHandle(approval)
  return (
    <View testID={testIdWithKey(`AgentApprovalCard_${handle}`)}>
      <View style={styles.card} testID={testIdWithKey('AgentApprovalCard')}>
        <ThemedText>
          {t('MyAgent.ApprovalAsks', {
            requester: partyLabelStartOf(approval.requester, t),
            task: shortTask(approval.taskType),
            interpolation: { escapeValue: false },
          })}
        </ThemedText>
        {shows === 'expired' ? (
          <ThemedText testID={testIdWithKey('RequestExpired')}>{t('Requests.Expired')}</ThemedText>
        ) : (
          <ThemedText style={styles.muted}>
            {t('MyAgent.ApprovalExpires', { when: localDateTime(approval.expiresAt) })}
          </ThemedText>
        )}
        <ApprovalDetails approval={approval} />
        <DidDetails did={approval.requester} testIdStem="AgentApprovalRequester" />
        {shows === 'waiting' ? (
          <View style={styles.row}>
            <View testID={testIdWithKey(`ApproveConsentButton_${handle}`)}>
              <Button
                title={t('MyAgent.Approve')}
                buttonType={ButtonType.Primary}
                disabled={busy}
                onPress={() => onDecide(approval.id, 'approve')}
                testID={testIdWithKey('ApproveConsentButton')}
              />
            </View>
            <View testID={testIdWithKey(`DenyConsentButton_${handle}`)}>
              <Button
                title={t('MyAgent.Deny')}
                buttonType={ButtonType.Secondary}
                disabled={busy}
                onPress={() => onDecide(approval.id, 'deny')}
                testID={testIdWithKey('DenyConsentButton')}
              />
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
