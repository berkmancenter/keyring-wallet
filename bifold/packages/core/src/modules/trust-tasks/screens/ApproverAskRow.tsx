/**
 * "Ask {{name}} to be my approver", on a contact's page (trusted-approver plan §4 steps 1–2; mock frames 1a–1c):
 * the person first chooses what needs the contact's yes, then the role offer goes over the relationship this phone
 * already has with the contact (approverRole.ts), and the row says where it stands.
 *
 * Changing who approves is always in the offer, and cannot be switched off here (Alberto, 2026-11-09: removing the
 * approver needs the approver's yes), so nobody can talk the person into dropping the approver unasked. At least one
 * other action must be chosen.
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
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import {
  approverRoleEvents,
  offerApproverRole,
  roleOfferAskOn,
  type RoleAction,
  type RoleOfferAsk,
} from '../approverRole'
import { ROLE_ACTIONS } from '../approverRoleSpec'
import { releaseWarn } from '../module/releaseLog'
import { TRUSTED_TASKS } from '../module/trustedApprovers'
import { isTrustedApproversEnabled } from '../module/trustedApproversFlag'
import { vtaAgent } from '../module/vtaAgent'

export const ApproverAskRowIds = {
  row: 'ApproverAsk',
  ask: 'ApproverAskButton',
  again: 'ApproverAskAgain',
  status: 'ApproverAskStatus',
  error: 'ApproverAskError',
  pick: (action: RoleAction) => `ApproverPick_${action}`,
  send: 'ApproverPickSend',
  cancel: 'ApproverPickCancel',
  asked: 'ApproverAskedActions',
  steppedDown: 'ApproverSteppedDown',
} as const

/** Always offered, never switched off here. */
const LOCKED: RoleAction = 'changeApprovers'
/** The order the choice shows them in (the mock's). */
const PICK_ORDER: RoleAction[] = ['joinCommunity', 'shareCredential', 'addDevice', 'changeApprovers']
const conditional = (action: RoleAction) => TRUSTED_TASKS.find((t) => t.key === action)?.conditional ?? false

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
  const [picking, setPicking] = useState(false)
  const [chosen, setChosen] = useState<RoleAction[]>([...ROLE_ACTIONS])
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

  const send = useCallback(
    async (actions: readonly RoleAction[]) => {
      if (!agent || !connectionId || !vtaDid || busy) return
      setBusy(true)
      setSaid(undefined)
      try {
        const result = await offerApproverRole(agent, connectionId, vtaDid, actions)
        if (result === 'noRelationship') setSaid(t('Approver.NoRelationship', { name }))
        else setPicking(false)
        await load()
      } catch (error) {
        releaseWarn(`[VTI] approver ask not sent (${(error as Error)?.name ?? 'error'}: ${(error as Error)?.message})`)
        setSaid(t('Approver.NotSent', { name }))
      } finally {
        setBusy(false)
      }
    },
    [agent, connectionId, vtaDid, busy, load, name, t]
  )

  if (!on || !vtaDid || !connectionId) return null

  const styles = StyleSheet.create({
    row: { gap: 8 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    pick: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
    grow: { flex: 1, gap: 2 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    error: { color: ColorPalette.semantic.error },
  })
  const words = { name, interpolation: { escapeValue: false } }
  const state = ask?.state ?? 'closed'
  const steppedDown = ask?.steppedDown ? (
    <ThemedText style={styles.muted} testID={testIdWithKey(ApproverAskRowIds.steppedDown)}>
      {t(ask.written ? 'Approver.SteppedDownWritten' : 'Approver.SteppedDown', words)}
    </ThemedText>
  ) : null
  const actionLines = (actions: readonly RoleAction[]) => (
    <View testID={testIdWithKey(ApproverAskRowIds.asked)}>
      {PICK_ORDER.filter((action) => actions.includes(action)).map((action) => (
        <ThemedText key={action}>{`• ${t(`Approver.Action.${action}`)}`}</ThemedText>
      ))}
    </View>
  )
  const choosable = chosen.some((action) => action !== LOCKED)
  const toggle = (action: RoleAction) =>
    setChosen((now) => (now.includes(action) ? now.filter((a) => a !== action) : [...now, action]))

  let body: React.ReactNode
  if (picking) {
    // Mock frame 1b: what needs the contact's yes.
    body = (
      <View style={styles.card}>
        <ThemedText variant="bold">{t('Approver.PickTitle', words)}</ThemedText>
        <ThemedText style={styles.muted}>{t('Approver.PickBody', words)}</ThemedText>
        {PICK_ORDER.map((action) => {
          const locked = action === LOCKED
          const value = locked || chosen.includes(action)
          return (
            <Pressable
              key={action}
              style={styles.pick}
              onPress={() => toggle(action)}
              disabled={locked || busy}
              accessibilityRole="switch"
              accessibilityLabel={t(`Approver.Action.${action}`)}
              accessibilityState={{ checked: value, disabled: locked || busy }}
              testID={testIdWithKey(ApproverAskRowIds.pick(action))}
            >
              <View style={styles.grow}>
                <ThemedText>{t(`Approver.Action.${action}`)}</ThemedText>
                {locked ? <ThemedText style={styles.muted}>{t('Approver.AlwaysOn', words)}</ThemedText> : null}
                {conditional(action) ? (
                  <ThemedText style={styles.muted}>{t('Approver.MayNotHoldYet')}</ThemedText>
                ) : null}
              </View>
              {/* Shown, never pressed: the row takes the press (as Ask me before…). */}
              <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                <Switch value={value} disabled={locked || busy} />
              </View>
            </Pressable>
          )
        })}
        {!choosable ? <ThemedText style={styles.muted}>{t('Approver.PickOne')}</ThemedText> : null}
        <Button
          title={t('Approver.Send', words)}
          buttonType={ButtonType.Primary}
          onPress={() => void send([...new Set([...chosen, LOCKED])])}
          disabled={busy || !choosable}
          testID={testIdWithKey(ApproverAskRowIds.send)}
        >
          {busy ? <ActivityIndicator color={ColorPalette.brand.primary} /> : undefined}
        </Button>
        <Button
          title={t('Global.Cancel')}
          buttonType={ButtonType.Tertiary}
          onPress={() => setPicking(false)}
          disabled={busy}
          testID={testIdWithKey(ApproverAskRowIds.cancel)}
        />
      </View>
    )
  } else if (state === 'open' && ask) {
    // Mock frame 1c: sent, waiting.
    body = (
      <View style={styles.card}>
        <ThemedText variant="bold" testID={testIdWithKey(ApproverAskRowIds.status)}>
          {t('Approver.Waiting', words)}
        </ThemedText>
        <ThemedText>{t('Approver.WaitingBody', words)}</ThemedText>
        {actionLines(ask.actions)}
        <ThemedText style={styles.muted}>{t('Approver.WaitingNo', words)}</ThemedText>
        <Button
          title={t('Approver.AskAgain')}
          buttonType={ButtonType.Tertiary}
          onPress={() => void send(ask.actions)}
          disabled={busy}
          testID={testIdWithKey(ApproverAskRowIds.again)}
        />
      </View>
    )
  } else if (state === 'accepted') {
    body = <ThemedText testID={testIdWithKey(ApproverAskRowIds.status)}>{t('Approver.SaidYes', words)}</ThemedText>
  } else if (ask?.written) {
    body = (
      <>
        <ThemedText testID={testIdWithKey(ApproverAskRowIds.status)}>{t('Approver.IsApprover', words)}</ThemedText>
        {steppedDown}
      </>
    )
  } else {
    // Mock frame 1a.
    body = (
      <View style={styles.card}>
        {steppedDown}
        <ThemedText variant="bold">{t('Approver.AskHeading')}</ThemedText>
        <ThemedText>{t('Approver.AskBody', words)}</ThemedText>
        <Button
          title={t('Approver.Ask', words)}
          buttonType={ButtonType.Secondary}
          onPress={() => {
            setSaid(undefined)
            setChosen([...ROLE_ACTIONS])
            setPicking(true)
          }}
          disabled={busy}
          testID={testIdWithKey(ApproverAskRowIds.ask)}
        />
        <ThemedText style={styles.muted}>{t('Approver.AskCaption', words)}</ThemedText>
      </View>
    )
  }

  return (
    <View style={styles.row} testID={testIdWithKey(ApproverAskRowIds.row)}>
      <ThemedText variant="bold" accessibilityRole="header">
        {t('Approver.AskTitle')}
      </ThemedText>
      {body}
      {said ? (
        <ThemedText style={styles.error} testID={testIdWithKey(ApproverAskRowIds.error)}>
          {said}
        </ThemedText>
      ) : null}
    </View>
  )
}

export default ApproverAskRow
