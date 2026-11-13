/**
 * "Confirm it's you", as a card in the chat with the contact (confirmItsYou.ts; mocks RstEUM32… frames A3–A9).
 *
 * The card is not a chat message: it mirrors the request's own state, read from the records Confirm it's you already
 * keeps (this phone's asks, and the contact's prompt), so it is never in a chat export or backup, Clear chat leaves the
 * request alone, and it follows the request's expiry, not the chat's disappearing-messages timer.
 *
 * Mine (this phone asked): waiting, with Cancel (here only: a late answer is then ignored); confirmed; not confirmed,
 * a solid red card with what to do now; no answer, with Ask again (a new request); cancelled. An older request is one
 * quiet line.
 *
 * Theirs (the contact asked this phone): Confirm or "No, that wasn't me", each behind the phone's own lock, exactly
 * as the global sheet (ConfirmItsYouModal) answers it; both read the same prompt, so answering either clears both.
 * Once answered, what was sent; once past its time, "This request has expired" and nothing to press.
 *
 * Shown only while the "Confirm it's you" switch is on and neither its own nor the SEDI/KERI remote off is set
 * (isConfirmItsYouEnabled), read at every render: the card itself is gated, not only the list that holds it.
 *
 * @module trust-tasks/screens/ConfirmChatCard
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import {
  answerConfirmRequest,
  cancelConfirmRequest,
  confirmStatusOf,
  namedLock,
  pastDue,
  sendConfirmRequest,
  type ConfirmAsk,
  type ConfirmPrompt,
  type ConfirmStatus,
  type ConfirmTheOwner,
} from '../confirmItsYou'
import type { ConfirmDecision } from '../confirmItsYouSpec'
import { isConfirmItsYouEnabled } from '../module/confirmItsYouFlag'
import { confirmOwner, ownerLockKind } from '../module/ownerConfirm'
import { releaseWarn } from '../module/releaseLog'

export const ConfirmChatCardIds = {
  mine: 'ConfirmChatMine',
  theirs: 'ConfirmChatTheirs',
  earlier: 'ConfirmChatEarlier',
  status: 'ConfirmChatStatus',
  note: 'ConfirmChatNote',
  cancel: 'ConfirmChatCancel',
  askAgain: 'ConfirmChatAskAgain',
  itsMe: 'ConfirmChatItsMe',
  notMe: 'ConfirmChatNotMe',
  said: 'ConfirmChatSaid',
  steps: 'ConfirmChatSteps',
} as const

/** What one card shows: a request this phone sent, or the contact's request to this phone. */
export type ConfirmChatEntry =
  | { side: 'mine'; ask: ConfirmAsk; newest: boolean }
  | { side: 'theirs'; prompt: ConfirmPrompt; answeredAt?: string }

/** Where the contact's request stands on this phone. */
export type TheirStatus = 'open' | 'answered' | 'expired'

/** Answered once this phone answered; else open until its time is past (pastDue, the module's own), then expired. */
export function theirStatusOf(
  prompt: Pick<ConfirmPrompt, 'open' | 'expiresAt' | 'answered'>,
  now = Date.now()
): TheirStatus {
  if (!prompt.open && prompt.answered) return 'answered'
  return prompt.open && !pastDue(prompt.expiresAt, now) ? 'open' : 'expired'
}

/** The phone owner's check; replaceable in tests only (as ConfirmItsYouModal's is). */
let ownerCheckForTests: ConfirmTheOwner | null = null
/** Tests only. */
export const setConfirmChatOwnerCheckForTests = (check: ConfirmTheOwner | null) => {
  ownerCheckForTests = check
}
const ownerCheck: ConfirmTheOwner = (reason) => (ownerCheckForTests ?? confirmOwner)(reason)

const EARLIER_KEY: Record<ConfirmStatus, string> = {
  waiting: 'ConfirmItsYou.EarlierWaiting',
  itsMe: 'ConfirmItsYou.EarlierItsMe',
  notMe: 'ConfirmItsYou.EarlierNotMe',
  expired: 'ConfirmItsYou.EarlierExpired',
  cancelled: 'ConfirmItsYou.EarlierCancelled',
}

const timeOf = (iso: string | undefined) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
const minutesLeft = (expiresAt: string, now = Date.now()) =>
  Math.max(1, Math.ceil((Date.parse(expiresAt) - now) / 60000))

interface Props {
  entry: ConfirmChatEntry
  connectionId: string
  /** The contact's name, as the chat's header shows it. */
  name: string
  /** Called after this card changed the request (sent, cancelled, answered), so its list reads it again. */
  onChanged?: () => void
}

const ConfirmChatCard: React.FC<Props> = ({ entry, connectionId, name, onChanged }) => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | undefined>()
  const [sentNow, setSentNow] = useState<{ decision: ConfirmDecision; at: string; lock?: string } | undefined>()

  const askAgain = useCallback(
    async (note: string) => {
      if (!agent || busy) return
      setBusy(true)
      setSaid(undefined)
      try {
        const result = await sendConfirmRequest(agent, connectionId, note)
        if (result === 'noRelationship') setSaid(t('ConfirmItsYou.NoRelationship', { name }))
        else if (result === 'badNote') setSaid(t('ConfirmItsYou.NoteNeeded'))
        onChanged?.()
      } catch (error) {
        releaseWarn(`[VTI] confirm request not sent (${(error as Error)?.name ?? 'error'})`)
        setSaid(t('ConfirmItsYou.NotSent', { name }))
      } finally {
        setBusy(false)
      }
    },
    [agent, busy, connectionId, name, onChanged, t]
  )

  const cancel = useCallback(
    async (threadId: string) => {
      if (!agent || busy) return
      setBusy(true)
      try {
        await cancelConfirmRequest(agent, connectionId, threadId)
        onChanged?.()
      } catch (error) {
        releaseWarn(`[VTI] confirm request not cancelled (${(error as Error)?.name ?? 'error'})`)
      } finally {
        setBusy(false)
      }
    },
    [agent, busy, connectionId, onChanged]
  )

  const answer = useCallback(
    async (decision: ConfirmDecision, asker: string) => {
      if (!agent || busy) return
      setBusy(true)
      setSaid(undefined)
      const words = { asker, interpolation: { escapeValue: false } }
      try {
        // Read at answer time, as the sheet does: an unknown kind is left out of the answer (namedLock).
        const lockNow = await ownerLockKind()
        const result = await answerConfirmRequest(
          agent,
          connectionId,
          decision,
          ownerCheck,
          t(decision === 'itsMe' ? 'ConfirmItsYou.ItsMeReason' : 'ConfirmItsYou.NotMeReason', words),
          lockNow
        )
        releaseWarn(`[VTI] confirm request answer (chat): ${result}`)
        const named = namedLock(lockNow)
        if (result === 'sent') {
          setSentNow({ decision, at: new Date().toISOString(), ...(named ? { lock: named } : {}) })
          onChanged?.()
        } else if (result === 'unavailable') setSaid(t('ConfirmItsYou.NoLock'))
        else if (result === 'failed') setSaid(t('ConfirmItsYou.Failed'))
        else if (result === 'gone' || result === 'off') onChanged?.()
        // 'cancelled': the person backed out at the lock prompt; the request simply stays.
      } catch (error) {
        releaseWarn(`[VTI] confirm answer not sent (${(error as Error)?.name ?? 'error'})`)
        setSaid(t('ConfirmItsYou.Failed'))
      } finally {
        setBusy(false)
      }
    },
    [agent, busy, connectionId, onChanged, t]
  )

  if (!isConfirmItsYouEnabled()) return null

  const styles = StyleSheet.create({
    card: {
      backgroundColor: ColorPalette.grayscale.white,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
      padding: 14,
      gap: 8,
      marginHorizontal: 12,
      marginVertical: 8,
    },
    good: { borderWidth: 2, borderColor: ColorPalette.semantic.success },
    late: { borderWidth: 2, borderColor: ColorPalette.notification.warnBorder },
    quiet: { backgroundColor: ColorPalette.grayscale.veryLightGrey },
    red: { backgroundColor: ColorPalette.semantic.error, borderColor: ColorPalette.semantic.error, borderWidth: 2 },
    onRed: { color: ColorPalette.grayscale.white },
    onRedBig: { color: ColorPalette.grayscale.white, fontSize: 22, lineHeight: 28, fontWeight: 'bold' },
    quote: {
      backgroundColor: ColorPalette.grayscale.white,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
      borderRadius: 10,
      paddingVertical: 8,
      paddingHorizontal: 12,
      gap: 2,
    },
    quoteText: { color: ColorPalette.grayscale.black },
    headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
    kind: { color: ColorPalette.brand.primary, fontWeight: 'bold' },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    error: { color: ColorPalette.semantic.error },
    line: { marginHorizontal: 12, marginVertical: 4, alignItems: 'center' },
  })

  const n = { name, interpolation: { escapeValue: false } }
  const said_ = said ? (
    <ThemedText style={styles.error} testID={testIdWithKey(ConfirmChatCardIds.said)}>
      {said}
    </ThemedText>
  ) : null
  // The note exactly as it was written: plain text, never links or markup.
  const quote = (label: string, note: string) => (
    <View style={styles.quote}>
      <ThemedText style={styles.muted}>{label}</ThemedText>
      <ThemedText style={styles.quoteText} testID={testIdWithKey(ConfirmChatCardIds.note)}>
        {note}
      </ThemedText>
    </View>
  )
  const kindLine = (who: string, style?: object) => (
    <ThemedText style={[styles.kind, style]}>
      {t('ConfirmItsYou.Title', { name: who, interpolation: { escapeValue: false } })}
    </ThemedText>
  )

  if (entry.side === 'mine') {
    const { ask, newest } = entry
    const status = confirmStatusOf(ask)
    const lock = namedLock(ask.confirmedWith)
    const at = {
      ...n,
      time: timeOf(ask.respondedAt ?? ask.answeredAt),
      sent: timeOf(ask.askedAt),
      ...(lock ? { lock: t(`ConfirmItsYou.Lock.${lock}`) } : {}),
    }
    if (!newest)
      return (
        <View style={styles.line} testID={testIdWithKey(ConfirmChatCardIds.earlier)}>
          <ThemedText style={styles.muted}>
            {kindLine(name, styles.muted)} · {t(EARLIER_KEY[status], at)}
          </ThemedText>
        </View>
      )
    const mine = (style: object | undefined, body: React.ReactNode) => (
      <View style={[styles.card, style]} testID={testIdWithKey(ConfirmChatCardIds.mine)}>
        {body}
      </View>
    )
    switch (status) {
      case 'waiting':
        return mine(
          undefined,
          <>
            {kindLine(name)}
            <View style={styles.headRow}>
              <ThemedText variant="bold" testID={testIdWithKey(ConfirmChatCardIds.status)}>
                {t('ConfirmItsYou.WaitingTitle', n)}
              </ThemedText>
              <ThemedText style={styles.muted}>{t('ConfirmItsYou.SentAt', at)}</ThemedText>
            </View>
            <ThemedText variant="bold">{t('ConfirmItsYou.WaitingBody', n)}</ThemedText>
            {quote(t('ConfirmItsYou.YouAsked'), ask.note)}
            <ThemedText style={styles.muted}>
              {t('ConfirmItsYou.ExpiresIn', { count: minutesLeft(ask.expiresAt) })}
            </ThemedText>
            <Button
              title={t('ConfirmItsYou.CancelRequest')}
              buttonType={ButtonType.Secondary}
              onPress={() => void cancel(ask.threadId)}
              disabled={busy}
              testID={testIdWithKey(ConfirmChatCardIds.cancel)}
            />
            <ThemedText style={styles.muted}>{t('ConfirmItsYou.CancelNote', n)}</ThemedText>
          </>
        )
      case 'itsMe':
        return mine(
          styles.good,
          <>
            {kindLine(name)}
            <ThemedText variant="bold" testID={testIdWithKey(ConfirmChatCardIds.status)}>
              {t(lock ? 'ConfirmItsYou.ConfirmedTitle' : 'ConfirmItsYou.ConfirmedTitleOnPhone', at)}
            </ThemedText>
            <ThemedText>{t('ConfirmItsYou.ConfirmedBody', n)}</ThemedText>
            {quote(t('ConfirmItsYou.YouAsked'), ask.note)}
            <ThemedText style={styles.muted}>{t('ConfirmItsYou.TheyAnswered', n)}</ThemedText>
            <ThemedText variant="bold">{t('ConfirmItsYou.ItsMe')}</ThemedText>
            <ThemedText style={styles.muted}>{t('ConfirmItsYou.ConfirmedCaveat', n)}</ThemedText>
          </>
        )
      case 'notMe':
        return (
          <View
            style={[styles.card, styles.red]}
            accessibilityRole="alert"
            testID={testIdWithKey(ConfirmChatCardIds.mine)}
          >
            {kindLine(name, styles.onRed)}
            <ThemedText style={styles.onRedBig} testID={testIdWithKey(ConfirmChatCardIds.status)}>
              {t('ConfirmItsYou.NotThemTitle', n)}
            </ThemedText>
            <ThemedText style={styles.onRed} variant="bold">
              {t('ConfirmItsYou.NotThemBody')}
            </ThemedText>
            <ThemedText style={styles.onRed}>
              {t(lock ? 'ConfirmItsYou.NotThemSigned' : 'ConfirmItsYou.NotThemSignedOnPhone', at)}
            </ThemedText>
            {quote(t('ConfirmItsYou.YouAsked'), ask.note)}
            <View testID={testIdWithKey(ConfirmChatCardIds.steps)}>
              <ThemedText style={styles.onRed} variant="bold">
                {t('ConfirmItsYou.WhatToDo')}
              </ThemedText>
              <ThemedText style={styles.onRed}>• {t('ConfirmItsYou.StepHangUp')}</ThemedText>
              <ThemedText style={styles.onRed}>• {t('ConfirmItsYou.StepCallBack', n)}</ThemedText>
              <ThemedText style={styles.onRed}>• {t('ConfirmItsYou.StepNoCodes')}</ThemedText>
            </View>
          </View>
        )
      case 'expired':
        return mine(
          styles.late,
          <>
            {kindLine(name)}
            <View style={styles.headRow}>
              <ThemedText variant="bold">{t('ConfirmItsYou.NoAnswer')}</ThemedText>
              <ThemedText style={styles.muted}>{t('ConfirmItsYou.SentAt', at)}</ThemedText>
            </View>
            <ThemedText variant="bold" testID={testIdWithKey(ConfirmChatCardIds.status)}>
              {t('ConfirmItsYou.ExpiredTitle', n)}
            </ThemedText>
            <ThemedText>{t('ConfirmItsYou.ExpiredBody', n)}</ThemedText>
            {said_}
            <Button
              title={t('ConfirmItsYou.AskAgain')}
              buttonType={ButtonType.Primary}
              onPress={() => void askAgain(ask.note)}
              disabled={busy}
              testID={testIdWithKey(ConfirmChatCardIds.askAgain)}
            />
            <ThemedText style={styles.muted}>{t('ConfirmItsYou.AskAgainNote', n)}</ThemedText>
            <ThemedText style={styles.muted}>{t('ConfirmItsYou.OrCall', n)}</ThemedText>
          </>
        )
      case 'cancelled':
        return mine(
          styles.quiet,
          <>
            {kindLine(name, styles.muted)}
            <ThemedText variant="bold" testID={testIdWithKey(ConfirmChatCardIds.status)}>
              {t('ConfirmItsYou.CancelledTitle')}
            </ThemedText>
            <ThemedText style={styles.muted}>{t('ConfirmItsYou.CancelNote', n)}</ThemedText>
          </>
        )
    }
  }

  // Theirs: the contact asked this phone.
  const { prompt } = entry
  const asker = prompt.asker || name
  const words = { asker, interpolation: { escapeValue: false } }
  const status: TheirStatus = sentNow ? 'answered' : theirStatusOf(prompt)
  const theirs = (style: object | undefined, body: React.ReactNode) => (
    <View style={[styles.card, style]} testID={testIdWithKey(ConfirmChatCardIds.theirs)}>
      {kindLine(asker, status === 'expired' ? styles.muted : undefined)}
      {body}
    </View>
  )

  if (status === 'open')
    return theirs(
      undefined,
      <>
        <ThemedText variant="bold" testID={testIdWithKey(ConfirmChatCardIds.status)}>
          {t('ConfirmItsYou.PromptTitle', words)}
        </ThemedText>
        {quote(t('ConfirmItsYou.TheirNote', words), prompt.note)}
        <ThemedText>{t('ConfirmItsYou.AnswerOnlyForYou', words)}</ThemedText>
        {said_}
        <Button
          title={t('ConfirmItsYou.ItsMe')}
          buttonType={ButtonType.Primary}
          onPress={() => void answer('itsMe', asker)}
          disabled={busy}
          testID={testIdWithKey(ConfirmChatCardIds.itsMe)}
        />
        <Button
          title={t('ConfirmItsYou.NotMe')}
          buttonType={ButtonType.Secondary}
          onPress={() => void answer('notMe', asker)}
          disabled={busy}
          testID={testIdWithKey(ConfirmChatCardIds.notMe)}
        />
        <ThemedText style={styles.muted}>{t('ConfirmItsYou.PinInstead')}</ThemedText>
      </>
    )

  if (status === 'answered') {
    const decision = sentNow?.decision ?? prompt.answered
    const when = sentNow?.at ?? entry.answeredAt
    return theirs(
      decision === 'itsMe' ? styles.good : undefined,
      <>
        <ThemedText variant="bold" testID={testIdWithKey(ConfirmChatCardIds.status)}>
          {t(decision === 'itsMe' ? 'ConfirmItsYou.YouToldItsMe' : 'ConfirmItsYou.YouToldNotMe', words)}
        </ThemedText>
        {quote(t('ConfirmItsYou.TheirNote', words), prompt.note)}
        {when ? (
          <ThemedText>
            {t(sentNow?.lock ? 'ConfirmItsYou.SentSigned' : 'ConfirmItsYou.SentSignedNoLock', {
              ...words,
              ...(sentNow?.lock ? { method: t(`ConfirmItsYou.Lock.${sentNow.lock}`) } : {}),
              time: timeOf(when),
            })}
          </ThemedText>
        ) : null}
        <ThemedText style={styles.muted}>
          {t(decision === 'itsMe' ? 'ConfirmItsYou.SentItsMeAfter' : 'ConfirmItsYou.SentNotMeAfter', words)}
        </ThemedText>
      </>
    )
  }

  return theirs(
    styles.quiet,
    <>
      <ThemedText variant="bold" testID={testIdWithKey(ConfirmChatCardIds.status)}>
        {t('ConfirmItsYou.ExpiredPromptTitle')}
      </ThemedText>
      <ThemedText style={styles.muted}>{t('ConfirmItsYou.ExpiredPromptBody', words)}</ThemedText>
    </>
  )
}

export default ConfirmChatCard
