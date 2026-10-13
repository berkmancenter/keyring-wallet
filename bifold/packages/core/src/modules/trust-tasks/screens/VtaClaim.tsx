/**
 * Setting up an agent by scanning one code (`vta-claim`): an agent host's
 * "set up your agent" page shows a code; this screen confirms who it is from
 * (nothing sent), confirms the person as owner, claims it, shows the six
 * characters to compare with that page, waits for the host to hand the agent
 * over, and links to it as the manual setup does once its owner code is added.
 *
 * Provider-generic: the host is named by the host part of its DID, never by a
 * product name.
 *
 * @module trust-tasks/screens/VtaClaim
 */
import { useAgent } from '@bifold/react-hooks'
import { useNavigation } from '@react-navigation/native'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { TriggerAccept } from '../module/triggerLink'
import { AgentAlreadyOnPhone } from '../module/vtaAgent'
import { VtaClaimError, type ClaimedVta, type RedeemState, type VtaClaimFailure } from '../module/vtaClaim'
import { agentVtaClaimSteps, pendingVtaClaimLink, vtaClaimOf, type VtaClaimSteps } from '../module/vtaClaimSteps'

import { didHost } from './communityName'
import { DidDetails } from './DidDetails'
import { VtaClaimIds } from './VtaClaim.ids'

const id = (key: string) => testIdWithKey(key)

/** Every way the screen can end besides a ready agent; each has words (`VtaClaim.Failure.<reason>`). */
export type VtaClaimEndReason =
  | Exclude<VtaClaimFailure, 'cancelled'>
  | 'cannotOwn'
  | 'linkFailed'
  | 'alreadyOnPhone'
  | 'noCode'

type Step =
  | { kind: 'reading' }
  | { kind: 'confirm'; trigger: TriggerAccept; host: string }
  | { kind: 'claiming' }
  | { kind: 'code'; claimed: ClaimedVta; state?: RedeemState }
  | { kind: 'connecting' }
  | { kind: 'ready' }
  | { kind: 'failed'; reason: VtaClaimEndReason }

export interface VtaClaimFlowProps {
  /** The scanned code. */
  link: string | undefined
  steps: VtaClaimSteps
  /** Leave the screen. */
  onClose: () => void
}

const reasonOf = (error: unknown): VtaClaimEndReason => {
  if (error instanceof AgentAlreadyOnPhone) return 'alreadyOnPhone'
  if (error instanceof VtaClaimError && error.reason !== 'cancelled') return error.reason
  return 'unreachable'
}

export const VtaClaimFlow: React.FC<VtaClaimFlowProps> = ({ link, steps, onClose }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const [step, setStep] = useState<Step>({ kind: 'reading' })
  const [confirmError, setConfirmError] = useState<string | undefined>()
  const stopped = useRef(false)

  // Leaving the screen stops the asking; a claim never handed over stores nothing.
  useEffect(
    () => () => {
      stopped.current = true
    },
    []
  )

  const fail = useCallback((error: unknown) => {
    if (stopped.current) return
    setStep({ kind: 'failed', reason: reasonOf(error) })
  }, [])

  // 1. Read the code. Local only.
  useEffect(() => {
    if (!link) {
      setStep({ kind: 'failed', reason: 'noCode' })
      return
    }
    const read = vtaClaimOf(link)
    if (read instanceof VtaClaimError) {
      setStep({ kind: 'failed', reason: reasonOf(read) })
      return
    }
    setStep({ kind: 'confirm', trigger: read, host: didHost(read.from) ?? read.from })
  }, [link])

  const onContinue = async (trigger: TriggerAccept) => {
    setConfirmError(undefined)
    if (!(await steps.canOwn())) {
      setStep({ kind: 'failed', reason: 'cannotOwn' })
      return
    }
    // Becoming an agent's owner is an owner act: asked now, once.
    const confirmed = await steps.confirmOwner(t('VtaClaim.ConfirmReason'))
    if (!confirmed.ok) {
      if (confirmed.reason !== 'cancelled') setConfirmError(t('VtaClaim.NotConfirmed'))
      return
    }
    setStep({ kind: 'claiming' })
    let claimed: ClaimedVta
    try {
      claimed = await steps.claim(trigger)
    } catch (e) {
      fail(e)
      return
    }
    if (stopped.current) return
    setStep({ kind: 'code', claimed })
    try {
      const redeemed = await steps.redeem(claimed, {
        onState: (state) => {
          if (!stopped.current) setStep({ kind: 'code', claimed, state })
        },
        shouldStop: () => stopped.current,
      })
      if (stopped.current) return
      setStep({ kind: 'connecting' })
      const outcome = await steps.finish(claimed, redeemed)
      if (stopped.current) return
      setStep(outcome.kind === 'linked' ? { kind: 'ready' } : { kind: 'failed', reason: 'linkFailed' })
    } catch (e) {
      fail(e)
    }
  }

  const onCancelWaiting = () => {
    stopped.current = true
    onClose()
  }

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
        content: { flexGrow: 1, padding: 20, gap: 16 },
        card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
        muted: { color: ColorPalette.grayscale.mediumGrey },
        error: { color: ColorPalette.semantic.error },
        code: { fontSize: 40, letterSpacing: 8, textAlign: 'center', fontWeight: 'bold' },
        actions: { marginTop: 'auto', gap: 12 },
        center: { alignItems: 'center', gap: 12, paddingVertical: 24 },
      }),
    [ColorPalette]
  )

  const waiting = (testID: string, text: string) => (
    <View style={styles.center} testID={id(testID)}>
      <ActivityIndicator />
      <ThemedText>{text}</ThemedText>
    </View>
  )

  let body: React.ReactNode = null
  if (step.kind === 'reading' || step.kind === 'claiming') {
    body = waiting(VtaClaimIds.claiming, t('VtaClaim.Claiming'))
  } else if (step.kind === 'confirm') {
    body = (
      <>
        <View style={styles.card} testID={id(VtaClaimIds.confirm)}>
          <ThemedText variant="headingThree" accessibilityRole="header">
            {t('VtaClaim.ConfirmTitle')}
          </ThemedText>
          <ThemedText>
            {t('VtaClaim.ConfirmBody', { host: step.host, interpolation: { escapeValue: false } })}
          </ThemedText>
          <ThemedText style={styles.muted}>{t('VtaClaim.From')}</ThemedText>
          <ThemedText variant="headingFour" testID={id(VtaClaimIds.host)}>
            {step.host}
          </ThemedText>
          <DidDetails did={step.trigger.from} testIdStem={VtaClaimIds.hostDid} />
          {confirmError ? (
            <ThemedText style={styles.error} testID={id(VtaClaimIds.confirmError)}>
              {confirmError}
            </ThemedText>
          ) : null}
        </View>
        <View style={styles.actions}>
          <Button
            title={t('VtaClaim.Continue')}
            buttonType={ButtonType.Primary}
            onPress={() => void onContinue(step.trigger)}
            testID={id(VtaClaimIds.continue)}
          />
          <Button
            title={t('VtaClaim.Cancel')}
            buttonType={ButtonType.Secondary}
            onPress={onClose}
            testID={id(VtaClaimIds.cancel)}
          />
        </View>
      </>
    )
  } else if (step.kind === 'code') {
    const confirmedOnPage = step.state && step.state.state !== 'claimed'
    body = (
      <>
        <View style={styles.card} testID={id(VtaClaimIds.code)}>
          <ThemedText variant="headingThree" accessibilityRole="header">
            {t('VtaClaim.CodeTitle')}
          </ThemedText>
          <ThemedText>{t('VtaClaim.CodeBody')}</ThemedText>
          <ThemedText
            style={styles.code}
            testID={id(VtaClaimIds.codeValue)}
            accessibilityLabel={step.claimed.claimCheck.split('').join(' ')}
          >
            {step.claimed.claimCheck}
          </ThemedText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator />
            <ThemedText style={styles.muted} testID={id(VtaClaimIds.codeStatus)}>
              {confirmedOnPage ? t('VtaClaim.Provisioning') : t('VtaClaim.WaitingConfirm')}
            </ThemedText>
          </View>
        </View>
        <View style={styles.actions}>
          <Button
            title={t('VtaClaim.Cancel')}
            buttonType={ButtonType.Secondary}
            onPress={onCancelWaiting}
            testID={id(VtaClaimIds.codeCancel)}
          />
        </View>
      </>
    )
  } else if (step.kind === 'connecting') {
    body = waiting(VtaClaimIds.connecting, t('VtaClaim.Connecting'))
  } else {
    const ready = step.kind === 'ready'
    body = (
      <>
        <View style={styles.card} testID={id(ready ? VtaClaimIds.ready : VtaClaimIds.failed)}>
          <ThemedText variant="headingThree" accessibilityRole="header">
            {ready ? t('VtaClaim.ReadyTitle') : t('VtaClaim.FailedTitle')}
          </ThemedText>
          <ThemedText testID={id(VtaClaimIds.resultMessage)}>
            {ready ? t('VtaClaim.ReadyBody') : t(`VtaClaim.Failure.${step.reason}`)}
          </ThemedText>
        </View>
        <View style={styles.actions}>
          <Button
            title={t('VtaClaim.Done')}
            buttonType={ButtonType.Primary}
            onPress={onClose}
            testID={id(VtaClaimIds.done)}
          />
        </View>
      </>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']} testID={id(VtaClaimIds.screen)}>
      <ScrollView contentContainerStyle={styles.content}>{body}</ScrollView>
    </SafeAreaView>
  )
}

const VtaClaim: React.FC<{ steps?: VtaClaimSteps; link?: string }> = ({ steps, link }) => {
  const { agent } = useAgent()
  const navigation = useNavigation()
  const code = useMemo(() => link ?? pendingVtaClaimLink.peek(), [link])
  useEffect(() => () => pendingVtaClaimLink.clear(), [])
  const agentSteps = useMemo(() => steps ?? (agent ? agentVtaClaimSteps(agent) : undefined), [steps, agent])
  if (!agentSteps) return null
  return <VtaClaimFlow link={code} steps={agentSteps} onClose={() => navigation.goBack()} />
}

export default VtaClaim
