/**
 * "Ask {{name}} to be my approver", on a contact's page (trusted-approver plan §4 steps 1–2): sends the role offer
 * over the relationship this phone already has with the contact (approverRole.ts), then says where the offer stands.
 *
 * Shown only while the trusted-approvers switch is on and this phone is linked to an agent: the offer names that
 * agent, so without one there is nothing to ask about. A yes is not written here: it waits on My agent, under Who
 * approves, where writing it asks the person to confirm.
 *
 * @module trust-tasks/screens/ApproverAskRow
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { approverRoleEvents, offerApproverRole, roleOfferAskOn, type RoleOfferAsk } from '../approverRole'
import { ROLE_ACTIONS } from '../approverRoleSpec'
import { releaseWarn } from '../module/releaseLog'
import { isTrustedApproversEnabled } from '../module/trustedApproversFlag'
import { vtaAgent } from '../module/vtaAgent'

export const ApproverAskRowIds = {
  row: 'ApproverAsk',
  ask: 'ApproverAskButton',
  again: 'ApproverAskAgain',
  status: 'ApproverAskStatus',
  error: 'ApproverAskError',
} as const

interface Props {
  connectionId: string | null
  /** The contact's name, as the page shows it. */
  name: string
}

const ApproverAskRow: React.FC<Props> = ({ connectionId, name }) => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const vtaDid = useSyncExternalStore(vtaAgent.subscribe, () => {
    const link = vtaAgent.getState().link
    return link.kind === 'linked' ? link.vtaDid : undefined
  })
  const [ask, setAsk] = useState<RoleOfferAsk | undefined>()
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | undefined>()
  const on = isTrustedApproversEnabled()

  const load = useCallback(async () => {
    if (!agent || !connectionId) return
    setAsk(await roleOfferAskOn(agent, connectionId).catch(() => undefined))
  }, [agent, connectionId])

  useEffect(() => {
    if (!on) return
    void load()
    const refresh = (event: { connectionId?: string }) => {
      if (event?.connectionId === connectionId) void load()
    }
    approverRoleEvents.on('answered', refresh)
    approverRoleEvents.on('asked', refresh)
    return () => {
      approverRoleEvents.off('answered', refresh)
      approverRoleEvents.off('asked', refresh)
    }
  }, [on, load, connectionId])

  const onAsk = useCallback(async () => {
    if (!agent || !connectionId || !vtaDid || busy) return
    setBusy(true)
    setSaid(undefined)
    try {
      const result = await offerApproverRole(agent, connectionId, vtaDid, [...ROLE_ACTIONS])
      if (result === 'noRelationship') setSaid(t('Approver.NoRelationship', { name }))
      await load()
    } catch (error) {
      releaseWarn(`[VTI] approver ask not sent (${(error as Error)?.name ?? 'error'}: ${(error as Error)?.message})`)
      setSaid(t('Approver.NotSent', { name }))
    } finally {
      setBusy(false)
    }
  }, [agent, connectionId, vtaDid, busy, load, name, t])

  if (!on || !vtaDid || !connectionId) return null

  const styles = StyleSheet.create({
    row: { gap: 8 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    error: { color: ColorPalette.semantic.error },
  })
  const words = { name, interpolation: { escapeValue: false } }
  const state = ask?.state ?? 'closed'

  return (
    <View style={styles.row} testID={testIdWithKey(ApproverAskRowIds.row)}>
      {state === 'open' ? (
        <>
          <ThemedText testID={testIdWithKey(ApproverAskRowIds.status)}>{t('Approver.Waiting', words)}</ThemedText>
          <Button
            title={t('Approver.AskAgain')}
            buttonType={ButtonType.Tertiary}
            onPress={() => void onAsk()}
            disabled={busy}
            testID={testIdWithKey(ApproverAskRowIds.again)}
          />
        </>
      ) : state === 'accepted' ? (
        <ThemedText testID={testIdWithKey(ApproverAskRowIds.status)}>{t('Approver.SaidYes', words)}</ThemedText>
      ) : ask?.written ? (
        <ThemedText testID={testIdWithKey(ApproverAskRowIds.status)}>{t('Approver.IsApprover', words)}</ThemedText>
      ) : (
        <>
          <Button
            title={t('Approver.Ask', words)}
            buttonType={ButtonType.Secondary}
            onPress={() => void onAsk()}
            disabled={busy}
            testID={testIdWithKey(ApproverAskRowIds.ask)}
          >
            {busy ? <ActivityIndicator color={ColorPalette.brand.primary} /> : undefined}
          </Button>
          <ThemedText style={styles.muted}>{t('Approver.AskCaption', words)}</ThemedText>
        </>
      )}
      {said ? (
        <ThemedText style={styles.error} testID={testIdWithKey(ApproverAskRowIds.error)}>
          {said}
        </ThemedText>
      ) : null}
    </View>
  )
}

export default ApproverAskRow
