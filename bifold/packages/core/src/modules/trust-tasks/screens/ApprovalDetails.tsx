/**
 * What a person needs before they approve: what approving would do, and the
 * code to compare with the screen that asked. Upstream's approvers show both
 * (vta-mobile-core `consent.rs`): the VTA's dry-run effects, else the task's
 * consequences, else a plain "could not tell" — never "no effects", which
 * would read as "safe".
 *
 * @module trust-tasks/screens/ApprovalDetails
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { VtiApproval } from '../module/vtaAgent'

export interface ApprovalDetailsProps {
  approval: Pick<VtiApproval, 'matchCode' | 'outcome'>
}

export const ApprovalDetails: React.FC<ApprovalDetailsProps> = ({ approval }) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const styles = StyleSheet.create({
    block: { gap: 4, marginVertical: 4 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    code: { ...TextTheme.bold, fontFamily: 'Menlo', letterSpacing: 2 },
  })
  const outcome = approval.outcome ?? { from: 'unknown' as const }
  return (
    <View style={styles.block}>
      {outcome.from === 'unknown' ? (
        <ThemedText testID={testIdWithKey('ApprovalOutcomeUnknown')}>{t('MyAgent.ApprovalOutcomeUnknown')}</ThemedText>
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
        </View>
      ) : null}
    </View>
  )
}

export default ApprovalDetails
