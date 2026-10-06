/**
 * What a person needs before they approve: what approving would do, and the
 * code to compare with the screen that asked. Upstream's approvers show both
 * (vta-mobile-core `consent.rs`): the VTA's dry-run effects, else the task's
 * consequences, else a plain "could not tell" — never "no effects", which
 * would read as "safe".
 *
 * @module trust-tasks/screens/ApprovalDetails
 */

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { VtiApproval } from '../module/vtaAgent'

import { taskWords } from './requestWords'

export interface ApprovalDetailsProps {
  approval: Pick<VtiApproval, 'matchCode' | 'outcome'> &
    Partial<Pick<VtiApproval, 'taskType' | 'payloadDigest' | 'subject'>>
}

/** A subject worth showing: a name, not an identifier (never a DID, #12). */
const readableSubject = (subject: unknown): string | undefined =>
  typeof subject === 'string' && subject.trim() && !/^did:/i.test(subject.trim()) ? subject.trim() : undefined

export const ApprovalDetails: React.FC<ApprovalDetailsProps> = ({ approval }) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const styles = StyleSheet.create({
    block: { gap: 4, marginVertical: 4 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    code: { ...TextTheme.bold, fontFamily: 'Menlo', letterSpacing: 2 },
    digest: { ...TextTheme.normal, fontFamily: 'Menlo', fontSize: 12 },
  })
  const outcome = approval.outcome ?? { from: 'unknown' as const }
  const [fullOpen, setFullOpen] = useState(false)
  // Undescribed by the agent, but a task Keyring knows: say what it is, in
  // Keyring's words and saying they are Keyring's (al-signer, 10-06).
  const action = outcome.from === 'unknown' && approval.taskType ? taskWords(approval.taskType, t) : undefined
  const subject = readableSubject(approval.subject)
  return (
    <View style={styles.block}>
      {action ? (
        <ThemedText testID={testIdWithKey('ApprovalTaskDoes')}>
          {t('Requests.TaskDoes', { action, interpolation: { escapeValue: false } })}
        </ThemedText>
      ) : null}
      {subject ? (
        <ThemedText style={styles.muted} selectable testID={testIdWithKey('ApprovalSubject')}>
          {t('Requests.About', { subject, interpolation: { escapeValue: false } })}
        </ThemedText>
      ) : null}
      {outcome.from === 'unknown' ? (
        <ThemedText testID={testIdWithKey('ApprovalOutcomeUnknown')}>
          {t(action ? 'Requests.ApproveIfYouStartedIt' : 'MyAgent.ApprovalOutcomeUnknown')}
        </ThemedText>
      ) : (
        <View testID={testIdWithKey('ApprovalOutcome')}>
          <ThemedText>{t('MyAgent.ApprovalWouldDo')}</ThemedText>
          {outcome.lines.map((line, i) => (
            <ThemedText key={`${i}-${line}`}>{`• ${line}`}</ThemedText>
          ))}
        </View>
      )}
      {approval.matchCode ? (
        <View>
          <ThemedText style={styles.muted}>{t('MyAgent.ApprovalMatchCode')}</ThemedText>
          <ThemedText style={styles.code} selectable testID={testIdWithKey('ApprovalMatchCode')}>
            {approval.matchCode}
          </ThemedText>
          {/* The code is the start of this digest: a tool that prints the
              whole digest can be matched against it too (al-signer, 10-06). */}
          {approval.payloadDigest ? (
            <>
              <Pressable
                onPress={() => setFullOpen(!fullOpen)}
                accessibilityRole="button"
                accessibilityState={{ expanded: fullOpen }}
                testID={testIdWithKey('ApprovalDigestToggle')}
              >
                <ThemedText style={styles.muted}>
                  {t(fullOpen ? 'Requests.HideFullCode' : 'Requests.ShowFullCode')}
                </ThemedText>
              </Pressable>
              {fullOpen ? (
                <ThemedText style={styles.digest} selectable testID={testIdWithKey('ApprovalDigest')}>
                  {approval.payloadDigest}
                </ThemedText>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

export default ApprovalDetails
