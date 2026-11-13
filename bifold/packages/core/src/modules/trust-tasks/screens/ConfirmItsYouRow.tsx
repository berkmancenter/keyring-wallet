/**
 * "Confirm it's you", on a contact's page (confirmItsYou.ts; mocks GVGac4je… frames 1, 2, 4a–4d): a call or message
 * sounds like this contact, so the person writes a short note and asks the contact's phone to confirm it is really
 * them. The row then says where the request stands:
 *  - waiting: don't act on the call yet; it can be cancelled here (here only: a late answer is then ignored);
 *  - confirmed, with the contact's phone lock, at the time their signed answer gives;
 *  - not them: one solid red card, with what to do now inside it (the phone vibrated once when the answer landed:
 *    confirmItsYou.ts, never here, so a re-open or a re-render does not vibrate again);
 *  - no answer in time: ask again, which sends a new request.
 * The last few requests stay listed under Earlier.
 *
 * Person to person: no agent is needed, only the relationship this phone already has with the contact.
 *
 * Three forms of the same thing, each its own gate: `variant="row"` (the default) is the Safety section's row, with the
 * request's status; `variant="button"` is the contact page's full-width "Confirm with {{name}}" button, which opens the
 * same note-and-send form in place and hides while a request waits (the status shows in the Safety row);
 * `variant="sheet"` is the chat's "Confirm with {{name}}" sheet, cut to one line, the note and Send (Alberto's pick of
 * mock D1, 2026-11-13: "way too verbose and long"). In the sheet the last answer is one line, what a confirmation
 * proves sits behind an (i), and Earlier stays on the contact page. Two things are never cut: the red "not them" card,
 * whole, and "don't act on it" while a request waits or after no answer. Waiting shows no note box, so a second
 * request never goes on top of one still open. After "not them" the box stays under the red card, as the sheet on
 * 278.18 had it (opened to write a note): the person may want to ask again, and the card above says what to do.
 *
 * Shown only while the "Confirm it's you" switch is on (confirmItsYouFlag.ts: the switch AND no remote off), read at
 * every render by THIS component, so switching it off (or a remote off) takes either form away on the next render, and
 * a parent that forgets to guard still shows nothing. Never labelled a demo.
 *
 * @module trust-tasks/screens/ConfirmItsYouRow
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import {
  cancelConfirmRequest,
  confirmAsksOn,
  confirmEvents,
  confirmStatusOf,
  namedLock,
  noteToSend,
  sendConfirmRequest,
  type ConfirmAsk,
  type ConfirmStatus,
} from '../confirmItsYou'
import { NOTE_MAX } from '../confirmItsYouSpec'
import { isConfirmItsYouEnabled } from '../module/confirmItsYouFlag'
import { releaseWarn } from '../module/releaseLog'

export const ConfirmItsYouRowIds = {
  row: 'ConfirmItsYou',
  open: 'ConfirmItsYouOpen',
  button: 'ConfirmItsYouButton',
  note: 'ConfirmItsYouNote',
  counter: 'ConfirmItsYouCounter',
  send: 'ConfirmItsYouSend',
  cancelCompose: 'ConfirmItsYouCancelCompose',
  said: 'ConfirmItsYouSaid',
  status: 'ConfirmItsYouStatus',
  asked: 'ConfirmItsYouAsked',
  expiresIn: 'ConfirmItsYouExpiresIn',
  cancelRequest: 'ConfirmItsYouCancelRequest',
  askAgain: 'ConfirmItsYouAskAgain',
  steps: 'ConfirmItsYouSteps',
  alarm: 'ConfirmItsYouAlarm',
  earlier: 'ConfirmItsYouEarlier',
  // the chat's sheet (variant="sheet")
  sheet: 'ConfirmItsYouShort',
  last: 'ConfirmItsYouLast',
  proofToggle: 'ConfirmItsYouProofToggle',
  proof: 'ConfirmItsYouProof',
} as const

/** The sheet shows the note counter only this close to the limit: the box itself says nothing until it matters. */
export const SHEET_COUNTER_FROM = NOTE_MAX - 40

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
  connectionId: string | null
  /** The contact's name, as the page shows it. */
  name: string
  /**
   * 'row' (default): the Safety row with the status. 'button': the contact page's full-width start button. 'sheet':
   * the chat's sheet, one line, the note and Send.
   */
  variant?: 'row' | 'button' | 'sheet'
}

const ConfirmItsYouRow: React.FC<Props> = ({ connectionId, name, variant = 'row' }) => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette, Inputs } = useTheme()
  const [asks, setAsks] = useState<ConfirmAsk[]>([])
  const [composing, setComposing] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | undefined>()
  const [proofShown, setProofShown] = useState(false)
  // Bumped on a clock while a request waits, so "expires in" counts down and a waiting request turns into "no answer"
  // with no event to wake it.
  const [, setTick] = useState(0)
  const on = isConfirmItsYouEnabled()

  const load = useCallback(async () => {
    if (!agent || !connectionId) return
    setAsks(await confirmAsksOn(agent, connectionId).catch(() => []))
  }, [agent, connectionId])

  useEffect(() => {
    if (!on) return
    void load()
    const refresh = (event: { connectionId?: string }) => {
      if (event?.connectionId === connectionId) void load()
    }
    confirmEvents.on('answered', refresh)
    confirmEvents.on('asked', refresh)
    return () => {
      confirmEvents.off('answered', refresh)
      confirmEvents.off('asked', refresh)
    }
  }, [on, load, connectionId])

  const newest = asks.length > 0 ? asks[0] : null
  const newestStatus = newest ? confirmStatusOf(newest) : null

  // A clock, not only an event: no answer may ever come, and the row must still say so when the time is up.
  useEffect(() => {
    if (!on || !newest || newestStatus !== 'waiting') return
    const untilDue = Math.max(0, Date.parse(newest.expiresAt) - Date.now()) + 50
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(untilDue, 30000))
    return () => clearTimeout(timer)
  })

  const send = useCallback(
    async (text: string) => {
      if (!agent || !connectionId || busy) return
      if (noteToSend(text) === null) {
        setSaid(t('ConfirmItsYou.NoteNeeded'))
        return
      }
      setBusy(true)
      setSaid(undefined)
      try {
        const result = await sendConfirmRequest(agent, connectionId, text)
        if (result === 'noRelationship') setSaid(t('ConfirmItsYou.NoRelationship', { name }))
        else if (result === 'badNote') setSaid(t('ConfirmItsYou.NoteNeeded'))
        else {
          setComposing(false)
          setNote('')
        }
        await load()
      } catch (error) {
        releaseWarn(
          `[VTI] confirm request not sent (${(error as Error)?.name ?? 'error'}: ${(error as Error)?.message})`
        )
        setSaid(t('ConfirmItsYou.NotSent', { name }))
      } finally {
        setBusy(false)
      }
    },
    [agent, connectionId, busy, load, name, t]
  )

  const cancelRequest = useCallback(async () => {
    if (!agent || !connectionId || !newest || busy) return
    setBusy(true)
    try {
      await cancelConfirmRequest(agent, connectionId, newest.threadId)
      await load()
    } catch (error) {
      releaseWarn(`[VTI] confirm request not cancelled (${(error as Error)?.name ?? 'error'})`)
    } finally {
      setBusy(false)
    }
  }, [agent, connectionId, newest, busy, load])

  if (!on || !connectionId) return null

  const styles = StyleSheet.create({
    row: { gap: 8 },
    entry: { minHeight: 44, paddingVertical: 8, gap: 2 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 12, padding: 16, gap: 8 },
    good: { borderWidth: 2, borderColor: ColorPalette.semantic.success },
    alarm: { backgroundColor: ColorPalette.semantic.error, borderRadius: 14, padding: 18, gap: 10 },
    alarmText: { color: ColorPalette.grayscale.white },
    alarmBig: { color: ColorPalette.grayscale.white, fontSize: 24, lineHeight: 30, fontWeight: 'bold' },
    steps: { borderTopWidth: 1, borderTopColor: ColorPalette.grayscale.white, paddingTop: 10, gap: 6 },
    quote: {
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
      borderRadius: 10,
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    input: { ...Inputs.textInput, minHeight: 88, textAlignVertical: 'top' },
    counter: { alignSelf: 'flex-end', color: ColorPalette.grayscale.mediumGrey },
    headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    error: { color: ColorPalette.semantic.error },
    sheetLine: { gap: 8 },
    lastGood: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: ColorPalette.semantic.success,
    },
    hintRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    grow: { flex: 1 },
  })
  const n = { name, interpolation: { escapeValue: false } }
  // A lock is named only when the answer named one (namedLock): an absent or unknown lock is never shown as a claim,
  // so the words then say "on their phone", not "with the phone's lock".
  const at = (ask: ConfirmAsk) => {
    const lock = namedLock(ask.confirmedWith)
    return {
      ...n,
      time: timeOf(ask.respondedAt ?? ask.answeredAt),
      sent: timeOf(ask.askedAt),
      ...(lock ? { lock: t(`ConfirmItsYou.Lock.${lock}`) } : {}),
    }
  }
  // The note exactly as it was written: plain text, never links or markup.
  const quote = (ask: ConfirmAsk) => (
    <View style={styles.quote}>
      <ThemedText testID={testIdWithKey(ConfirmItsYouRowIds.asked)}>{ask.note}</ThemedText>
    </View>
  )

  const statusCard = (ask: ConfirmAsk, status: ConfirmStatus) => {
    switch (status) {
      case 'waiting':
        return (
          <View style={styles.card}>
            <View style={styles.headRow}>
              <ThemedText variant="bold" testID={testIdWithKey(ConfirmItsYouRowIds.status)}>
                {t('ConfirmItsYou.WaitingTitle', n)}
              </ThemedText>
              <ThemedText style={styles.muted}>{t('ConfirmItsYou.SentAt', at(ask))}</ThemedText>
            </View>
            <ThemedText>{t('ConfirmItsYou.WaitingBody', n)}</ThemedText>
            {quote(ask)}
            <ThemedText style={styles.muted} testID={testIdWithKey(ConfirmItsYouRowIds.expiresIn)}>
              {t('ConfirmItsYou.ExpiresIn', { count: minutesLeft(ask.expiresAt) })}
            </ThemedText>
            <Button
              title={t('ConfirmItsYou.CancelRequest')}
              buttonType={ButtonType.Secondary}
              onPress={() => void cancelRequest()}
              disabled={busy}
              testID={testIdWithKey(ConfirmItsYouRowIds.cancelRequest)}
            />
            <ThemedText style={styles.muted}>{t('ConfirmItsYou.CancelNote', n)}</ThemedText>
            <ThemedText style={styles.muted}>{t('ConfirmItsYou.AnswerShowsHere', n)}</ThemedText>
          </View>
        )
      case 'itsMe':
        return (
          <View style={[styles.card, styles.good]}>
            <ThemedText variant="bold" testID={testIdWithKey(ConfirmItsYouRowIds.status)}>
              {t(
                namedLock(ask.confirmedWith) ? 'ConfirmItsYou.ConfirmedTitle' : 'ConfirmItsYou.ConfirmedTitleOnPhone',
                at(ask)
              )}
            </ThemedText>
            <ThemedText>{t('ConfirmItsYou.ConfirmedBody', n)}</ThemedText>
            <ThemedText style={styles.muted}>{t('ConfirmItsYou.YouAsked')}</ThemedText>
            {quote(ask)}
            <ThemedText style={styles.muted}>{t('ConfirmItsYou.TheyAnswered', n)}</ThemedText>
            <ThemedText variant="bold">{t('ConfirmItsYou.ItsMe')}</ThemedText>
            <ThemedText style={styles.muted}>{t('ConfirmItsYou.ConfirmedCaveat', n)}</ThemedText>
          </View>
        )
      case 'notMe':
        // One solid red card, white words, what to do now inside it: nothing about it reads as grey or as confirmed.
        return (
          <View style={styles.alarm} accessibilityRole="alert" testID={testIdWithKey(ConfirmItsYouRowIds.alarm)}>
            <ThemedText style={styles.alarmBig} testID={testIdWithKey(ConfirmItsYouRowIds.status)}>
              {t('ConfirmItsYou.NotThemTitle', n)}
            </ThemedText>
            <ThemedText style={styles.alarmText} variant="bold">
              {t('ConfirmItsYou.NotThemBody')}
            </ThemedText>
            <ThemedText style={styles.alarmText}>
              {t(
                namedLock(ask.confirmedWith) ? 'ConfirmItsYou.NotThemSigned' : 'ConfirmItsYou.NotThemSignedOnPhone',
                at(ask)
              )}
            </ThemedText>
            <View style={styles.steps} testID={testIdWithKey(ConfirmItsYouRowIds.steps)}>
              <ThemedText style={styles.alarmText} variant="bold">
                {t('ConfirmItsYou.WhatToDo')}
              </ThemedText>
              <ThemedText style={styles.alarmText}>• {t('ConfirmItsYou.StepHangUp')}</ThemedText>
              <ThemedText style={styles.alarmText}>• {t('ConfirmItsYou.StepCallBack', n)}</ThemedText>
              <ThemedText style={styles.alarmText}>• {t('ConfirmItsYou.StepNoCodes')}</ThemedText>
            </View>
          </View>
        )
      case 'expired':
        return (
          <View style={styles.card}>
            <View style={styles.headRow}>
              <ThemedText variant="bold">{t('ConfirmItsYou.NoAnswer')}</ThemedText>
              <ThemedText style={styles.muted}>{t('ConfirmItsYou.SentAt', at(ask))}</ThemedText>
            </View>
            <ThemedText variant="bold" testID={testIdWithKey(ConfirmItsYouRowIds.status)}>
              {t('ConfirmItsYou.ExpiredTitle', n)}
            </ThemedText>
            <ThemedText>{t('ConfirmItsYou.ExpiredBody', n)}</ThemedText>
            <Button
              title={t('ConfirmItsYou.AskAgain')}
              buttonType={ButtonType.Primary}
              onPress={() => void send(ask.note)}
              disabled={busy}
              testID={testIdWithKey(ConfirmItsYouRowIds.askAgain)}
            />
            <ThemedText style={styles.muted}>{t('ConfirmItsYou.AskAgainNote', n)}</ThemedText>
            <ThemedText style={styles.muted}>{t('ConfirmItsYou.OrCall', n)}</ThemedText>
          </View>
        )
      case 'cancelled':
        return (
          <View style={styles.card}>
            <ThemedText variant="bold" testID={testIdWithKey(ConfirmItsYouRowIds.status)}>
              {t('ConfirmItsYou.CancelledTitle')}
            </ThemedText>
            <ThemedText style={styles.muted}>{t('ConfirmItsYou.CancelNote', n)}</ThemedText>
          </View>
        )
    }
  }

  const entry = (
    <Pressable
      style={styles.entry}
      onPress={() => setComposing(true)}
      accessibilityRole="button"
      accessibilityLabel={t('ConfirmItsYou.Title', n)}
      testID={testIdWithKey(ConfirmItsYouRowIds.open)}
    >
      <ThemedText variant="bold">{t('ConfirmItsYou.Title', n)}</ThemedText>
      <ThemedText style={styles.muted}>{t('ConfirmItsYou.Subtitle', n)}</ThemedText>
    </Pressable>
  )

  const compose = (
    <View style={styles.card}>
      <ThemedText variant="bold">{t('ConfirmItsYou.ComposeTitle', n)}</ThemedText>
      <ThemedText>{t('ConfirmItsYou.ComposeBody', n)}</ThemedText>
      <ThemedText variant="bold">{t('ConfirmItsYou.NoteLabel')}</ThemedText>
      <ThemedText style={styles.muted}>{t('ConfirmItsYou.NoteOnlyThey', n)}</ThemedText>
      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        maxLength={NOTE_MAX}
        multiline
        placeholder={t('ConfirmItsYou.NotePlaceholder')}
        placeholderTextColor={ColorPalette.grayscale.mediumGrey}
        accessibilityLabel={t('ConfirmItsYou.NoteLabel')}
        testID={testIdWithKey(ConfirmItsYouRowIds.note)}
      />
      <ThemedText style={styles.counter} testID={testIdWithKey(ConfirmItsYouRowIds.counter)}>
        {t('ConfirmItsYou.Counter', { typed: note.length, limit: NOTE_MAX })}
      </ThemedText>
      <Button
        title={t('ConfirmItsYou.Send')}
        buttonType={ButtonType.Primary}
        onPress={() => void send(note)}
        disabled={busy}
        testID={testIdWithKey(ConfirmItsYouRowIds.send)}
      />
      <Button
        title={t('ConfirmItsYou.Cancel')}
        buttonType={ButtonType.Tertiary}
        onPress={() => {
          setComposing(false)
          setSaid(undefined)
        }}
        disabled={busy}
        testID={testIdWithKey(ConfirmItsYouRowIds.cancelCompose)}
      />
    </View>
  )

  if (variant === 'sheet') {
    const info = (
      <Pressable
        onPress={() => setProofShown((shown) => !shown)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={t('ConfirmItsYou.WhatItProves')}
        accessibilityState={{ expanded: proofShown }}
        testID={testIdWithKey(ConfirmItsYouRowIds.proofToggle)}
      >
        <Icon name="information-outline" size={22} color={ColorPalette.brand.primary} />
      </Pressable>
    )
    // One line for where the last request stands; the red card is never cut down.
    const lastLine = () => {
      if (!newest || !newestStatus) return null
      switch (newestStatus) {
        case 'notMe':
          return statusCard(newest, 'notMe')
        case 'waiting':
          return (
            <View style={styles.sheetLine}>
              <View style={styles.headRow}>
                <ThemedText variant="bold" testID={testIdWithKey(ConfirmItsYouRowIds.status)}>
                  {t('ConfirmItsYou.WaitingTitle', n)}
                </ThemedText>
                <ThemedText style={styles.muted}>{t('ConfirmItsYou.SentAt', at(newest))}</ThemedText>
              </View>
              <ThemedText>{t('ConfirmItsYou.WaitingBody', n)}</ThemedText>
              <Button
                title={t('ConfirmItsYou.CancelRequest')}
                buttonType={ButtonType.Secondary}
                onPress={() => void cancelRequest()}
                disabled={busy}
                testID={testIdWithKey(ConfirmItsYouRowIds.cancelRequest)}
              />
            </View>
          )
        case 'expired':
          return (
            <ThemedText variant="bold" style={styles.sheetLine} testID={testIdWithKey(ConfirmItsYouRowIds.status)}>
              {t('ConfirmItsYou.LastExpired', n)}
            </ThemedText>
          )
        case 'itsMe':
          return (
            <Pressable
              style={[styles.sheetLine, styles.lastGood]}
              onPress={() => setProofShown((shown) => !shown)}
              accessibilityRole="button"
              accessibilityHint={t('ConfirmItsYou.WhatItProves')}
              testID={testIdWithKey(ConfirmItsYouRowIds.last)}
            >
              <Icon name="check" size={20} color={ColorPalette.semantic.success} />
              <ThemedText style={styles.grow} testID={testIdWithKey(ConfirmItsYouRowIds.status)}>
                {t('ConfirmItsYou.LastConfirmed', at(newest))}
              </ThemedText>
            </Pressable>
          )
        case 'cancelled':
          return null
      }
    }
    return (
      <View style={styles.row} testID={testIdWithKey(ConfirmItsYouRowIds.sheet)}>
        {lastLine()}
        {newestStatus === 'waiting' ? null : (
          <>
            <View style={styles.hintRow}>
              <ThemedText style={[styles.muted, styles.grow]}>{t('ConfirmItsYou.SheetHint', n)}</ThemedText>
              {info}
            </View>
            {proofShown ? (
              <View style={styles.card} testID={testIdWithKey(ConfirmItsYouRowIds.proof)}>
                <ThemedText variant="bold">{t('ConfirmItsYou.WhatItProves')}</ThemedText>
                <ThemedText>{t('ConfirmItsYou.ProofNote', n)}</ThemedText>
                <ThemedText>{t('ConfirmItsYou.ProofSigned', n)}</ThemedText>
                <ThemedText style={styles.muted}>{t('ConfirmItsYou.ConfirmedCaveat', n)}</ThemedText>
                <ThemedText style={styles.muted}>{t('ConfirmItsYou.EarlierOnContact', n)}</ThemedText>
              </View>
            ) : null}
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              maxLength={NOTE_MAX}
              multiline
              placeholder={t('ConfirmItsYou.SheetPlaceholder', n)}
              placeholderTextColor={ColorPalette.grayscale.mediumGrey}
              accessibilityLabel={t('ConfirmItsYou.NoteLabel')}
              testID={testIdWithKey(ConfirmItsYouRowIds.note)}
            />
            {note.length >= SHEET_COUNTER_FROM ? (
              <ThemedText style={styles.counter} testID={testIdWithKey(ConfirmItsYouRowIds.counter)}>
                {t('ConfirmItsYou.Counter', { typed: note.length, limit: NOTE_MAX })}
              </ThemedText>
            ) : null}
            <Button
              title={t('ConfirmItsYou.Send')}
              buttonType={ButtonType.Primary}
              onPress={() => void send(note)}
              disabled={busy}
              testID={testIdWithKey(ConfirmItsYouRowIds.send)}
            />
          </>
        )}
        {said ? (
          <ThemedText style={styles.error} testID={testIdWithKey(ConfirmItsYouRowIds.said)}>
            {said}
          </ThemedText>
        ) : null}
      </View>
    )
  }

  if (variant === 'button') {
    // The contact page's start button: the same form, opened in place. While a request waits it steps aside, so it
    // never invites a second request on top of one still open; the Safety row says where that one stands.
    if (composing)
      return (
        <View style={styles.row}>
          {compose}
          {said ? (
            <ThemedText style={styles.error} testID={testIdWithKey(ConfirmItsYouRowIds.said)}>
              {said}
            </ThemedText>
          ) : null}
        </View>
      )
    if (newestStatus === 'waiting') return null
    return (
      <Button
        title={t('ConfirmItsYou.Title', n)}
        accessibilityLabel={t('ConfirmItsYou.Title', n)}
        buttonType={ButtonType.Primary}
        onPress={() => setComposing(true)}
        testID={testIdWithKey(ConfirmItsYouRowIds.button)}
      />
    )
  }

  return (
    <View style={styles.row} testID={testIdWithKey(ConfirmItsYouRowIds.row)}>
      {newest && newestStatus ? statusCard(newest, newestStatus) : null}
      {composing ? compose : newestStatus === 'waiting' || newestStatus === 'expired' ? null : entry}
      {!composing && !newest ? <ThemedText style={styles.muted}>{t('ConfirmItsYou.Hint', n)}</ThemedText> : null}
      {said ? (
        <ThemedText style={styles.error} testID={testIdWithKey(ConfirmItsYouRowIds.said)}>
          {said}
        </ThemedText>
      ) : null}
      {asks.length > 1 ? (
        <View testID={testIdWithKey(ConfirmItsYouRowIds.earlier)}>
          <ThemedText style={styles.muted}>{t('ConfirmItsYou.Earlier')}</ThemedText>
          {asks.slice(1).map((ask) => (
            <ThemedText key={ask.threadId} style={styles.muted}>
              • {t(EARLIER_KEY[confirmStatusOf(ask)], at(ask))}
            </ThemedText>
          ))}
        </View>
      ) : null}
    </View>
  )
}

export default ConfirmItsYouRow
