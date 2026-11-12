/**
 * "{{asker}} asks you to confirm": the asked phone's half of Confirm it's you (confirmItsYou.ts; mocks
 * GVGac4je… frames 3a–3c, 5). Shown when a contact's request arrives, verified under the relationship this phone has
 * with them, and never one that failed that check or is past its time.
 *
 * The note is shown exactly as the asker typed it, as plain text. "Confirm" and "No, that wasn't me" both ask for
 * the phone's own lock first (Face ID, fingerprint, or the phone's PIN or passcode): not confirmed, nothing is sent and
 * the request stays. Once sent, the sheet says what was sent and when. Not now sends nothing and hides the request
 * until the app starts again (it is kept, and comes back then while it is still open).
 *
 * When the request's time runs out with the sheet up, the sheet stays and says "This request has expired", with no
 * way left to answer, until Close (the same when an answer is tried just after the time ran out). Local only: nothing
 * is sent and no message says so. What this phone cannot know, it does not claim: the asker's Cancel is local to the
 * asker's phone (confirmItsYou.ts cancelConfirmRequest sends nothing), so a cancelled request still reads as open here
 * until its time runs out, and only then as expired. A request that ran out while no sheet was up is not shown at all.
 *
 * Self-contained: mounted once at the root beside ApproverOfferModal. With the switch off it shows nothing and brings
 * nothing back; the switch is read at every render.
 *
 * @module trust-tasks/components/ConfirmItsYouModal
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import {
  answerConfirmRequest,
  confirmEvents,
  confirmPromptStore,
  namedLock,
  restoreConfirmPrompts,
  type ConfirmPrompt,
  type ConfirmTheOwner,
} from '../confirmItsYou'
import type { ConfirmDecision } from '../confirmItsYouSpec'
import { isConfirmItsYouEnabled } from '../module/confirmItsYouFlag'
import { confirmOwner, ownerLockKind, type OwnerLockKind } from '../module/ownerConfirm'
import { releaseWarn } from '../module/releaseLog'

export const ConfirmItsYouModalIds = {
  sheet: 'ConfirmItsYouSheet',
  note: 'ConfirmItsYouSheetNote',
  itsMe: 'ConfirmItsYouItsMe',
  expired: 'ConfirmItsYouExpired',
  close: 'ConfirmItsYouClose',
  notMe: 'ConfirmItsYouNotMe',
  notNow: 'ConfirmItsYouNotNow',
  lock: 'ConfirmItsYouLock',
  failed: 'ConfirmItsYouFailed',
  sent: 'ConfirmItsYouSent',
  done: 'ConfirmItsYouDone',
} as const

/** Requests put off with Not now, by connection, until the app starts again. */
const putOff = new Set<string>()

/** Tests only. */
export const resetConfirmPutOff = () => putOff.clear()

/**
 * The phone owner's check: the app's own (Face ID, fingerprint or passcode), read when an answer is given, never at
 * load (a suite that stubs ownerConfirm must not break this module's load). Replaceable in tests only.
 */
let ownerCheckForTests: ConfirmTheOwner | null = null
/** Tests only. */
export const setConfirmOwnerCheckForTests = (check: ConfirmTheOwner | null) => {
  ownerCheckForTests = check
}
const ownerCheck: ConfirmTheOwner = (reason) => (ownerCheckForTests ?? confirmOwner)(reason)

const firstShown = () => confirmPromptStore.list().find((prompt) => !putOff.has(prompt.connectionId))

/**
 * The same rule as confirmItsYou.ts's pastDue. The negation is deliberate: an unreadable or missing expiresAt parses
 * to NaN, and NaN must read as past due (never as still open). `Date.parse(x) <= Date.now()` would read NaN as open.
 */
const pastDue = (expiresAt: string | null | undefined) => !(Date.parse(String(expiresAt)) > Date.now())

const timeOf = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

interface Sent {
  asker: string
  decision: ConfirmDecision
  at: Date
  /** The lock the answer named, if it named one (namedLock); absent, the words name none. */
  lock?: string
}

const ConfirmItsYouModal: React.FC = () => {
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const { t } = useTranslation()
  const on = isConfirmItsYouEnabled()
  const [prompt, setPrompt] = useState<ConfirmPrompt | undefined>(() => (on ? firstShown() : undefined))
  const [sent, setSent] = useState<Sent | null>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [lockKind, setLockKind] = useState<OwnerLockKind>('unknown')
  // The request whose time ran out while it was on screen: kept to say so, with nothing left to answer.
  const [expired, setExpired] = useState<ConfirmPrompt | null>(null)

  // Only for the hint's words ("Either answer asks for Face ID"); the answer reads the lock again when it is sent. Off,
  // nothing runs, not even the keychain probe.
  useEffect(() => {
    if (!on) return
    let live = true
    void ownerLockKind().then((kind) => live && setLockKind(kind))
    return () => {
      live = false
    }
  }, [on])

  useEffect(() => {
    if (!agent || !on) return
    restoreConfirmPrompts(agent).catch((error: unknown) =>
      releaseWarn(`[VTI] confirm requests not brought back: ${(error as Error)?.message ?? error}`)
    )
  }, [agent, on])

  useEffect(() => {
    if (!on) return
    const refresh = () => setPrompt(firstShown())
    confirmEvents.on('prompt', refresh)
    confirmEvents.on('promptCleared', refresh)
    return () => {
      confirmEvents.off('prompt', refresh)
      confirmEvents.off('promptCleared', refresh)
    }
  }, [on])

  // A clock: a request left open on screen says it has expired when its time is up, with no event to say so.
  useEffect(() => {
    if (!on || !prompt) return
    const untilDue = Math.max(0, Date.parse(prompt.expiresAt) - Date.now()) + 50
    const timer = setTimeout(() => {
      setExpired(prompt)
      setSaid(null)
      setPrompt(undefined)
    }, untilDue)
    return () => clearTimeout(timer)
  }, [on, prompt])

  const answer = useCallback(
    async (decision: ConfirmDecision) => {
      if (!agent || !prompt || busy) return
      setBusy(true)
      setSaid(null)
      const words = { asker: prompt.asker || t('Approver.UnnamedContact'), interpolation: { escapeValue: false } }
      try {
        // Read at answer time, not from state: the state starts 'unknown' until the probe resolves, and a quick tap must
        // not send that. An unknown kind is left out of the answer (namedLock), never sent as a claim.
        const lockNow = await ownerLockKind()
        const result = await answerConfirmRequest(
          agent,
          prompt.connectionId,
          decision,
          ownerCheck,
          t(decision === 'itsMe' ? 'ConfirmItsYou.ItsMeReason' : 'ConfirmItsYou.NotMeReason', words),
          lockNow
        )
        releaseWarn(`[VTI] confirm request answer: ${result}`)
        const named = namedLock(lockNow)
        if (result === 'sent')
          setSent({ asker: words.asker, decision, at: new Date(), ...(named ? { lock: named } : {}) })
        else if (result === 'unavailable') setSaid(t('ConfirmItsYou.NoLock'))
        else if (result === 'failed') setSaid(t('ConfirmItsYou.Failed'))
        else if (result === 'gone' && pastDue(prompt.expiresAt)) {
          // Answered just after the time ran out: say so, rather than the sheet vanishing under the tap.
          setExpired(prompt)
          setPrompt(undefined)
        } else if (result === 'gone' || result === 'off') setPrompt(firstShown())
        // 'cancelled': the person chose not to at the lock prompt; nothing failed, the request simply stays.
      } catch (error) {
        releaseWarn(
          `[VTI] confirm answer not sent (${(error as Error)?.name ?? 'error'}: ${(error as Error)?.message})`
        )
        setSaid(t('ConfirmItsYou.Failed'))
      } finally {
        setBusy(false)
      }
    },
    [agent, prompt, busy, t]
  )

  const notNow = useCallback(() => {
    if (!prompt) return
    putOff.add(prompt.connectionId)
    setSaid(null)
    setPrompt(firstShown())
  }, [prompt])

  const done = useCallback(() => {
    setSent(null)
    setPrompt(firstShown())
  }, [])

  const close = useCallback(() => {
    setExpired(null)
    setPrompt(firstShown())
  }, [])

  if (!on || (!prompt && !sent && !expired)) return null

  const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    safeAreaView: {
      flexShrink: 1,
      backgroundColor: ColorPalette.brand.modalPrimaryBackground,
      borderTopRightRadius: 20,
      borderTopLeftRadius: 20,
    },
    container: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 24, gap: 12 },
    quote: {
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      gap: 4,
    },
    centred: { textAlign: 'center' },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    error: { color: ColorPalette.semantic.error, textAlign: 'center' },
  })

  const lockWords = { method: t(`ConfirmItsYou.Lock.${lockKind}`) }

  const body = sent ? (
    <>
      <ThemedText variant="headingThree" accessibilityRole="header" testID={testIdWithKey(ConfirmItsYouModalIds.sent)}>
        {t('ConfirmItsYou.SentTo', { asker: sent.asker, interpolation: { escapeValue: false } })}
      </ThemedText>
      <ThemedText variant="bold">
        {t(sent.decision === 'itsMe' ? 'ConfirmItsYou.YouToldItsMe' : 'ConfirmItsYou.YouToldNotMe', {
          asker: sent.asker,
          interpolation: { escapeValue: false },
        })}
      </ThemedText>
      <ThemedText>
        {t(sent.lock ? 'ConfirmItsYou.SentSigned' : 'ConfirmItsYou.SentSignedNoLock', {
          ...(sent.lock ? { method: t(`ConfirmItsYou.Lock.${sent.lock}`) } : {}),
          time: timeOf(sent.at),
          asker: sent.asker,
          interpolation: { escapeValue: false },
        })}
      </ThemedText>
      <ThemedText style={styles.muted}>
        {t(sent.decision === 'itsMe' ? 'ConfirmItsYou.SentItsMeAfter' : 'ConfirmItsYou.SentNotMeAfter', {
          asker: sent.asker,
          interpolation: { escapeValue: false },
        })}
      </ThemedText>
      <Button
        title={t('ConfirmItsYou.Done')}
        buttonType={ButtonType.Primary}
        onPress={done}
        testID={testIdWithKey(ConfirmItsYouModalIds.done)}
      />
    </>
  ) : expired ? (
    (() => {
      const words = { asker: expired.asker || t('Approver.UnnamedContact'), interpolation: { escapeValue: false } }
      return (
        <>
          <ThemedText style={styles.muted}>{t('ConfirmItsYou.From', words)}</ThemedText>
          <ThemedText
            variant="headingThree"
            accessibilityRole="header"
            testID={testIdWithKey(ConfirmItsYouModalIds.expired)}
          >
            {t('ConfirmItsYou.ExpiredPromptTitle')}
          </ThemedText>
          <View style={styles.quote}>
            <ThemedText style={styles.muted}>{t('ConfirmItsYou.TheirNote', words)}</ThemedText>
            <ThemedText style={styles.muted}>{expired.note}</ThemedText>
          </View>
          <ThemedText>{t('ConfirmItsYou.ExpiredPromptBody', words)}</ThemedText>
          <Button
            title={t('ConfirmItsYou.Close')}
            buttonType={ButtonType.Primary}
            onPress={close}
            testID={testIdWithKey(ConfirmItsYouModalIds.close)}
          />
        </>
      )
    })()
  ) : prompt ? (
    (() => {
      const words = { asker: prompt.asker || t('Approver.UnnamedContact'), interpolation: { escapeValue: false } }
      return (
        <>
          <ThemedText style={styles.muted}>{t('ConfirmItsYou.From', words)}</ThemedText>
          <ThemedText variant="headingThree" accessibilityRole="header">
            {t('ConfirmItsYou.PromptTitle', words)}
          </ThemedText>
          <View style={styles.quote}>
            <ThemedText style={styles.muted}>{t('ConfirmItsYou.TheirNote', words)}</ThemedText>
            {/* Exactly as the asker typed it: plain text, never links or markup. */}
            <ThemedText testID={testIdWithKey(ConfirmItsYouModalIds.note)}>{prompt.note}</ThemedText>
          </View>
          <ThemedText>{t('ConfirmItsYou.AnswerOnlyForYou', words)}</ThemedText>
          {said ? (
            <ThemedText style={styles.error} testID={testIdWithKey(ConfirmItsYouModalIds.failed)}>
              {said}
            </ThemedText>
          ) : null}
          <Button
            title={t('ConfirmItsYou.ItsMe')}
            buttonType={ButtonType.Primary}
            onPress={() => void answer('itsMe')}
            disabled={busy}
            testID={testIdWithKey(ConfirmItsYouModalIds.itsMe)}
          />
          <Button
            title={t('ConfirmItsYou.NotMe')}
            buttonType={ButtonType.Secondary}
            onPress={() => void answer('notMe')}
            disabled={busy}
            testID={testIdWithKey(ConfirmItsYouModalIds.notMe)}
          />
          <Button
            title={t('ConfirmItsYou.NotNow')}
            buttonType={ButtonType.Tertiary}
            onPress={notNow}
            disabled={busy}
            testID={testIdWithKey(ConfirmItsYouModalIds.notNow)}
          />
          <ThemedText style={[styles.muted, styles.centred]} testID={testIdWithKey(ConfirmItsYouModalIds.lock)}>
            {t('ConfirmItsYou.EitherAsksLock', lockWords)}
          </ThemedText>
          <ThemedText style={[styles.muted, styles.centred]}>{t('ConfirmItsYou.PinInstead')}</ThemedText>
        </>
      )
    })()
  ) : null

  return (
    <SafeAreaModal visible transparent animationType="slide">
      <SafeAreaView style={styles.overlay} edges={['top']}>
        <SafeAreaView style={styles.safeAreaView} edges={['bottom']}>
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.container}
            testID={testIdWithKey(ConfirmItsYouModalIds.sheet)}
          >
            {body}
          </ScrollView>
        </SafeAreaView>
      </SafeAreaView>
    </SafeAreaModal>
  )
}

export default ConfirmItsYouModal
