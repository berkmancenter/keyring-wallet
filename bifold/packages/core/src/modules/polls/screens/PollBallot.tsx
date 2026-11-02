/**
 * The ballot (Community Polls mock, ballot A; ballot B's check step for a binding poll only).
 *
 * What's seen sits in a fixed bar right above Cast my vote, so nothing can scroll it away; at large text, or with
 * Details open, the bar's lines and button move to the end of the scroll, reached only past the choices, so the bar
 * never covers the questions. The bar says who can read the vote
 * on the poll's record, that the member's agent sees the choice and whoever collects votes sees this phone's address,
 * and, behind Details, that whoever hosts the agent can see the choice too. Within the hour after the ticket it also
 * says a vote this soon could be paired with the member by the timing.
 *
 * Choice and text questions are shown. A ballot with any other kind says so and can't be cast: a question left out
 * would be abstained without the member knowing.
 *
 * @module polls/screens/PollBallot
 */
import { useNavigation, useRoute } from '@react-navigation/native'
import React, { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { ballotOf, ballotRefusal, type GivenAnswer } from '../ballot'
import { CastFailure } from '../ballotBox'
import { PollsIds } from '../components/Polls.ids'
import { PollRefusal } from '../pollService'
import type { Question } from '../pollTasks'
import { boardLine, castFailureText, minutesSinceTicket, pollTitle, refusalText } from '../pollWords'
import { usePoll, usePollService } from '../usePolls'

import { isLargeText } from './Poll'

/** The kinds of question this screen can show. */
const SHOWN = new Set(['choice', 'text'])

const optionLabel = (q: Question, key: string) =>
  (q.type === 'text' ? undefined : q.options.find((o) => o.key === key)?.text?.trim()) || key

const PollBallot: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const { fontScale } = useWindowDimensions()
  const params = (useRoute()?.params ?? {}) as { communityDid?: string; electionId?: string }
  const communityDid = params.communityDid ?? ''
  const electionId = params.electionId ?? ''
  const navigation = useNavigation() as unknown as { goBack: () => void }
  const service = usePollService()
  const poll = usePoll(communityDid, electionId)
  const [given, setGiven] = useState<Record<string, GivenAnswer>>({})
  const [details, setDetails] = useState(false)
  const [checking, setChecking] = useState(false)
  const [casting, setCasting] = useState(false)
  const [failure, setFailure] = useState<string>()
  const scroll = useRef<ScrollView>(null)
  // Set when Details is opened, so the screen scrolls to the lines once; never on other changes, or the check step
  // would open scrolled past the choice it shows.
  const scrollToDetails = useRef(false)
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { flexGrow: 1, padding: 20, gap: 14 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 56,
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    chosen: { borderWidth: 2, borderColor: ColorPalette.brand.primary },
    input: {
      ...TextTheme.normal,
      minHeight: 96,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
      backgroundColor: ColorPalette.brand.secondaryBackground,
      textAlignVertical: 'top',
    },
    bar: {
      padding: 16,
      gap: 10,
      backgroundColor: ColorPalette.brand.secondaryBackground,
      borderTopWidth: 1,
      borderTopColor: ColorPalette.grayscale.lightGrey,
    },
    buttons: { flexDirection: 'row', gap: 12 },
    flex: { flex: 1 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    error: { color: ColorPalette.semantic.error },
    link: { color: ColorPalette.brand.primary, fontWeight: '700' },
  })

  const { shown, record } = poll
  const unshown = useMemo(() => shown?.manifest.questions.filter((q) => !SHOWN.has(q.type)) ?? [], [shown])
  const ballot = shown ? ballotOf(shown.manifest, shown.manifestDigest, given) : undefined
  const wrong = shown && ballot ? ballotRefusal(shown.manifest, shown.manifestDigest, ballot) : undefined
  const castable = !!shown && !wrong && unshown.length === 0 && !casting

  const cast = async () => {
    if (!service || !castable) return
    setCasting(true)
    setFailure(undefined)
    try {
      await service.vote(communityDid, electionId, given)
      navigation.goBack()
    } catch (e) {
      setFailure(
        e instanceof CastFailure
          ? castFailureText(t, e)
          : e instanceof PollRefusal
            ? refusalText(t, e)
            : (t('Polls.Refused') as string)
      )
      setCasting(false)
    }
  }

  const choose = (q: Question, key: string) =>
    setGiven((g) => {
      if (q.type !== 'choice') return g
      const current = (g[q.key] as { choice?: string[] } | undefined)?.choice ?? []
      if (q.maxSelections === 1) return { ...g, [q.key]: { choice: [key] } }
      const next = current.includes(key)
        ? current.filter((k) => k !== key)
        : current.length < q.maxSelections
          ? [...current, key]
          : current
      return { ...g, [q.key]: { choice: next } }
    })

  const question = (q: Question) => {
    const header = (
      <ThemedText variant="bold" accessibilityRole="header">
        {q.text?.trim() || q.key}
        {q.optional ? ` · ${t('Polls.Optional')}` : ''}
      </ThemedText>
    )
    if (q.type === 'text')
      return (
        <View key={q.key} style={{ gap: 8 }} testID={testIdWithKey(PollsIds.question)}>
          {header}
          <TextInput
            style={styles.input}
            multiline
            maxLength={q.maxLength}
            placeholder={t('Polls.YourAnswer')}
            placeholderTextColor={ColorPalette.grayscale.mediumGrey}
            accessibilityLabel={q.text?.trim() || q.key}
            value={(given[q.key] as { text?: string } | undefined)?.text ?? ''}
            onChangeText={(text) =>
              setGiven((g) => {
                const next = { ...g }
                if (text) next[q.key] = { text }
                else delete next[q.key]
                return next
              })
            }
            testID={testIdWithKey(PollsIds.textAnswer)}
          />
        </View>
      )
    if (q.type !== 'choice') return null
    const chosen = (given[q.key] as { choice?: string[] } | undefined)?.choice ?? []
    const one = q.maxSelections === 1
    return (
      <View key={q.key} style={{ gap: 8 }} testID={testIdWithKey(PollsIds.question)}>
        {header}
        <ThemedText style={styles.muted}>
          {one
            ? t('Polls.ChooseOne')
            : q.minSelections > 0
              ? t('Polls.ChooseBetween', { min: q.minSelections, max: q.maxSelections, count: chosen.length })
              : t('Polls.ChooseUpTo', { max: q.maxSelections, count: chosen.length })}
        </ThemedText>
        {q.options.map((o) => {
          const on = chosen.includes(o.key)
          const full = !on && !one && chosen.length >= q.maxSelections
          return (
            <Pressable
              key={o.key}
              style={[styles.option, on ? styles.chosen : null, { opacity: full ? 0.5 : 1 }]}
              accessibilityRole={one ? 'radio' : 'checkbox'}
              accessibilityState={{ checked: on, disabled: full }}
              disabled={full || casting}
              onPress={() => choose(q, o.key)}
              testID={testIdWithKey(PollsIds.option)}
            >
              <Icon
                name={
                  one ? (on ? 'radiobox-marked' : 'radiobox-blank') : on ? 'checkbox-marked' : 'checkbox-blank-outline'
                }
                size={24}
                color={on ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
              />
              <ThemedText variant={on ? 'bold' : 'normal'} style={styles.flex}>
                {o.text?.trim() || o.key}
              </ThemedText>
            </Pressable>
          )
        })}
      </View>
    )
  }

  if (!shown)
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.content}>
          {poll.failed ? (
            <ThemedText testID={testIdWithKey(PollsIds.readFailed)}>{t('Polls.ReadFailed')}</ThemedText>
          ) : (
            <ActivityIndicator color={ColorPalette.brand.primary} testID={testIdWithKey(PollsIds.reading)} />
          )}
        </View>
      </SafeAreaView>
    )

  const minutes = minutesSinceTicket(record, Date.now())
  const lines = (
    <>
      {minutes !== undefined ? (
        <ThemedText testID={testIdWithKey(PollsIds.firstHour)}>{t('Polls.FirstHour', { count: minutes })}</ThemedText>
      ) : null}
      <ThemedText testID={testIdWithKey(PollsIds.boardLine)}>{boardLine(t, shown)}</ThemedText>
      <ThemedText testID={testIdWithKey(PollsIds.seenLine)}>
        {`${t('Polls.Seen')} `}
        <ThemedText
          style={styles.link}
          accessibilityRole="button"
          onPress={() => {
            scrollToDetails.current = !details
            setDetails(!details)
          }}
          testID={testIdWithKey(PollsIds.details)}
        >
          {details ? t('Polls.HideDetails') : t('Polls.Details')}
        </ThemedText>
      </ThemedText>
      {details ? (
        <View style={{ gap: 6 }}>
          <ThemedText>{t('Polls.SeesAgent')}</ThemedText>
          <ThemedText>{t('Polls.SeesCollector')}</ThemedText>
          <ThemedText>{t('Polls.SeesCommunity')}</ThemedText>
        </View>
      ) : null}
      {failure ? (
        <ThemedText style={styles.error} accessibilityLiveRegion="polite" testID={testIdWithKey(PollsIds.castFailed)}>
          {failure}
        </ThemedText>
      ) : null}
    </>
  )

  const castButton = (
    <Button
      title={t('Polls.CastMyVote')}
      buttonType={ButtonType.Primary}
      onPress={
        shown.manifest.binding && !checking
          ? () => {
              // The check step opens at its top, on the choice it shows, not where the ballot was scrolled to.
              scroll.current?.scrollTo({ y: 0, animated: false })
              setChecking(true)
            }
          : cast
      }
      disabled={!castable}
      testID={testIdWithKey(PollsIds.cast)}
    >
      {casting ? <ActivityIndicator color={ColorPalette.brand.text} /> : null}
    </Button>
  )

  let body: React.ReactNode
  let bar: React.ReactNode
  if (casting) {
    body = (
      <View style={styles.card} testID={testIdWithKey(PollsIds.casting)}>
        <ThemedText variant="bold">{t('Polls.Casting')}</ThemedText>
        {['Polls.StepReady', 'Polls.StepPause', 'Polls.StepSending', 'Polls.StepReceipt'].map((key) => (
          <ThemedText key={key}>{t(key)}</ThemedText>
        ))}
        <ThemedText style={styles.muted}>{t('Polls.PauseExplains')}</ThemedText>
        <ThemedText style={styles.muted}>{t('Polls.LeaveIsFine')}</ThemedText>
        <ActivityIndicator color={ColorPalette.brand.primary} />
      </View>
    )
  } else if (checking) {
    // Ballot B: a binding poll shows what was picked, and what's seen, before it goes.
    body = (
      <>
        <ThemedText variant="headingFour" accessibilityRole="header">
          {t('Polls.Check')}
        </ThemedText>
        {shown.manifest.questions.map((q) => {
          const a = given[q.key] as { choice?: string[]; text?: string } | undefined
          const picked = a?.choice?.map((k) => optionLabel(q, k)).join(', ') || a?.text
          return (
            <View key={q.key} style={styles.card} testID={testIdWithKey(PollsIds.check)}>
              <ThemedText style={styles.muted}>{q.text?.trim() || q.key}</ThemedText>
              <ThemedText variant="bold">{picked || t('Polls.NothingChosen')}</ThemedText>
            </View>
          )
        })}
      </>
    )
    bar = (
      <>
        <ThemedText variant="bold" testID={testIdWithKey(PollsIds.beforeItGoes)}>
          {t('Polls.BeforeItGoes')}
        </ThemedText>
        {lines}
        <View style={styles.buttons}>
          <View style={styles.flex}>
            <Button
              title={t('Polls.Back')}
              buttonType={ButtonType.Secondary}
              onPress={() => setChecking(false)}
              testID={testIdWithKey(PollsIds.back)}
            />
          </View>
          <View style={styles.flex}>{castButton}</View>
        </View>
      </>
    )
  } else {
    body = (
      <>
        <ThemedText variant="headingFour" accessibilityRole="header">
          {pollTitle(t, shown.manifest.title)}
        </ThemedText>
        {unshown.length > 0 ? (
          <ThemedText style={styles.error} testID={testIdWithKey(PollsIds.cantShow)}>
            {t('Polls.CantShowQuestion')}
          </ThemedText>
        ) : null}
        {shown.manifest.questions.map(question)}
      </>
    )
    bar = (
      <>
        {lines}
        {castButton}
      </>
    )
  }

  // Open details make the bar too tall to stay fixed: it would cover the questions, so it goes to the end of the
  // scroll, as at large text, and the screen scrolls down to it.
  const barInScroll = bar && (isLargeText(fontScale) || details)
  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.content}
        onContentSizeChange={() => {
          if (!scrollToDetails.current) return
          scrollToDetails.current = false
          scroll.current?.scrollToEnd()
        }}
        testID={testIdWithKey(PollsIds.ballotScreen)}
      >
        {body}
        {barInScroll ? <View style={{ gap: 10 }}>{bar}</View> : null}
      </ScrollView>
      {bar && !barInScroll ? <View style={styles.bar}>{bar}</View> : null}
    </SafeAreaView>
  )
}

export default PollBallot
