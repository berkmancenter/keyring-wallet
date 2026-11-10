/**
 * "Who approves": the people who approve for this person on their agent (trusted-approver plan §4 step 3), and the
 * people this person approves for.
 *
 * A contact who said yes to an offer (approverRole.ts) waits here until the person adds them: adding writes the one
 * trusted set and its rules on the agent (`vtaAgent.setTrustedApprovers`, Face ID first). Removing one is the same
 * write without them; the agent may hold that for the approvers' yes, as it holds any rule change they cover.
 * Approvers are named from the relationships this phone asked over; one added some other way is said to be someone
 * not in the contacts.
 *
 * Reached from My agent only while the trusted-approvers switch is on.
 *
 * @module trust-tasks/screens/VtaTrustedApprovers
 */
import { useAgent } from '@bifold/react-hooks'
import { useFocusEffect } from '@react-navigation/native'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import {
  acceptedRoleOffers,
  approverNames,
  approverRemoved,
  approverRoleEvents,
  approvingFor,
  closeRoleOffer,
  nextTrustedRules,
  withoutApprover,
  type RoleOfferAsk,
  type RoleOfferPrompt,
} from '../approverRole'
import { releaseWarn } from '../module/releaseLog'
import { vtaAgent, type TrustedApproversState } from '../module/vtaAgent'

import { localDate } from './localTime'
import { deviceErrorWords } from './VtaDevices'

export const TrustedApproversIds = {
  screen: 'TrustedApprovers',
  error: 'TrustedApproversError',
  none: 'TrustedApproversNone',
  approver: (did: string) => `TrustedApprover_${did}`,
  remove: (did: string) => `TrustedApproverRemove_${did}`,
  accepted: (connectionId: string) => `TrustedApproverAccepted_${connectionId}`,
  add: (connectionId: string) => `TrustedApproverAdd_${connectionId}`,
  notNow: (connectionId: string) => `TrustedApproverNotNow_${connectionId}`,
  approvingFor: 'TrustedApproversApprovingFor',
} as const

const VtaTrustedApprovers: React.FC = () => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const [state, setState] = useState<TrustedApproversState | undefined>()
  const [accepted, setAccepted] = useState<RoleOfferAsk[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [mine, setMine] = useState<RoleOfferPrompt[]>([])
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState<string | undefined>()

  const wordsFor = useCallback((e: unknown) => deviceErrorWords(e, t), [t])

  /** What this phone keeps (yeses, names, people I approve for): read without the agent. */
  const loadKept = useCallback(async () => {
    if (!agent) return
    const [yeses, known, approving] = await Promise.all([
      acceptedRoleOffers(agent),
      approverNames(agent),
      approvingFor(agent),
    ]).catch(() => [[], {}, []] as [RoleOfferAsk[], Record<string, string>, RoleOfferPrompt[]])
    setAccepted(yeses)
    setNames(known)
    setMine(approving)
  }, [agent])

  const load = useCallback(
    async (options: { keepError?: boolean } = {}) => {
      if (!agent) return
      if (!options.keepError) setError(undefined)
      await loadKept()
      try {
        setState(await vtaAgent.trustedApprovers(agent))
      } catch (e) {
        setError(wordsFor(e))
      }
    },
    [agent, loadKept, wordsFor]
  )

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  useEffect(() => {
    const refresh = () => void loadKept()
    approverRoleEvents.on('answered', refresh)
    approverRoleEvents.on('promptCleared', refresh)
    return () => {
      approverRoleEvents.off('answered', refresh)
      approverRoleEvents.off('promptCleared', refresh)
    }
  }, [loadKept])

  const write = async (key: string, rules: { approvers: string[]; keys: TrustedApproversState['view']['keys'] }) => {
    if (!agent) return undefined
    setError(undefined)
    setBusy(key)
    try {
      const next = await vtaAgent.setTrustedApprovers(agent, rules.approvers, rules.keys)
      setState(next)
      return next
    } catch (e) {
      releaseWarn(`[VTI] who approves: not changed (${(e as Error)?.name ?? 'error'}: ${(e as Error)?.message ?? e})`)
      setError(wordsFor(e))
      await load({ keepError: true })
      return undefined
    } finally {
      setBusy(undefined)
    }
  }

  const onAdd = async (ask: RoleOfferAsk) => {
    if (!agent || !state) return
    const written = await write(ask.connectionId, nextTrustedRules(state.view, ask))
    if (!written || !ask.acceptedAs || !written.view.approvers.includes(ask.acceptedAs)) return
    await closeRoleOffer(agent, ask.connectionId, true).catch(() => undefined)
    await loadKept()
  }

  const onNotNow = async (ask: RoleOfferAsk) => {
    if (!agent) return
    await closeRoleOffer(agent, ask.connectionId, false).catch(() => undefined)
    await loadKept()
  }

  const onRemove = async (did: string) => {
    if (!agent || !state) return
    const written = await write(did, withoutApprover(state.view, did))
    if (!written || written.view.approvers.includes(did)) return
    await approverRemoved(agent, did).catch(() => undefined)
  }

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 20, gap: 16 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 6 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    error: { color: ColorPalette.semantic.error },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })

  const view = state?.view
  const actionList = (keys: readonly string[]) => keys.map((key) => t(`Approver.Action.${key}`)).join(', ')
  const nameOf = (did: string) => names[did] ?? t('Approver.Unnamed')
  const waiting = accepted.filter((ask) => !view?.approvers.includes(ask.acceptedAs as string))

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} testID={testIdWithKey(TrustedApproversIds.screen)}>
        <ThemedText>{t('Approver.Intro')}</ThemedText>
        {error ? (
          <ThemedText style={styles.error} testID={testIdWithKey(TrustedApproversIds.error)}>
            {error}
          </ThemedText>
        ) : null}

        {waiting.map((ask) => {
          const name = names[ask.acceptedAs as string] ?? t('Approver.UnnamedContact')
          return (
            <View
              key={ask.connectionId}
              style={styles.card}
              testID={testIdWithKey(TrustedApproversIds.accepted(ask.connectionId))}
            >
              <ThemedText variant="bold">{name}</ThemedText>
              <ThemedText style={styles.muted}>{t('Approver.Accepted')}</ThemedText>
              <ThemedText>{actionList(ask.actions)}</ThemedText>
              <Button
                title={t('Approver.Add', { name, interpolation: { escapeValue: false } })}
                buttonType={ButtonType.Primary}
                onPress={() => void onAdd(ask)}
                disabled={!view || busy !== undefined}
                testID={testIdWithKey(TrustedApproversIds.add(ask.connectionId))}
              >
                {busy === ask.connectionId ? <ActivityIndicator color={ColorPalette.brand.primary} /> : undefined}
              </Button>
              <Button
                title={t('Approver.NotNow')}
                buttonType={ButtonType.Tertiary}
                onPress={() => void onNotNow(ask)}
                disabled={busy !== undefined}
                testID={testIdWithKey(TrustedApproversIds.notNow(ask.connectionId))}
              />
            </View>
          )
        })}

        <ThemedText variant="bold" accessibilityRole="header">
          {t('Approver.Approvers')}
        </ThemedText>
        {!view && !error ? (
          <View style={styles.row}>
            <ActivityIndicator color={ColorPalette.brand.primary} />
            <ThemedText style={styles.muted}>{t('Approver.Loading')}</ThemedText>
          </View>
        ) : null}
        {view && view.approvers.length === 0 ? (
          <ThemedText testID={testIdWithKey(TrustedApproversIds.none)}>{t('Approver.None')}</ThemedText>
        ) : null}
        {view?.approvers.map((did) => (
          <View key={did} style={styles.card} testID={testIdWithKey(TrustedApproversIds.approver(did))}>
            <ThemedText variant="bold">{nameOf(did)}</ThemedText>
            <ThemedText style={styles.muted}>{t('Approver.Covers')}</ThemedText>
            <ThemedText>{actionList(view.keys)}</ThemedText>
            <Button
              title={t('Approver.Remove')}
              buttonType={ButtonType.Secondary}
              onPress={() => void onRemove(did)}
              disabled={busy !== undefined}
              testID={testIdWithKey(TrustedApproversIds.remove(did))}
            >
              {busy === did ? <ActivityIndicator color={ColorPalette.brand.primary} /> : undefined}
            </Button>
          </View>
        ))}
        {view && view.approvers.length > 0 ? (
          <ThemedText style={styles.muted}>{t('Approver.RemoveNeedsYes')}</ThemedText>
        ) : null}
        {view?.heldElsewhere.length ? (
          <ThemedText style={styles.muted}>
            {t('Approver.HeldElsewhere', { actions: actionList(view.heldElsewhere) })}
          </ThemedText>
        ) : null}

        <ThemedText variant="bold" accessibilityRole="header">
          {t('Approver.IApproveFor')}
        </ThemedText>
        <View testID={testIdWithKey(TrustedApproversIds.approvingFor)} style={{ gap: 8 }}>
          {mine.length === 0 ? <ThemedText style={styles.muted}>{t('Approver.IApproveForNone')}</ThemedText> : null}
          {mine.map((prompt) => (
            <View key={prompt.connectionId} style={styles.card}>
              <ThemedText variant="bold">{prompt.asker || t('Approver.UnnamedContact')}</ThemedText>
              <ThemedText>{actionList(prompt.actions)}</ThemedText>
              <ThemedText style={styles.muted}>
                {t('Approver.IApproveForSince', { date: localDate(prompt.receivedAt) })}
              </ThemedText>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

export default VtaTrustedApprovers
