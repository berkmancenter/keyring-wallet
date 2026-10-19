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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { ClaimedSignIn } from '../module/oobSignIn'
import { GRANT_LIFETIME_SECONDS } from '../module/oobSignInAgent'
import {
  agentSignInSteps,
  pendingSignInLink,
  signInCommunityOf,
  signInReasonOf,
  type ProvedSignIn,
  type SignInEndReason,
  type SignInIdentity,
  type SignInSteps,
} from '../module/signInSteps'

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
  | { kind: 'reading' }
  | { kind: 'confirm'; vtcDid: string; name: string; host?: string; identities: SignInIdentity[] }
  | { kind: 'notMember'; name: string; vtcDid: string }
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
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

/** A persona with no name, by its DID's last part (a did:webvh path names it), never the whole DID on a picker row. */
export const shortPersonaDid = (did: string): string => {
  const last = did.split(':').pop() || did
  return last.length > 24 ? `${last.slice(0, 20)}…` : last
}

export const SignInFlow: React.FC<SignInFlowProps> = ({ link, steps, now = nowSeconds, onClose }) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const headerHeight = useSafeHeaderHeight()
  const keyboard = useMeasuredKeyboardOffset(headerHeight)
  const [step, setStep] = useState<Step>({ kind: 'reading' })
  const [number, setNumber] = useState('')
  const [clock, setClock] = useState(now)
  // Kept from the confirm step for the review; from the claim, its deadline.
  const [communityName, setCommunityName] = useState('')
  const [deadline, setDeadline] = useState<number | undefined>()

  // What the unmount and the deadline need without re-running effects.
  const claimedRef = useRef<ClaimedSignIn | undefined>(undefined)
  // The identity the person chose, when there was a choice; else the steps take the one found.
  const chosenRef = useRef<SignInIdentity | undefined>(undefined)
  const approveStarted = useRef(false)
  const endedRef = useRef(false)
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
      end({ kind: 'failed', reason: signInReasonOf(error) })
    },
    [end]
  )

  // 1. Read the code and the records. Local only.
  useEffect(() => {
    if (!link) {
      end({ kind: 'noCode' })
      return
    }
    const read = signInCommunityOf(link, now())
    if ('reason' in read) {
      end({ kind: 'failed', reason: read.reason })
      return
    }
    let live = true
    stepsRef.current
      .community(read.vtcDid)
      .then(({ member, name, identities = [] }) => {
        if (!live) return
        // Never the raw DID as its name: what the community calls itself,
        // else its handle, with the DID behind Details (IN-249).
        const label = name?.trim() || unnamedCommunityLabel(read.vtcDid, t)
        setCommunityName(label)
        setStep(
          member
            ? { kind: 'confirm', vtcDid: read.vtcDid, name: label, host: didDomainPath(read.vtcDid), identities }
            : { kind: 'notMember', name: label, vtcDid: read.vtcDid }
        )
      })
      .catch((e) => {
        if (live) fail(e)
      })
    return () => {
      live = false
    }
    // Read once per code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link])

  // The decision deadline, from the claim on.
  const watching = WATCHED.includes(step.kind) && deadline !== undefined
  useEffect(() => {
    if (!watching) return
    const timer = setInterval(() => setClock(now()), 1000)
    return () => clearInterval(timer)
  }, [watching, now])
  useEffect(() => {
    if (watching && deadline !== undefined && clock >= deadline) end({ kind: 'timedOut' })
  }, [watching, deadline, clock, end])

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
      end({ kind: 'failed', reason: signInReasonOf(e) })
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
      case 'reading':
        return <ActivityIndicator color={ColorPalette.brand.primary} />
      case 'confirm':
        return (
          <View style={{ gap: 16 }} testID={id(SignInIds.confirm)}>
            <ThemedText variant="headingThree" accessibilityRole="header">
              {t('SignIn.ConfirmTitle', { name: step.name, interpolation: { escapeValue: false } })}
            </ThemedText>
            <ThemedText>{t('SignIn.ConfirmBody')}</ThemedText>
            <View style={styles.card}>
              {row(t('SignIn.CommunityLabel'), step.name, SignInIds.community)}
              {/* Who the code says the community is, domain and path, from
                  the code alone: nothing is resolved before Continue, so it
                  is marked unverified (VTI-LNK-050). */}
              {row(t('SignIn.HostLabel'), step.host ?? t('SignIn.NoDomain'), SignInIds.host)}
              <ThemedText style={styles.muted} testID={id(SignInIds.unverified)}>
                {t('SignIn.Unverified')}
              </ThemedText>
            </View>
            <View style={styles.actions}>
              <Button
                title={t('SignIn.Continue')}
                buttonType={ButtonType.Primary}
                onPress={() => void onContinue(step.identities)}
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
      case 'notMember':
        return (
          <View style={{ gap: 16 }} testID={id(SignInIds.notMember)}>
            <ThemedText variant="headingThree" accessibilityRole="header">
              {t('SignIn.NotSignedIn')}
            </ThemedText>
            <ThemedText testID={id(SignInIds.resultMessage)}>{t('SignIn.Failure.notAMember')}</ThemedText>
            {row(t('SignIn.CommunityLabel'), step.name, SignInIds.community)}
            <DidDetails did={step.vtcDid} testIdStem={SignInIds.communityDid} />
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
              {t('SignIn.ChooseTitle')}
            </ThemedText>
            <ThemedText>{t('SignIn.ChooseBody')}</ThemedText>
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
        return busyNote(t('SignIn.Claiming'), SignInIds.claiming)
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
            <View style={styles.card}>
              {row(t('SignIn.CommunityLabel'), communityName, SignInIds.community)}
              {row(t('SignIn.Website'), proved.claimed.portalOrigin, SignInIds.website)}
              {proved.identifiedAs ? row(t('SignIn.SigningInAs'), proved.identifiedAs, SignInIds.identifiedAs) : null}
            </View>
            <View style={styles.card}>
              <ThemedText style={styles.muted} testID={id(SignInIds.reportedBy)}>
                {t('SignIn.ReportedBy')}
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
                without asking the phone each time. Said in words; a family Keyring has no words for is named. */}
            {proved.signingScope?.length ? (
              <ThemedText testID={id(SignInIds.signingScope)}>
                {t('SignIn.SigningScope', {
                  areas: proved.signingScope
                    .map((family) => (family === 'vtc/directory' ? t('SignIn.ScopeDirectory') : family))
                    .join(', '),
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

/** The screen in the My Agent stack: the code the scanner held, the agent's steps. */
const SignIn: React.FC<{ steps?: SignInSteps; link?: string }> = ({ steps, link }) => {
  const { agent } = useAgent()
  const navigation = useNavigation()
  // Read during render, so both renders of a double render see it; cleared once kept.
  const [code] = useState(() => link ?? pendingSignInLink.peek())
  useEffect(() => {
    pendingSignInLink.clear()
  }, [])
  const agentSteps = useMemo(() => steps ?? (agent ? agentSignInSteps(agent) : undefined), [steps, agent])
  if (!agentSteps) return null
  return <SignInFlow link={code} steps={agentSteps} onClose={() => navigation.goBack()} />
}

export default SignIn
