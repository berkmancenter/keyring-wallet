/**
 * One poll (Community Polls mock: who runs it, ticket taken, casting, your vote is in, closed, results, needs an
 * update, limited access).
 *
 * Before the ticket, the screen says who runs the poll and who sees what, and Get my ticket sits with the line that
 * goes with it (VTI-VOT-090: the disclosure comes first). Taking the ticket and voting are two acts. After the ticket,
 * within the first hour, the screen advises voting later: the community knows when the ticket was taken.
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
import { PollsIds } from '../components/Polls.ids'
import { PollResults } from '../components/PollResults'
import { PollRefusal } from '../pollService'
import { castFailureText, lessLikelyFrom, minutesSinceTicket, pollPhase, pollTitle, refusalText } from '../pollWords'
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
    content: { flexGrow: 1, padding: 20, gap: 16 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    flex: { flex: 1 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    error: { color: ColorPalette.semantic.error },
    bar: {
      padding: 16,
      gap: 10,
      backgroundColor: ColorPalette.brand.secondaryBackground,
      borderTopWidth: 1,
      borderTopColor: ColorPalette.grayscale.lightGrey,
    },
    buttons: { flexDirection: 'row', gap: 12 },
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
          {shown ? (
            <ThemedText variant="headingFour" accessibilityRole="header" testID={testIdWithKey(PollsIds.title)}>
              {pollTitle(t, shown.manifest.title)}
            </ThemedText>
          ) : null}
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

  const results = certified ? (
    <PollResults manifest={manifest} certification={certified} voted={record?.votedAt !== undefined} />
  ) : (
    <View style={styles.card} testID={testIdWithKey(PollsIds.resultsNotReady)}>
      <ThemedText variant="bold">{t('Polls.ResultsNotReady')}</ThemedText>
      <ThemedText>{t('Polls.ResultsNotReadyBody')}</ThemedText>
    </View>
  )

  if (phase === 'sending')
    return screen(
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
        <ThemedText>{t('Polls.LeaveIsFine')}</ThemedText>
      </View>
    )

  if (phase === 'voted' && record?.votedAt !== undefined) {
    const closed = shown.state === 'closed' || shown.state === 'tallied' || now >= Date.parse(manifest.votingClosesAt)
    return screen(
      <>
        <View style={styles.card} testID={testIdWithKey(PollsIds.voteIn)}>
          <View style={styles.row}>
            <Icon name="check-circle-outline" size={24} color={ColorPalette.semantic.success} />
            <ThemedText variant="bold" style={styles.flex}>
              {t('Polls.VoteIn')}
            </ThemedText>
          </View>
          <ThemedText>{t('Polls.VoteInBody', date(new Date(record.votedAt).toISOString()))}</ThemedText>
          <ThemedText>{t('Polls.KeepsOnly')}</ThemedText>
          {closed ? null : (
            <ThemedText style={styles.muted}>{t('Polls.ResultsWhenCloses', date(manifest.votingClosesAt))}</ThemedText>
          )}
        </View>
        {closed ? results : null}
      </>
    )
  }

  if (phase === 'closed' || phase === 'cancelled')
    return screen(
      <>
        <View style={styles.card} testID={testIdWithKey(PollsIds.closed)}>
          <ThemedText variant="bold">{phase === 'cancelled' ? t('Polls.Cancelled') : t('Polls.Closed')}</ThemedText>
          <ThemedText style={styles.muted}>{t('Polls.ClosedOn', date(manifest.votingClosesAt))}</ThemedText>
          <ThemedText>{t('Polls.DidntVote')}</ThemedText>
        </View>
        {phase === 'closed' ? results : null}
      </>
    )

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
    const soon = minutesSinceTicket(record, now) !== undefined
    return screen(
      <>
        <View style={styles.card} testID={testIdWithKey(PollsIds.ticketHeld)}>
          <View style={styles.row}>
            <Icon name="ticket-outline" size={24} color={ColorPalette.brand.primary} />
            <ThemedText variant="bold" style={styles.flex}>
              {t('Polls.HaveTicket')}
            </ThemedText>
          </View>
          <ThemedText>{t('Polls.BallotReady', date(manifest.votingClosesAt))}</ThemedText>
        </View>
        {soon ? (
          <View style={styles.card} testID={testIdWithKey(PollsIds.voteLaterAdvice)}>
            <ThemedText variant="bold">{t('Polls.VoteLaterTitle')}</ThemedText>
            <ThemedText>
              {t('Polls.VoteLaterBody', { time: lessLikelyFrom(record), interpolation: { escapeValue: false } })}
            </ThemedText>
          </View>
        ) : null}
      </>,
      <View style={styles.buttons}>
        <View style={styles.flex}>
          <Button
            title={t('Polls.VoteNow')}
            buttonType={soon ? ButtonType.Secondary : ButtonType.Primary}
            onPress={() => navigation.navigate(Screens.PollBallot, { communityDid, electionId })}
            testID={testIdWithKey(PollsIds.voteNow)}
          />
        </View>
        {soon ? (
          <View style={styles.flex}>
            <Button
              title={t('Polls.VoteLater')}
              buttonType={ButtonType.Primary}
              onPress={() => navigation.goBack()}
              testID={testIdWithKey(PollsIds.voteLater)}
            />
          </View>
        ) : null}
      </View>
    )
  }

  // Who runs it, and who sees what, before the ticket (VTI-VOT-090).
  const separate = !disclosure.sameOperator
  return screen(
    <>
      <ThemedText style={styles.muted}>
        {`${t('Polls.OpenUntil', date(manifest.votingClosesAt))} · ${t('Polls.OneVotePerMembership')}`}
      </ThemedText>
      {manifest.description ? <ThemedText>{manifest.description}</ThemedText> : null}
      <View style={styles.card} testID={testIdWithKey(PollsIds.whoRunsIt)}>
        <ThemedText variant="bold" accessibilityRole="header">
          {t('Polls.WhoRunsIt')}
        </ThemedText>
        {separate ? (
          <>
            <ThemedText style={styles.muted}>{t('Polls.Community')}</ThemedText>
            <ThemedText variant="bold">{community}</ThemedText>
            <ThemedText style={styles.muted}>{t('Polls.CollectedBy')}</ThemedText>
            <ThemedText variant="bold">{disclosure.ballotBoxOperator}</ThemedText>
            <ThemedText>{t('Polls.SeparateOperator')}</ThemedText>
          </>
        ) : (
          <>
            <ThemedText style={styles.muted}>{t('Polls.RunBy')}</ThemedText>
            <ThemedText variant="bold">{disclosure.ballotBoxOperator}</ThemedText>
            <View style={styles.row} testID={testIdWithKey(PollsIds.sameOperator)}>
              <Icon name="alert-outline" size={22} color={ColorPalette.semantic.error} />
              <ThemedText variant="bold" style={styles.flex}>
                {t('Polls.SameOperator')}
              </ThemedText>
            </View>
          </>
        )}
      </View>
      <View style={styles.card} testID={testIdWithKey(PollsIds.whoSeesWhat)}>
        <ThemedText variant="bold" accessibilityRole="header">
          {t('Polls.WhoSeesWhat')}
        </ThemedText>
        <ThemedText>{t('Polls.SeesCommunity')}</ThemedText>
        <ThemedText>{t('Polls.SeesCollector')}</ThemedText>
        <ThemedText testID={testIdWithKey(PollsIds.hostedAgent)}>{t('Polls.SeesAgent')}</ThemedText>
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
