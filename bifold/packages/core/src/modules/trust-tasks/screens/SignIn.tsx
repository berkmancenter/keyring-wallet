/**
 * Signing in to a community's website from a scanned code (Trust Task
 * `auth/oob`, trigger-link sign-in): one screen, in steps.
 *
 *  1. Confirm — the community named from Keyring's own records, its host,
 *     Continue and Cancel. Nothing is sent before Continue; a community this
 *     phone has not joined is said so, and nothing else is offered. A
 *     community where several identities hold a membership (on this phone or
 *     on any linked agent, IN-296) asks which one first: the identity, the
 *     agent that holds it, and where it came from. One goes straight on.
 *  2. Claiming — the code is claimed for this phone (`claim`).
 *  3. The number — the two digits the website shows, typed once. A wrong
 *     number ends the request.
 *  4. Checking — `identifyAndProve`.
 *  5. Review — what the community reports of the browser asking, said to be
 *     its report, the website, and that only that browser's session is
 *     signed in. Approve (`approve`, which asks for Face ID / the screen lock)
 *     or Decline (`cancel`; never `approve`).
 *  6. How it ended.
 *
 * A code from the service that hosts agents this phone got there (IN-388)
 * runs the same steps in the service's words: the choice is between those
 * agents, and the review names the service as its own signed answer does, the
 * verified website and the agent, never the key the service knows it by. A
 * code from a sender that is neither says, when the phone holds an agent that
 * kept no key for its host, that such an agent cannot sign in there yet.
 *
 * The community gives the request a decision deadline: the time left shows
 * from the claim on, and when it runs out before Approve the request is over.
 * Leaving the screen after a claim and before Approve gives the request up.
 *
 * Every step goes through one `SignInSteps` object (`module/signInSteps`), so
 * the screen is tested with fakes and holds no protocol of its own.
 *
 * @module trust-tasks/screens/SignIn
 */
import { useAgent } from '@bifold/react-hooks'
import { useNavigation } from '@react-navigation/native'
import type { StackNavigationProp } from '@react-navigation/stack'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { registerOtaApplyBlocker } from '../../../utils/otaApply'
import { Screens, type MyAgentStackParams } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import type { ClaimedSignIn } from '../module/oobSignIn'
import { GRANT_LIFETIME_SECONDS } from '../module/oobSignInAgent'
import {
  agentSignInSteps,
  signInCommunityOf,
  signInEndedBy,
  type ProvedSignIn,
  type SignInEndReason,
  type SignInIdentity,
  type SignInSteps,
} from '../module/signInSteps'
import { communityTarget } from '../module/vtiCommunityLink'

import { didDomainPath, unnamedCommunityLabel } from './communityName'
import { DidDetails } from './DidDetails'
import { useMeasuredKeyboardOffset } from './keyboardOffset'
import { SignInIds } from './SignIn.ids'
import { useSafeHeaderHeight } from './VtaLink'

const id = (key: string) => testIdWithKey(key)

/** How the sign-in ended, when it did not end signed in. */
export type SignInEnd =
  | { kind: 'approved' }
  | { kind: 'declined' }
  | { kind: 'timedOut' }
  | { kind: 'noCode' }
  | { kind: 'failed'; reason?: SignInEndReason }

type Step =
  /**
   * From the first frame: the community and its host as the code names them, read offline. Its name and the
   * identities it could sign in as are unknown (undefined) until the records are read, and Continue waits for them.
   */
  | { kind: 'confirm'; vtcDid: string; host?: string; name?: string; identities?: SignInIdentity[] }
  /** `olderAgents`: the phone holds an agent that kept no sign-in key for its host, which cannot sign in there yet. */
  /** `name`: only a name on record. A sender with none is shown by its address: nothing was looked up (VTI-LNK-050). */
  | { kind: 'notMember'; name?: string; vtcDid: string; olderAgents?: boolean }
  | { kind: 'choose'; identities: SignInIdentity[] }
  | { kind: 'claiming' }
  | { kind: 'number'; claimed: ClaimedSignIn }
  | { kind: 'checking'; claimed: ClaimedSignIn }
  | { kind: 'review'; proved: ProvedSignIn }
  | { kind: 'approving'; proved: ProvedSignIn }
  | { kind: 'declining' }
  | { kind: 'ended'; end: SignInEnd }

/** Steps on which the decision deadline is watched. */
const WATCHED: Step['kind'][] = ['number', 'checking', 'review']

/**
 * Steps of a request under way: from Continue to its end. An update must not reload the app over one (the
 * claim, the number and the answer live only in this screen), so it holds the update back while it lasts.
 */
const IN_REQUEST: Step['kind'][] = ['claiming', 'number', 'checking', 'review', 'approving', 'declining']

/** What a browser may sign as the person, in words, by the task family a community offers (`signingScope`). */
const SCOPE_WORDS = new Map([
  ['vtc/directory', 'SignIn.ScopeDirectory'],
  ['vtc/groups', 'SignIn.ScopeGroups'],
  ['git-ns/view', 'SignIn.ScopeRepositories'],
  ['git-ns/account/link-status', 'SignIn.ScopeAccountLink'],
])

/** The words for an ending, as a localization key. */
export function signInEndKey(end: SignInEnd): string {
  switch (end.kind) {
    case 'approved':
      return 'SignIn.SignedIn'
    case 'declined':
      return 'SignIn.Declined'
    case 'timedOut':
      return 'SignIn.TimedOut'
    case 'noCode':
      return 'SignIn.NoCode'
    default:
      return `SignIn.Failure.${end.reason ?? 'unknown'}`
  }
}

export interface SignInFlowProps {
  /** The scanned code. */
  link: string | undefined
  steps: SignInSteps
  /** Now, in seconds since the epoch. */
  now?: () => number
  /** Leave the screen. */
  onClose: () => void
  /** Go to Join for this community, in place of this screen (IN-406). Without it, an unjoined code offers no join. */
  onJoin?: (vtcDid: string) => void
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

/** A persona with no name, by its DID's last part (a did:webvh path names it), never the whole DID on a picker row. */
export const shortPersonaDid = (did: string): string => {
  const last = did.split(':').pop() || did
  return last.length > 24 ? `${last.slice(0, 20)}…` : last
}

/** The first step, from the code alone: read offline, so the first frame is Confirm (or why the code can't be used). */
function firstStep(link: string | undefined, at: number): Step {
  if (!link) return { kind: 'ended', end: { kind: 'noCode' } }
  const read = signInCommunityOf(link, at)
  if ('reason' in read) return { kind: 'ended', end: { kind: 'failed', reason: read.reason } }
  return { kind: 'confirm', vtcDid: read.vtcDid, host: didDomainPath(read.vtcDid) }
}

export const SignInFlow: React.FC<SignInFlowProps> = ({ link, steps, now = nowSeconds, onClose, onJoin }) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const headerHeight = useSafeHeaderHeight()
  const keyboard = useMeasuredKeyboardOffset(headerHeight)
  const [first] = useState(() => firstStep(link, now()))
  // The step as recorded; what is shown is `step`, below (a deadline that has passed shows as timed out).
  const [recorded, setStep] = useState<Step>(first)
  const [number, setNumber] = useState('')
  const [clock, setClock] = useState(now)
  // Kept from the confirm step for the review; from the claim, its deadline.
  const [communityName, setCommunityName] = useState('')
  // The code is from the service that hosts agents this phone got there (IN-388): its words, not a community's.
  const [service, setService] = useState(false)
  const word = (key: string) => (service ? `SignIn.Service.${key}` : `SignIn.${key}`)
  const [deadline, setDeadline] = useState<number | undefined>()
  // "Check and join" on a code from a community this phone has not joined (IN-406): idle, checking, not one, or
  // not checked (no answer in time: the offer stays, to try again).
  const [joinCheck, setJoinCheck] = useState<'idle' | 'checking' | 'notJoinable' | 'unchecked'>('idle')

  // What the unmount and the deadline need without re-running effects.
  const claimedRef = useRef<ClaimedSignIn | undefined>(undefined)
  // The identity the person chose, when there was a choice; else the steps take the one found.
  const chosenRef = useRef<SignInIdentity | undefined>(undefined)
  const approveStarted = useRef(false)
  const endedRef = useRef(first.kind === 'ended')
  const stepsRef = useRef(steps)
  stepsRef.current = steps

  const end = useCallback((ending: SignInEnd) => {
    endedRef.current = true
    setStep({ kind: 'ended', end: ending })
  }, [])

  /** The request's step, unless it ended (the deadline passed) while that step waited. */
  const advance = useCallback((next: Step) => {
    if (!endedRef.current) setStep(next)
  }, [])

  const fail = useCallback(
    (error: unknown) => {
      if (endedRef.current) return
      end({ kind: 'failed', reason: signInEndedBy(error) })
    },
    [end]
  )

  // 1. The records, under the Confirm the code already drew: the community's name on record, and the identities
  // the phone could sign in as. Nothing is sent to the community before Continue.
  useEffect(() => {
    if (first.kind !== 'confirm') return
    const { vtcDid } = first
    let live = true
    stepsRef.current
      .community(vtcDid)
      .then(({ member, name, identities = [], farm, olderAgents }) => {
        if (!live) return
        // Never the raw DID as its name: what the community calls itself,
        // else its handle, with the DID behind Details (IN-249). A service
        // names itself only in its signed answer to the claim, so until then
        // it is its address.
        const label = (farm ? didDomainPath(vtcDid) : name?.trim()) || unnamedCommunityLabel(vtcDid, t)
        setService(Boolean(farm))
        setCommunityName(label)
        setStep((current) =>
          current.kind !== 'confirm'
            ? current
            : member
              ? { ...current, name: label, identities }
              : {
                  kind: 'notMember',
                  ...(name?.trim() ? { name: name.trim() } : {}),
                  vtcDid,
                  ...(olderAgents ? { olderAgents } : {}),
                }
        )
      })
      .catch((e) => {
        if (live) fail(e)
      })
    return () => {
      live = false
    }
    // Read once: the screen's code is its own for its whole life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The decision deadline, from the claim on. Timed out is decided in render, from the clock: the frame in which
  // the deadline passes says so, never "0 s left" first. The effect only records the end, so no later step
  // replaces it and leaving no longer gives the request up.
  const watching = WATCHED.includes(recorded.kind) && deadline !== undefined
  const timedOut = watching && clock >= (deadline as number)
  const step: Step = timedOut ? { kind: 'ended', end: { kind: 'timedOut' } } : recorded
  useEffect(() => {
    if (!watching) return
    const timer = setInterval(() => setClock(now()), 1000)
    return () => clearInterval(timer)
  }, [watching, now])
  useEffect(() => {
    if (timedOut) end({ kind: 'timedOut' })
  }, [timedOut, end])

  // No update is applied over a request under way (utils/otaApply); released at its end, or when the screen goes.
  const inRequest = IN_REQUEST.includes(step.kind)
  useEffect(() => (inRequest ? registerOtaApplyBlocker('sign-in') : undefined), [inRequest])

  // Leaving after a claim and before Approve gives the request up, so the
  // browser stops waiting. Never after Approve: the community would cancel a
  // sign-in already approved.
  useEffect(
    () => () => {
      const claimed = claimedRef.current
      if (claimed && !approveStarted.current && !endedRef.current) {
        stepsRef.current.cancel(claimed).catch(() => undefined)
      }
    },
    []
  )

  const onContinue = async (identities: SignInIdentity[] = []) => {
    if (!link) return
    // Several identities: which one signs in is asked before anything is sent.
    if (identities.length > 1 && !chosenRef.current) {
      setStep({ kind: 'choose', identities })
      return
    }
    setStep({ kind: 'claiming' })
    try {
      const claimed = await steps.claim(link)
      claimedRef.current = claimed
      setDeadline(claimed.decisionDeadline)
      setClock(now())
      advance({ kind: 'number', claimed })
    } catch (e) {
      fail(e)
    }
  }

  const onNumber = async (claimed: ClaimedSignIn) => {
    if (number.length !== 2) return
    setStep({ kind: 'checking', claimed })
    try {
      const proved = await steps.identifyAndProve(claimed, number, chosenRef.current)
      advance({ kind: 'review', proved })
    } catch (e) {
      fail(e)
    }
  }

  const onApprove = async (proved: ProvedSignIn) => {
    approveStarted.current = true
    setStep({ kind: 'approving', proved })
    try {
      await steps.approve(proved)
      end({ kind: 'approved' })
    } catch (e) {
      // Approve began, so the deadline no longer decides: its answer does.
      end({ kind: 'failed', reason: signInEndedBy(e) })
    }
  }

  /** Give a claimed request up: Decline, or Cancel at the number. Nothing is signed in either way. */
  const onDecline = async (claimed: ClaimedSignIn) => {
    setStep({ kind: 'declining' })
    try {
      await steps.cancel(claimed)
    } catch {
      // Unanswered, the request still ends at its deadline; nothing was signed in.
    }
    end({ kind: 'declined' })
  }

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
        content: { padding: 20, gap: 16, flexGrow: 1 },
        card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 12 },
        row: { gap: 2 },
        muted: { color: ColorPalette.grayscale.mediumGrey },
        error: { color: ColorPalette.semantic.error },
        actions: { gap: 12 },
        busy: { alignItems: 'center', gap: 12, paddingVertical: 24 },
        // The name's place while it is read: a line's height, so the card does not grow when it arrives.
        reading: { alignSelf: 'flex-start', minHeight: TextTheme.bold.lineHeight ?? 22 },
        input: {
          ...TextTheme.headingTwo,
          borderWidth: 1,
          borderColor: ColorPalette.grayscale.mediumGrey,
          borderRadius: 6,
          padding: 12,
          minHeight: 56,
          textAlign: 'center',
          letterSpacing: 8,
          alignSelf: 'center',
          minWidth: 120,
        },
      }),
    [ColorPalette, TextTheme]
  )

  const row = (label: string, value: string, testID: string) => (
    <View style={styles.row} key={testID}>
      <ThemedText style={styles.muted}>{label}</ThemedText>
      <ThemedText variant="bold" testID={id(testID)}>
        {value}
      </ThemedText>
    </View>
  )

  const busyNote = (words: string, testID: string) => (
    <View style={styles.busy} testID={id(testID)}>
      <ActivityIndicator color={ColorPalette.brand.primary} />
      <ThemedText>{words}</ThemedText>
    </View>
  )

  const timeLeft = () =>
    deadline === undefined ? null : (
      <ThemedText style={styles.muted} testID={id(SignInIds.timeLeft)}>
        {t('SignIn.TimeLeft', { seconds: Math.max(0, deadline - clock) })}
      </ThemedText>
    )

  const reported = (value: string | undefined) => value?.trim() || t('SignIn.NotReported')

  const body = (): React.ReactNode => {
    switch (step.kind) {
      case 'confirm': {
        // Ready once the records are read: until then the name is unknown (never guessed from the code) and
        // Continue waits, so nothing can be claimed for a community the phone may not belong to.
        const ready = step.identities !== undefined
        return (
          <View style={{ gap: 16 }} testID={id(SignInIds.confirm)}>
            <ThemedText variant="headingThree" accessibilityRole="header">
              {step.name === undefined
                ? t('SignIn.ConfirmTitleUnread')
                : t('SignIn.ConfirmTitle', { name: step.name, interpolation: { escapeValue: false } })}
            </ThemedText>
            <ThemedText>{t(word('ConfirmBody'))}</ThemedText>
            <View style={styles.card}>
              {step.name === undefined ? (
                <View style={styles.row}>
                  <ThemedText style={styles.muted}>{t('SignIn.CommunityLabel')}</ThemedText>
                  <ActivityIndicator
                    color={ColorPalette.brand.primary}
                    style={styles.reading}
                    accessibilityLabel={t('SignIn.ReadingCommunity')}
                  />
                </View>
              ) : service ? (
                row(t('SignIn.Service.Label'), step.name, SignInIds.service)
              ) : (
                row(t('SignIn.CommunityLabel'), step.name, SignInIds.community)
              )}
              {/* Who the code says the community is, domain and path, from
                  the code alone: nothing is resolved before Continue, so it
                  is marked unverified (VTI-LNK-050). */}
              {row(t(word('HostLabel')), step.host ?? t('SignIn.NoDomain'), SignInIds.host)}
              <ThemedText style={styles.muted} testID={id(SignInIds.unverified)}>
                {t(word('Unverified'))}
              </ThemedText>
            </View>
            <View style={styles.actions}>
              <Button
                title={t('SignIn.Continue')}
                buttonType={ButtonType.Primary}
                onPress={() => void onContinue(step.identities)}
                // Disabled is also what the e2e drivers wait on (accessibilityState, XCUITest's `enabled`).
                disabled={!ready}
                testID={id(SignInIds.continue)}
              />
              <Button
                title={t('SignIn.Cancel')}
                buttonType={ButtonType.Secondary}
                onPress={onClose}
                testID={id(SignInIds.cancel)}
              />
            </View>
          </View>
        )
      }
      case 'notMember':
        return (
          <View style={{ gap: 16 }} testID={id(SignInIds.notMember)}>
            <ThemedText variant="headingThree" accessibilityRole="header">
              {t('SignIn.NotSignedIn')}
            </ThemedText>
            <ThemedText testID={id(SignInIds.resultMessage)}>{t('SignIn.Failure.notAMember')}</ThemedText>
            {step.olderAgents ? (
              <ThemedText testID={id(SignInIds.olderAgents)}>{t('SignIn.OlderAgents')}</ThemedText>
            ) : null}
            {/* A name on record, else the sender's address: whether it published a name, or is a community at all (a
                Farm's code reads the same), is not known before anything is looked up (IN-388 step D). One row either
                way, naming the sender (the wallet e2e reads it). */}
            {step.name
              ? row(t('SignIn.CommunityLabel'), step.name, SignInIds.community)
              : row(t('SignIn.HostLabel'), didDomainPath(step.vtcDid) ?? t('SignIn.NoDomain'), SignInIds.community)}
            <DidDetails did={step.vtcDid} testIdStem={SignInIds.communityDid} />
            {/* A community's join page shows this same code (IN-406). Nothing is resolved until the tap
                (VTI-LNK-050), and nothing is sent to the community: Join asks it first. */}
            {onJoin && steps.joinable ? (
              joinCheck === 'notJoinable' ? (
                <ThemedText testID={id(SignInIds.notJoinable)}>{t('SignIn.NotJoinable')}</ThemedText>
              ) : (
                <>
                  {joinCheck === 'unchecked' ? (
                    <ThemedText testID={id(SignInIds.joinUnchecked)}>{t('SignIn.JoinUnchecked')}</ThemedText>
                  ) : (
                    <ThemedText>{t('SignIn.JoinHint')}</ThemedText>
                  )}
                  <Button
                    title={t('SignIn.CheckAndJoin')}
                    buttonType={ButtonType.Secondary}
                    disabled={joinCheck === 'checking'}
                    onPress={() => {
                      const vtcDid = step.vtcDid
                      setJoinCheck('checking')
                      stepsRef.current
                        .joinable?.(vtcDid)
                        .catch(() => undefined)
                        .then((yes) => {
                          if (yes) onJoin(vtcDid)
                          else setJoinCheck(yes === false ? 'notJoinable' : 'unchecked')
                        })
                    }}
                    testID={id(SignInIds.checkAndJoin)}
                  >
                    {joinCheck === 'checking' ? <ActivityIndicator color={ColorPalette.brand.primary} /> : null}
                  </Button>
                </>
              )
            ) : null}
            <Button
              title={t('SignIn.Done')}
              buttonType={ButtonType.Primary}
              onPress={onClose}
              testID={id(SignInIds.done)}
            />
          </View>
        )
      case 'choose':
        return (
          <View style={{ gap: 16 }} testID={id(SignInIds.choose)}>
            <ThemedText variant="headingThree" accessibilityRole="header">
              {t(word('ChooseTitle'))}
            </ThemedText>
            <ThemedText>{t(word('ChooseBody'))}</ThemedText>
            {step.identities.map((identity, n) => (
              <Pressable
                key={`${identity.vtaDid} ${identity.did}`}
                style={styles.card}
                accessibilityRole="button"
                onPress={() => {
                  chosenRef.current = identity
                  void onContinue()
                }}
                testID={id(`${SignInIds.identityOption}-${n}`)}
              >
                {identity.source === 'farm' ? (
                  // An agent got from the service: the agent is the choice, its key is never shown.
                  <>
                    <ThemedText variant="bold" testID={id(`${SignInIds.identityAgent}-${n}`)}>
                      {identity.agentName}
                    </ThemedText>
                    {identity.current ? (
                      <ThemedText style={styles.muted}>{t('SignIn.Service.ChooseCurrent')}</ThemedText>
                    ) : null}
                  </>
                ) : (
                  <>
                    <ThemedText variant="bold">{identity.label?.trim() || shortPersonaDid(identity.did)}</ThemedText>
                    <ThemedText testID={id(`${SignInIds.identityAgent}-${n}`)}>
                      {t(identity.current ? 'SignIn.ChooseOnAgentCurrent' : 'SignIn.ChooseOnAgent', {
                        agent: identity.agentName,
                        interpolation: { escapeValue: false },
                      })}
                    </ThemedText>
                    <ThemedText style={styles.muted}>
                      {t(identity.source === 'thisPhone' ? 'SignIn.ChooseFromPhone' : 'SignIn.ChooseFromAgent')}
                    </ThemedText>
                  </>
                )}
              </Pressable>
            ))}
            <Button
              title={t('SignIn.Cancel')}
              buttonType={ButtonType.Secondary}
              onPress={onClose}
              testID={id(SignInIds.cancel)}
            />
          </View>
        )
      case 'claiming':
        return busyNote(t(word('Claiming')), SignInIds.claiming)
      case 'number': {
        const { claimed } = step
        return (
          <View style={{ gap: 16 }} testID={id(SignInIds.number)}>
            <ThemedText variant="headingThree" accessibilityRole="header">
              {t('SignIn.NumberTitle')}
            </ThemedText>
            <ThemedText>{t('SignIn.NumberHint')}</ThemedText>
            <TextInput
              style={styles.input}
              value={number}
              onChangeText={(text) => setNumber(text.replace(/[^0-9]/g, '').slice(0, 2))}
              keyboardType="number-pad"
              maxLength={2}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => void onNumber(claimed)}
              accessibilityLabel={t('SignIn.NumberLabel')}
              testID={id(SignInIds.numberInput)}
            />
            {timeLeft()}
            <View style={styles.actions}>
              <Button
                title={t('SignIn.Continue')}
                buttonType={ButtonType.Primary}
                onPress={() => void onNumber(claimed)}
                disabled={number.length !== 2}
                testID={id(SignInIds.numberContinue)}
              />
              <Button
                title={t('SignIn.Cancel')}
                buttonType={ButtonType.Secondary}
                onPress={() => void onDecline(claimed)}
                testID={id(SignInIds.cancel)}
              />
            </View>
          </View>
        )
      }
      case 'checking':
        return (
          <>
            {busyNote(t('SignIn.Checking'), SignInIds.checking)}
            {timeLeft()}
          </>
        )
      case 'review':
      case 'approving': {
        const { proved } = step
        const { requester } = proved
        const busy = step.kind === 'approving'
        const sameNetwork =
          requester.sameNetwork === undefined
            ? t('SignIn.NotReported')
            : t(requester.sameNetwork ? 'SignIn.Yes' : 'SignIn.No')
        return (
          <View style={{ gap: 16 }} testID={id(SignInIds.review)}>
            <ThemedText variant="headingThree" accessibilityRole="header">
              {t('SignIn.ReviewTitle')}
            </ThemedText>
            {'farm' in proved ? (
              // The service as its own signed answer names itself, the verified website, and the agent chosen:
              // the key the service knows it by is never shown.
              <View style={styles.card}>
                {row(t('SignIn.Service.Label'), proved.farm.serviceName ?? communityName, SignInIds.service)}
                {row(t('SignIn.Website'), proved.claimed.portalOrigin, SignInIds.website)}
                {row(t('SignIn.Service.Agent'), proved.farm.agentName, SignInIds.agent)}
              </View>
            ) : (
              <View style={styles.card}>
                {row(t('SignIn.CommunityLabel'), communityName, SignInIds.community)}
                {row(t('SignIn.Website'), proved.claimed.portalOrigin, SignInIds.website)}
                {proved.identifiedAs ? row(t('SignIn.SigningInAs'), proved.identifiedAs, SignInIds.identifiedAs) : null}
              </View>
            )}
            <View style={styles.card}>
              <ThemedText style={styles.muted} testID={id(SignInIds.reportedBy)}>
                {t(word('ReportedBy'))}
              </ThemedText>
              {row(t('SignIn.Browser'), reported(requester.browser), SignInIds.browser)}
              {row(t('SignIn.System'), reported(requester.os), SignInIds.system)}
              {row(t('SignIn.Location'), reported(requester.location), SignInIds.location)}
              {row(t('SignIn.SameNetwork'), sameNetwork, SignInIds.sameNetwork)}
            </View>
            <ThemedText variant="bold" testID={id(SignInIds.sessionOnly)}>
              {t('SignIn.SessionOnly', { hours: GRANT_LIFETIME_SECONDS / 3600 })}
            </ThemedText>
            {/* 0.2 (IN-280): the browser's key may also sign these documents as the person, for this session,
                without asking the phone each time. Said in words; families Keyring has no words for are said once,
                as that, and never by their task names. The words are our own, so they are not escaped. */}
            {proved.signingScope?.length ? (
              <ThemedText testID={id(SignInIds.signingScope)}>
                {t('SignIn.SigningScope', {
                  areas: [
                    ...new Set(proved.signingScope.map((family) => SCOPE_WORDS.get(family) ?? 'SignIn.ScopeOther')),
                  ]
                    .map((key) => t(key))
                    .join(', '),
                  interpolation: { escapeValue: false },
                })}
              </ThemedText>
            ) : null}
            {busy ? null : timeLeft()}
            {busy ? (
              busyNote(t('SignIn.Approving'), SignInIds.busy)
            ) : (
              <View style={styles.actions}>
                <Button
                  title={t('SignIn.Approve')}
                  buttonType={ButtonType.Primary}
                  onPress={() => void onApprove(proved)}
                  testID={id(SignInIds.approve)}
                />
                <Button
                  title={t('SignIn.Decline')}
                  buttonType={ButtonType.Secondary}
                  onPress={() => void onDecline(proved.claimed)}
                  testID={id(SignInIds.decline)}
                />
              </View>
            )}
          </View>
        )
      }
      case 'declining':
        return busyNote(t('SignIn.Declining'), SignInIds.busy)
      case 'ended': {
        const ok = step.end.kind === 'approved'
        return (
          <View style={{ gap: 16 }} testID={id(SignInIds.result)}>
            <ThemedText variant="headingThree" accessibilityRole="header">
              {t(ok ? 'SignIn.SignedInTitle' : 'SignIn.NotSignedIn')}
            </ThemedText>
            <ThemedText testID={id(SignInIds.resultMessage)}>{t(signInEndKey(step.end))}</ThemedText>
            <Button
              title={t('SignIn.Done')}
              buttonType={ButtonType.Primary}
              onPress={onClose}
              testID={id(SignInIds.done)}
            />
          </View>
        )
      }
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        ref={keyboard.ref}
        onLayout={keyboard.onLayout}
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={keyboard.offset}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          testID={id(SignInIds.screen)}
        >
          {body()}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

/**
 * The screen in the My Agent stack: the code its route carries, the agent's
 * steps. Each scan is its own route (MyAgentStack's `getId`), so the code is
 * this screen's for its whole life: kept from the first render.
 */
const SignIn: React.FC<{ steps?: SignInSteps; link?: string; route?: { params?: { link?: string } } }> = ({
  steps,
  link,
  route,
}) => {
  const { agent } = useAgent()
  const navigation = useNavigation<StackNavigationProp<MyAgentStackParams>>()
  const [code] = useState(() => link ?? route?.params?.link)
  const agentSteps = useMemo(() => steps ?? (agent ? agentSignInSteps(agent) : undefined), [steps, agent])
  if (!agentSteps) return null
  // Join in place of this screen, as a scanned community DID opens it (vtiLinks routeBareDid).
  const onJoin = (communityDid: string) => {
    communityTarget.set({ communityDid })
    navigation.replace(Screens.VtiJoin)
  }
  return <SignInFlow link={code} steps={agentSteps} onClose={() => navigation.goBack()} onJoin={onJoin} />
}

export default SignIn
