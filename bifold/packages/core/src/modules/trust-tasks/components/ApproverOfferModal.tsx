/**
 * "Be an approver for {{asker}}?" — the asked phone's half of the role offer (approverRole.ts). Shown when a contact's
 * offer arrives, verified under the relationship this phone has with them; never one that failed that check.
 *
 * Accept asks for Face ID first (an owner act, as Approve on a request is): not confirmed, nothing is sent and the offer
 * stays. Then it names the DID this phone approves as, its manager DID on its own linked agent (`vtaAgent.approverDid`), so a yes
 * needs this phone linked; without that only No and Not now are offered, and it says why. No sends a signed no.
 * Not now sends nothing and hides the offer until the app starts again (it is kept, and comes back then).
 *
 * After a yes, if this phone holds a state Guardian card and its person was never asked about this contact, the same
 * sheet asks once: "Also send your Guardian card to <asker>?" (guardianEvidence.ts). Send keeps the answer and sends
 * the card; Don't send keeps a no, and nothing goes. The yes already stands either way.
 *
 * Self-contained: mounted once at the root beside ContinuityCheckModal. With the trusted-approvers switch off it shows
 * nothing and brings nothing back; with state-verified approvers off it asks nothing about a card.
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import {
  approverRoleEvents,
  respondToRoleOffer,
  restoreRoleOfferPrompts,
  roleOfferPromptStore,
  type RoleOfferPrompt,
} from '../approverRole'
import { cardQuestions, guardianCardEvents, shareGuardianCard, type CardQuestion } from '../guardianEvidence'
import { DemoPill } from './DemoPill'
import { releaseWarn } from '../module/releaseLog'
import { ownerLockKind, type OwnerLockKind } from '../module/ownerConfirm'
import { isStateVerifiedApproversEnabled } from '../module/stateVerifiedApproversFlag'
import { isTrustedApproversEnabled } from '../module/trustedApproversFlag'
import { vtaAgent } from '../module/vtaAgent'
import { OwnerNotConfirmed } from '../module/vtaOwner'

export const ApproverOfferIds = {
  sheet: 'ApproverOffer',
  body: 'ApproverOfferBody',
  yes: 'ApproverOfferYes',
  no: 'ApproverOfferNo',
  notNow: 'ApproverOfferNotNow',
  needsAgent: 'ApproverOfferNeedsAgent',
  failed: 'ApproverOfferFailed',
  faceId: 'ApproverOfferFaceId',
  cardAsk: 'ApproverOfferCardAsk',
  cardAskDemo: 'ApproverOfferCardAskDemo',
  cardSend: 'ApproverOfferCardSend',
  cardDont: 'ApproverOfferCardDont',
} as const

/** Offers put off with Not now, by connection, until the app starts again. */
const putOff = new Set<string>()

/** Tests only. */
export const resetPutOff = () => putOff.clear()

const firstShown = () => roleOfferPromptStore.list().find((prompt) => prompt.open && !putOff.has(prompt.connectionId))

const ApproverOfferModal: React.FC = () => {
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const { t } = useTranslation()
  const on = isTrustedApproversEnabled()
  const [prompt, setPrompt] = useState<RoleOfferPrompt | undefined>(() => (on ? firstShown() : undefined))
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  // The person's own lock, named as VtaCreateAgent names it: not everyone has Face ID.
  const [lockKind, setLockKind] = useState<OwnerLockKind>('unknown')
  useEffect(() => {
    let live = true
    void ownerLockKind().then((kind) => live && setLockKind(kind))
    return () => {
      live = false
    }
  }, [])
  const [question, setQuestion] = useState<CardQuestion | undefined>(() => (on ? cardQuestions.first() : undefined))
  const linked = useSyncExternalStore(vtaAgent.subscribe, () => vtaAgent.getState().link.kind === 'linked')

  useEffect(() => {
    if (!agent || !on) return
    restoreRoleOfferPrompts(agent).catch((error: unknown) =>
      releaseWarn(`[VTI] approver offers not brought back: ${(error as Error)?.message ?? error}`)
    )
  }, [agent, on])

  useEffect(() => {
    if (!on) return
    const ask = () => setQuestion(cardQuestions.first())
    guardianCardEvents.on('question', ask)
    return () => {
      guardianCardEvents.off('question', ask)
    }
  }, [on])

  const share = useCallback(
    async (send: boolean) => {
      if (!agent || !question || busy) return
      setBusy(true)
      try {
        await shareGuardianCard(agent, question.connectionId, send)
        releaseWarn(`[VTI] guardian card answer: ${send ? 'send' : "don't send"}`)
      } catch (error) {
        releaseWarn(`[VTI] guardian card answer not kept (${(error as Error)?.name ?? 'error'})`)
      } finally {
        setBusy(false)
        setQuestion(cardQuestions.first())
      }
    },
    [agent, question, busy]
  )

  useEffect(() => {
    if (!on) return
    const refresh = () => setPrompt(firstShown())
    approverRoleEvents.on('offer', refresh)
    approverRoleEvents.on('promptCleared', refresh)
    return () => {
      approverRoleEvents.off('offer', refresh)
      approverRoleEvents.off('promptCleared', refresh)
    }
  }, [on])

  const answer = useCallback(
    async (accept: boolean) => {
      if (!agent || !prompt || busy) return
      setBusy(true)
      setFailed(false)
      try {
        const approverDid = accept
          ? await vtaAgent.acceptAsApprover(
              agent,
              t('Approver.AcceptReason', {
                asker: prompt.asker || t('Approver.UnnamedContact'),
                interpolation: { escapeValue: false },
              })
            )
          : undefined
        await respondToRoleOffer(agent, prompt.connectionId, accept, approverDid)
        releaseWarn(`[VTI] approver offer answered: ${accept ? 'yes' : 'no'}`)
      } catch (error) {
        releaseWarn(
          `[VTI] approver answer not sent (${(error as Error)?.name ?? 'error'}: ${(error as Error)?.message})`
        )
        // Cancelled at Face ID: the person chose not to, so nothing failed; the offer simply stays.
        if (!(error instanceof OwnerNotConfirmed && error.reason === 'cancelled')) setFailed(true)
      } finally {
        setBusy(false)
      }
    },
    [agent, prompt, busy, t]
  )

  const notNow = useCallback(() => {
    if (!prompt) return
    putOff.add(prompt.connectionId)
    setFailed(false)
    setPrompt(firstShown())
  }, [prompt])

  // An offer comes first; a card question shows when no offer is open, and only with state-verified approvers on.
  const asking = !prompt && question && isStateVerifiedApproversEnabled() ? question : undefined
  if (!on || (!prompt && !asking)) return null

  const words = {
    asker: prompt?.asker || t('Approver.UnnamedContact'),
    interpolation: { escapeValue: false },
  }
  const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    safeAreaView: {
      flexShrink: 1,
      backgroundColor: ColorPalette.brand.modalPrimaryBackground,
      borderTopRightRadius: 20,
      borderTopLeftRadius: 20,
    },
    container: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 24, gap: 12 },
    centred: { textAlign: 'center' },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    error: { color: ColorPalette.semantic.error, textAlign: 'center' },
  })

  return (
    <SafeAreaModal visible transparent animationType="slide">
      <SafeAreaView style={styles.overlay} edges={['top']}>
        <SafeAreaView style={styles.safeAreaView} edges={['bottom']}>
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.container}
            testID={testIdWithKey(ApproverOfferIds.sheet)}
          >
            {asking ? (
              <>
                <ThemedText
                  variant="headingThree"
                  style={styles.centred}
                  accessibilityRole="header"
                  testID={testIdWithKey(ApproverOfferIds.cardAsk)}
                >
                  {asking.state
                    ? t('Approver.CardAskTitle', {
                        state: asking.state,
                        asker: asking.asker || t('Approver.UnnamedContact'),
                        interpolation: { escapeValue: false },
                      })
                    : t('Approver.CardAskTitleNoState', {
                        asker: asking.asker || t('Approver.UnnamedContact'),
                        interpolation: { escapeValue: false },
                      })}
                </ThemedText>
                {asking.state && asking.demo ? (
                  <DemoPill testID={ApproverOfferIds.cardAskDemo} test={asking.test === true} />
                ) : null}
                <ThemedText>
                  {t('Approver.CardAskBody', {
                    asker: asking.asker || t('Approver.UnnamedContact'),
                    interpolation: { escapeValue: false },
                  })}
                </ThemedText>
                <Button
                  title={t('Approver.CardAskSend')}
                  buttonType={ButtonType.Primary}
                  onPress={() => void share(true)}
                  disabled={busy}
                  testID={testIdWithKey(ApproverOfferIds.cardSend)}
                />
                <Button
                  title={t('Approver.CardAskDont')}
                  buttonType={ButtonType.Secondary}
                  onPress={() => void share(false)}
                  disabled={busy}
                  testID={testIdWithKey(ApproverOfferIds.cardDont)}
                />
              </>
            ) : null}
            {prompt ? (
              <>
                <ThemedText variant="headingThree" style={styles.centred} accessibilityRole="header">
                  {t('Approver.OfferTitle', words)}
                </ThemedText>
                <ThemedText testID={testIdWithKey(ApproverOfferIds.body)}>{t('Approver.OfferBody', words)}</ThemedText>
                {prompt?.actions.map((action) => (
                  <ThemedText key={action}>• {t(`Approver.Action.${action}`)}</ThemedText>
                ))}
                <ThemedText style={styles.muted}>{t('Approver.OfferHow')}</ThemedText>
                {!linked ? (
                  <ThemedText style={styles.muted} testID={testIdWithKey(ApproverOfferIds.needsAgent)}>
                    {t('Approver.OfferNeedsAgent')}
                  </ThemedText>
                ) : null}
                {failed ? (
                  <ThemedText style={styles.error} testID={testIdWithKey(ApproverOfferIds.failed)}>
                    {t('Approver.OfferFailed')}
                  </ThemedText>
                ) : null}
                <Button
                  title={t('Approver.OfferYes')}
                  buttonType={ButtonType.Primary}
                  onPress={() => void answer(true)}
                  disabled={busy || !linked}
                  testID={testIdWithKey(ApproverOfferIds.yes)}
                />
                <Button
                  title={t('Approver.OfferNo')}
                  buttonType={ButtonType.Secondary}
                  onPress={() => void answer(false)}
                  disabled={busy}
                  testID={testIdWithKey(ApproverOfferIds.no)}
                />
                <Button
                  title={t('Approver.OfferNotNow')}
                  buttonType={ButtonType.Tertiary}
                  onPress={notNow}
                  disabled={busy}
                  testID={testIdWithKey(ApproverOfferIds.notNow)}
                />
                <ThemedText style={[styles.muted, styles.centred]} testID={testIdWithKey(ApproverOfferIds.faceId)}>
                  {t('Approver.AcceptAsksLock', { method: t(`CreateAgent.Lock.${lockKind}`) })}
                </ThemedText>
              </>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </SafeAreaView>
    </SafeAreaModal>
  )
}

export default ApproverOfferModal
