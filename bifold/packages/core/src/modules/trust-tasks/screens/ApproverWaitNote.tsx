/**
 * Who a held task waits on (trusted-approver plan T3; mock frames 4 and 6a): while this phone's agent holds one of
 * its tasks for consent, and the task is an action this phone's approvers cover, it names them and says they may need
 * to open Keyring to answer (the agent cannot wake a phone it has no ACL entry for, plan §9). Once the agent says
 * someone approved (its `task-consent/granted` notice), it says that, for a while.
 *
 * Only what the phone knows. A hold names no approver, so the names are the ones this phone wrote on its agent for
 * that action (approverRole.ts, `approversWaitedOn`); a hold by some other rule shows nothing here. A no, or a request
 * that lapsed, is not told to the asking phone at all (VTI task-consent.md, "Pending vs denied"), so there is no
 * "declined" state: the task's own error says it did not go through.
 *
 * Shown only while the trusted-approvers switch is on.
 *
 * @module trust-tasks/screens/ApproverWaitNote
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { approversWaitedOn } from '../approverRole'
import { isTrustedApproversEnabled } from '../module/trustedApproversFlag'
import { vtaAgent } from '../module/vtaAgent'

export const ApproverWaitNoteIds = {
  waiting: 'ApproverWait',
  open: 'ApproverWaitOpen',
  approved: 'ApproverApproved',
} as const

/** How long "Approved by …" stays after the agent's notice. */
export const APPROVED_SHOWN_MS = 2 * 60 * 1000

const ApproverWaitNote: React.FC = () => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const held = useSyncExternalStore(vtaAgent.subscribe, () => vtaAgent.getState().awaitingConsentFor)
  const granted = useSyncExternalStore(vtaAgent.subscribe, () => vtaAgent.getState().consentGranted)
  const on = isTrustedApproversEnabled()
  // The window needs a clock as well as an event: nothing else re-renders this note once the agent goes quiet, so
  // without a timer "Approved by …" would stay up past APPROVED_SHOWN_MS for as long as the screen is open.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!granted) return
    const left = granted.at + APPROVED_SHOWN_MS - Date.now()
    if (left <= 0) return
    const timer = setTimeout(() => setTick((n) => n + 1), left)
    return () => clearTimeout(timer)
  }, [granted])
  const recent = granted && Date.now() - granted.at < APPROVED_SHOWN_MS ? granted : undefined
  const taskType = held ?? recent?.taskType
  const [names, setNames] = useState<{ taskType: string; names: string[] }>()

  useEffect(() => {
    if (!on || !agent || !taskType) return
    let live = true
    approversWaitedOn(agent, taskType)
      .then((found) => live && setNames({ taskType, names: found }))
      .catch(() => live && setNames({ taskType, names: [] }))
    return () => {
      live = false
    }
  }, [on, agent, taskType])

  const who = names && names.taskType === taskType ? names.names : []
  if (!on || !taskType || who.length === 0) return null

  const styles = StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 6 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  const words = { names: who.join(t('Approver.NamesOr')), interpolation: { escapeValue: false } }

  if (held) {
    return (
      <View style={styles.card} testID={testIdWithKey(ApproverWaitNoteIds.waiting)}>
        <ThemedText variant="bold">{t('Approver.WaitingFor', words)}</ThemedText>
        <ThemedText>{t('Approver.WaitHolding', words)}</ThemedText>
        <ThemedText style={styles.muted} testID={testIdWithKey(ApproverWaitNoteIds.open)}>
          {t('Approver.WaitMayNeedOpen', words)}
        </ThemedText>
      </View>
    )
  }
  return (
    <View style={styles.card} testID={testIdWithKey(ApproverWaitNoteIds.approved)}>
      <ThemedText variant="bold">{t('Approver.ApprovedBy', words)}</ThemedText>
      <ThemedText>{t('Approver.ApprovedGoAhead', words)}</ThemedText>
    </View>
  )
}

export default ApproverWaitNote
