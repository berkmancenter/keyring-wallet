/**
 * One poll (Polls V2 mock: before the ticket, the ticket, the vote is in, closed, results; plus needs an update and
 * limited access).
 *
 * Before the ticket, the screen says who runs the poll and who sees what, and Get my ticket sits with the line that
 * goes with it (VTI-VOT-090: the disclosure comes first). Taking the ticket and voting are two acts. After the ticket,
 * within the first hour, the screen advises voting later, with Vote later first: the community knows when the ticket
 * was taken.
 *
 * Once the community certifies the result, the poll shows it, on the read after, whatever the member did: the poll is
 * read whenever this screen opens or is returned to.
 *
 * The screen never says what the member chose: the phone doesn't keep it.
 *
 * @module polls/screens/Poll
 */
import { useNavigation, useRoute } from '@react-navigation/native'
import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { communityLabelOf } from '../../trust-tasks/screens/communityName'
import { localDate, localDateTime } from '../../trust-tasks/screens/localTime'
import { PollCallout, PollChip, PollLine, PollStepBar, type ChipTone } from '../components/PollParts'
import { PollsIds } from '../components/Polls.ids'
import { PollResults } from '../components/PollResults'
import { PollRefusal } from '../pollService'
import {
  castFailureText,
  clockTime,
  closedEarly,
  closeLine,
  lessLikelyFrom,
  minutesSinceTicket,
  PAIRING_WINDOW_MS,
  pollPhase,
  pollTitle,
  refusalText,
} from '../pollWords'
import { usePoll, usePollService } from '../usePolls'

/**
 * At this text size the bar's lines and button move to the end of the scroll, so nothing fixed covers the screen.
 * 1.3 is Android's largest font setting: a fixed bar there covered a ballot's second and third choices.
 */
export const LARGE_TEXT = 1.3

/**
 * Whether text is large enough to move the bar into the scroll. Android reports its 1.3 setting as a 32-bit float
 * (1.2999999523…), just under 1.3, so the scale is compared to two decimals.
 */
export const isLargeText = (fontScale: number) => Math.round(fontScale * 100) >= Math.round(LARGE_TEXT * 100)

const Poll: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { fontScale } = useWindowDimensions()
  const params = (useRoute()?.params ?? {}) as { communityDid?: string; electionId?: string }
  const communityDid = params.communityDid ?? ''
  const electionId = params.electionId ?? ''
  const navigation = useNavigation() as unknown as { navigate: (n: string, p: object) => void; goBack: () => void }
  const service = usePollService()
  const poll = usePoll(communityDid, electionId)
  const [taking, setTaking] = useState(false)
  const scroll = useRef<ScrollView>(null)
  const [refusal, setRefusal] = useState<PollRefusal>()
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { flexGrow: 1, padding: 16, gap: 14 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 14, padding: 16, gap: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    flex: { flex: 1 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    error: { color: ColorPalette.semantic.error },
    bar: {
      padding: 16,
      gap: 10,
      backgroundColor: ColorPalette.brand.primaryBackground,
      borderTopWidth: 1,
      borderTopColor: ColorPalette.grayscale.lightGrey,
    },
    party: {
      flex: 1,
      alignItems: 'center',
      gap: 4,
      padding: 10,
      borderRadius: 10,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    center: { textAlign: 'center' },
    ticket: { borderRadius: 16, padding: 18, gap: 10, backgroundColor: ColorPalette.brand.primary },
    notch: {
      position: 'absolute',
      top: 84,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    dashed: { borderTopWidth: 2, borderStyle: 'dashed', marginVertical: 4 },
    onTicket: { color: ColorPalette.grayscale.white },
  })

  const now = Date.now()
  const { shown, record, readiness } = poll
  const community = communityLabelOf(communityDid, t)
  const date = (iso: string) => ({ date: localDateTime(iso), interpolation: { escapeValue: false } })

  const getTicket = async () => {
    if (!service) return
    setTaking(true)
    setRefusal(undefined)
    try {
      await service.takeTicket(communityDid, electionId)
    } catch (e) {
      setRefusal(e instanceof PollRefusal ? e : new PollRefusal('refused'))
    } finally {
      setTaking(false)
      await poll.reload()
      // The ticket's screen opens at its top, not where the disclosure above Get my ticket was scrolled to.
      scroll.current?.scrollTo({ y: 0, animated: false })
    }
  }

  const screen = (body: React.ReactNode, bar?: React.ReactNode) => {
    const barInScroll = bar && isLargeText(fontScale)
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <ScrollView ref={scroll} contentContainerStyle={styles.content} testID={testIdWithKey(PollsIds.screen)}>
          {body}
          {barInScroll ? <View style={{ gap: 10 }}>{bar}</View> : null}
        </ScrollView>
        {bar && !barInScroll ? <View style={styles.bar}>{bar}</View> : null}
      </SafeAreaView>
    )
  }

  if (!service || readiness === 'noAgent')
    return screen(<ThemedText testID={testIdWithKey(PollsIds.noAgent)}>{t('Polls.NoAgent')}</ThemedText>)
  if (!shown && poll.failed)
    return screen(
      <View style={{ gap: 8 }}>
        <ThemedText testID={testIdWithKey(PollsIds.readFailed)}>{t('Polls.ReadFailed')}</ThemedText>
        <Button
          title={t('Polls.TryAgain')}
          buttonType={ButtonType.Secondary}
          onPress={poll.reload}
          testID={testIdWithKey(PollsIds.tryAgain)}
        />
      </View>
    )
  if (!shown)
    return screen(<ActivityIndicator color={ColorPalette.brand.primary} testID={testIdWithKey(PollsIds.reading)} />)

  const { manifest, disclosure } = shown
  const phase = pollPhase({ ...manifest, state: shown.state }, record, now)
  const certified = shown.certified
  const voted = record?.votedAt !== undefined
  const title = pollTitle(t, manifest.title)

  /** The poll's head: a chip and a line, the title, and the poll's own description where it has one. */
  const head = (
    chip: { label: string; tone: ChipTone } | undefined,
    meta: string | undefined,
    step?: React.ReactNode
  ) => (
    <View style={styles.card} testID={testIdWithKey(PollsIds.head)}>
      {chip || meta ? (
        <View style={styles.chipRow}>
          {chip ? <PollChip label={chip.label} tone={chip.tone} /> : null}
          {meta ? <ThemedText style={[styles.muted, { flexShrink: 1 }]}>{meta}</ThemedText> : null}
        </View>
      ) : null}
      <ThemedText variant="headingFour" accessibilityRole="header" testID={testIdWithKey(PollsIds.title)}>
        {title}
      </ThemedText>
      {manifest.description ? <ThemedText>{manifest.description}</ThemedText> : null}
      {step}
    </View>
  )

  const backToCommunity = (
    <Button
      title={t('Polls.BackToCommunity')}
      buttonType={ButtonType.Secondary}
      onPress={() => navigation.goBack()}
      testID={testIdWithKey(PollsIds.backToCommunity)}
    />
  )

  if (phase === 'sending')
    return screen(
      <>
        {head(undefined, undefined, <PollStepBar at="receipt" />)}
        <View style={styles.card} testID={testIdWithKey(PollsIds.sending)}>
          <View style={styles.row}>
            <ActivityIndicator color={ColorPalette.brand.primary} />
            <ThemedText variant="bold" style={styles.flex}>
              {t('Polls.Sending')}
            </ThemedText>
          </View>
          {record?.stopped ? (
            <ThemedText style={styles.error} testID={testIdWithKey(PollsIds.sendingStopped)}>
              {castFailureText(t, record.stopped.kind === 'agent' ? { kind: 'unreachable' } : record.stopped)}
            </ThemedText>
          ) : null}
          <PollLine icon="refresh">{t('Polls.LeaveIsFine')}</PollLine>
        </View>
      </>
    )

  // Certified: the result, first, whatever the member did.
  if (certified && phase !== 'cancelled')
    return screen(
      <>
        {head(
          { label: t('Polls.Results'), tone: 'results' },
          // "Closed early" where the certification proves it, else "Closed": never the set date (bifold #887).
          closeLine(t, manifest, now, certified.certifiedAt)
        )}
        <PollResults manifest={manifest} certification={certified} voted={voted} />
        <View style={styles.card} testID={testIdWithKey(PollsIds.yourPart)}>
          {voted && record?.votedAt !== undefined ? (
            <>
              <PollLine icon="check" color={ColorPalette.semantic.success} bold>
                {t('Polls.VotedOn', {
                  date: localDate(new Date(record.votedAt).toISOString()),
                  interpolation: { escapeValue: false },
                })}
              </PollLine>
              <ThemedText style={styles.muted}>{t('Polls.CantShowYours')}</ThemedText>
            </>
          ) : (
            <PollLine icon="minus-circle-outline" color={ColorPalette.grayscale.mediumGrey}>
              {t('Polls.DidntVote')}
            </PollLine>
          )}
        </View>
      </>
    )

  const closed = shown.state === 'closed' || shown.state === 'tallied' || now >= Date.parse(manifest.votingClosesAt)
  const resultsNotReady = (
    <View style={[styles.card, { alignItems: 'center' }]} testID={testIdWithKey(PollsIds.resultsNotReady)}>
      <Icon name="chart-bar" size={40} color={ColorPalette.grayscale.mediumGrey} />
      <ThemedText variant="bold" style={styles.center}>
        {t('Polls.ResultsNotReady')}
      </ThemedText>
      <ThemedText style={styles.center}>{t('Polls.ResultsNotReadyBody')}</ThemedText>
    </View>
  )

  if (phase === 'voted' && record?.votedAt !== undefined)
    return screen(
      <>
        <PollStepBar at="receipt" done />
        <View style={[styles.card, { alignItems: 'center' }]} testID={testIdWithKey(PollsIds.voteIn)}>
          <Icon name="check-circle" size={56} color={ColorPalette.semantic.success} />
          <ThemedText variant="headingFour" accessibilityRole="header" style={styles.center}>
            {t('Polls.VoteIn')}
          </ThemedText>
          <ThemedText style={[styles.muted, styles.center]} testID={testIdWithKey(PollsIds.title)}>
            {title}
          </ThemedText>
          <View style={[styles.dashed, { alignSelf: 'stretch', borderColor: ColorPalette.grayscale.lightGrey }]} />
          <ThemedText style={{ alignSelf: 'stretch' }}>
            {t('Polls.VoteInBody', date(new Date(record.votedAt).toISOString()))}
          </ThemedText>
        </View>
        <View style={styles.card}>
          <PollLine icon="lock-outline">{t('Polls.KeepsOnly')}</PollLine>
        </View>
        {closed ? (
          resultsNotReady
        ) : (
          <View style={styles.card}>
            <PollLine icon="calendar-blank-outline">
              {t('Polls.ResultsWhenCloses', date(manifest.votingClosesAt))}
            </PollLine>
          </View>
        )}
      </>,
      backToCommunity
    )

  if (phase === 'closed' || phase === 'cancelled') {
    // Early only where it is proven (bifold #887); a poll past its set time shows no date either way.
    const early = phase === 'closed' && closedEarly(manifest, now)
    return screen(
      <>
        <View style={styles.card} testID={testIdWithKey(PollsIds.closed)}>
          <PollChip label={phase === 'cancelled' ? t('Polls.Cancelled') : closeLine(t, manifest, now)} tone="quiet" />
          <ThemedText variant="headingFour" accessibilityRole="header" testID={testIdWithKey(PollsIds.title)}>
            {title}
          </ThemedText>
          {early ? (
            <ThemedText style={styles.muted} testID={testIdWithKey(PollsIds.closedEarly)}>
              {t('Polls.ClosedEarlyBody')}
            </ThemedText>
          ) : null}
        </View>
        {phase === 'closed' ? resultsNotReady : null}
        <View style={styles.card}>
          <PollLine icon="minus-circle-outline" color={ColorPalette.grayscale.mediumGrey}>
            {t('Polls.DidntVote')}
          </PollLine>
        </View>
      </>
    )
  }

  // Before any ticket: what stops this phone voting, said before anything is sent.
  if (readiness === 'tooOld' || refusal?.reason === 'agentTooOld')
    return screen(
      <View style={styles.card} testID={testIdWithKey(PollsIds.needsUpdate)}>
        <ThemedText variant="bold">{t('Polls.NeedsUpdate')}</ThemedText>
        <ThemedText>{t('Polls.NeedsUpdateBody')}</ThemedText>
      </View>
    )
  if (refusal?.reason === 'limited')
    return screen(
      <View style={styles.card} testID={testIdWithKey(PollsIds.limited)}>
        <ThemedText variant="bold">{t('Polls.Limited')}</ThemedText>
        <ThemedText>{t('Polls.LimitedBody')}</ThemedText>
      </View>
    )

  if (record?.ticketAt !== undefined) {
    if (phase === 'notOpenYet')
      return screen(
        <View style={styles.card} testID={testIdWithKey(PollsIds.notOpenYet)}>
          <ThemedText variant="bold">{t('Polls.HaveTicket')}</ThemedText>
          <ThemedText>{t('Polls.NotOpenYet', date(manifest.votingOpensAt))}</ThemedText>
        </View>
      )
    const minutes = minutesSinceTicket(record, now)
    const soon = minutes !== undefined
    const ticketAt = record.ticketAt
    return screen(
      <>
        <PollStepBar at="vote" />
        <View style={styles.ticket} testID={testIdWithKey(PollsIds.ticketHeld)}>
          <View style={[styles.notch, { left: -10 }]} />
          <View style={[styles.notch, { right: -10 }]} />
          <View style={styles.row}>
            <Icon name="ticket-outline" size={28} color={ColorPalette.grayscale.white} />
            <ThemedText variant="headingFour" style={[styles.flex, styles.onTicket]}>
              {t('Polls.HaveTicket')}
            </ThemedText>
          </View>
          <ThemedText style={styles.onTicket} testID={testIdWithKey(PollsIds.title)}>
            {title}
          </ThemedText>
          <View style={[styles.dashed, { borderColor: ColorPalette.grayscale.white, opacity: 0.5 }]} />
          <ThemedText style={styles.onTicket}>{t('Polls.BallotReady', date(manifest.votingClosesAt))}</ThemedText>
        </View>
        {soon ? (
          <View style={styles.card} testID={testIdWithKey(PollsIds.voteLaterAdvice)}>
            <View style={styles.row}>
              <Icon name="clock-outline" size={24} color={ColorPalette.notification.warnIcon} />
              <ThemedText variant="bold" style={styles.flex}>
                {t('Polls.VoteLaterTitle')}
              </ThemedText>
            </View>
            <View style={{ gap: 6 }} testID={testIdWithKey(PollsIds.ticketTimeline)}>
              <View style={{ height: 10, borderRadius: 5, flexDirection: 'row', overflow: 'hidden' }}>
                <View style={{ flex: 1, backgroundColor: ColorPalette.notification.warn }} />
                <View style={{ flex: 1, backgroundColor: ColorPalette.notification.success }} />
              </View>
              <View
                style={{
                  position: 'absolute',
                  top: -5,
                  left: `${Math.min(48, Math.round(((now - ticketAt) / PAIRING_WINDOW_MS) * 50))}%`,
                  width: 4,
                  height: 20,
                  borderRadius: 2,
                  backgroundColor: ColorPalette.brand.text,
                }}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 8 }}>
                <ThemedText variant="labelSubtitle" style={styles.muted}>
                  {t('Polls.TicketAtNow', { time: clockTime(ticketAt) })}
                </ThemedText>
                <ThemedText variant="labelSubtitle" style={{ fontWeight: '700' }}>
                  {t('Polls.SaferAfter', { time: clockTime(ticketAt + PAIRING_WINDOW_MS) })}
                </ThemedText>
              </View>
            </View>
            <ThemedText>
              {t('Polls.VoteLaterBody', { time: lessLikelyFrom(record), interpolation: { escapeValue: false } })}
            </ThemedText>
          </View>
        ) : null}
        {soon ? (
          <ThemedText style={styles.muted} testID={testIdWithKey(PollsIds.voteLaterKeeps)}>
            {t('Polls.VoteLaterKeeps')}
          </ThemedText>
        ) : null}
      </>,
      soon ? (
        <>
          <Button
            title={t('Polls.VoteLater')}
            buttonType={ButtonType.Primary}
            onPress={() => navigation.goBack()}
            testID={testIdWithKey(PollsIds.voteLater)}
          />
          <Button
            title={t('Polls.VoteNow')}
            buttonType={ButtonType.Secondary}
            onPress={() => navigation.navigate(Screens.PollBallot, { communityDid, electionId })}
            testID={testIdWithKey(PollsIds.voteNow)}
          />
        </>
      ) : (
        <Button
          title={t('Polls.VoteNow')}
          buttonType={ButtonType.Primary}
          onPress={() => navigation.navigate(Screens.PollBallot, { communityDid, electionId })}
          testID={testIdWithKey(PollsIds.voteNow)}
        />
      )
    )
  }

  // Who runs it, and who sees what, before the ticket (VTI-VOT-090).
  const separate = !disclosure.sameOperator
  const large = isLargeText(fontScale)
  const party = (label: string, name: string, icon: string) => (
    <View style={[styles.party, large ? { flex: 0 } : null]}>
      <Icon name={icon} size={26} color={ColorPalette.brand.primary} />
      <ThemedText variant="labelSubtitle" style={[styles.muted, styles.center]}>
        {label}
      </ThemedText>
      <ThemedText variant="bold" style={styles.center}>
        {name}
      </ThemedText>
    </View>
  )
  return screen(
    <>
      {head(
        phase === 'notOpenYet' ? undefined : { label: t('Polls.OpenChip'), tone: 'open' },
        `${t('Polls.OpenUntil', date(manifest.votingClosesAt))} · ${t('Polls.OneVotePerMembership')}`,
        <PollStepBar at="ticket" />
      )}
      <View style={styles.card} testID={testIdWithKey(PollsIds.whoRunsIt)}>
        <ThemedText variant="bold" accessibilityRole="header">
          {t('Polls.WhoRunsIt')}
        </ThemedText>
        {/* Side by side; at large text, one above the other, so neither label breaks inside a word. */}
        <View style={large ? { gap: 6, alignItems: 'stretch' } : styles.row} testID={testIdWithKey(PollsIds.parties)}>
          {separate
            ? party(t('Polls.Community'), community, 'account-group-outline')
            : party(t('Polls.RunsCommunity'), disclosure.ballotBoxOperator, 'account-group-outline')}
          <Icon
            style={large ? { alignSelf: 'center', transform: [{ rotate: '90deg' }] } : undefined}
            name={separate ? 'arrow-left-right' : 'link-variant'}
            size={22}
            color={separate ? ColorPalette.grayscale.mediumGrey : ColorPalette.semantic.error}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          {separate
            ? party(t('Polls.CollectedBy'), disclosure.ballotBoxOperator, 'inbox-arrow-down-outline')
            : party(t('Polls.CollectsVotes'), disclosure.ballotBoxOperator, 'inbox-arrow-down-outline')}
        </View>
        {separate ? (
          <ThemedText>{t('Polls.SeparateOperator')}</ThemedText>
        ) : (
          <PollCallout tone="error" icon="alert-outline" testID={testIdWithKey(PollsIds.sameOperator)}>
            {t('Polls.SameOperator')}
          </PollCallout>
        )}
      </View>
      <View style={styles.card} testID={testIdWithKey(PollsIds.whoSeesWhat)}>
        <ThemedText variant="bold" accessibilityRole="header">
          {t('Polls.WhoSeesWhat')}
        </ThemedText>
        <PollLine icon="account-group-outline">{t('Polls.SeesCommunity')}</PollLine>
        <PollLine icon="inbox-arrow-down-outline">{t('Polls.SeesCollector')}</PollLine>
        <PollLine icon="cellphone" testID={testIdWithKey(PollsIds.hostedAgent)}>
          {t('Polls.SeesAgent')}
        </PollLine>
        {separate ? <ThemedText>{t('Polls.BothTogether')}</ThemedText> : null}
        {manifest.binding ? (
          <>
            <ThemedText>{t('Polls.CountsMemberships')}</ThemedText>
            <ThemedText>{t('Polls.Unreviewed')}</ThemedText>
          </>
        ) : null}
      </View>
      {phase === 'notOpenYet' ? (
        <ThemedText style={styles.muted} testID={testIdWithKey(PollsIds.notOpenYet)}>
          {t('Polls.OpensOn', { date: localDate(manifest.votingOpensAt), interpolation: { escapeValue: false } })}
        </ThemedText>
      ) : null}
    </>,
    <>
      {refusal ? (
        <ThemedText style={styles.error} accessibilityLiveRegion="polite" testID={testIdWithKey(PollsIds.refused)}>
          {refusalText(t, refusal)}
        </ThemedText>
      ) : null}
      <ThemedText>{t('Polls.TicketLine')}</ThemedText>
      <Button
        title={t('Polls.GetTicket')}
        buttonType={ButtonType.Primary}
        onPress={getTicket}
        disabled={taking}
        testID={testIdWithKey(PollsIds.getTicket)}
      >
        {taking ? <ActivityIndicator color={ColorPalette.brand.text} /> : null}
      </Button>
    </>
  )
}

export default Poll
