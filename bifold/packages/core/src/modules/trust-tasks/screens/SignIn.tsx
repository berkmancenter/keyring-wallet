/**
 * Signing in to a community's website from a scanned code (Trust Task
 * `auth/oob`, trigger-link sign-in): one screen, in steps.
 *
 *  1. Confirm — the community named from Keyring's own records, its host,
 *     Continue and Cancel. Nothing is sent before Continue; a community this
 *     phone has not joined is said so, and nothing else is offered.
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
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { ClaimedSignIn } from '../module/oobSignIn'
import { signInCommunityLabel } from '../module/oobSignIn'
import {
  agentSignInSteps,
  pendingSignInLink,
  signInCommunityOf,
  signInReasonOf,
  type ProvedSignIn,
  type SignInEndReason,
  type SignInSteps,
} from '../module/signInSteps'

import { didHost } from './communityName'
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
  | { kind: 'confirm'; vtcDid: string; name: string; host?: string }
  | { kind: 'notMember'; name: string }
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
      .then(({ member, name }) => {
        if (!live) return
        const label = signInCommunityLabel(name, read.vtcDid)
        setCommunityName(label)
        setStep(
          member
            ? { kind: 'confirm', vtcDid: read.vtcDid, name: label, host: didHost(read.vtcDid) }
            : { kind: 'notMember', name: label }
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

  const onContinue = async () => {
    if (!link) return
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
      const proved = await steps.identifyAndProve(claimed, number)
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
              {step.host ? row(t('SignIn.HostLabel'), step.host, SignInIds.host) : null}
            </View>
            <View style={styles.actions}>
              <Button
                title={t('SignIn.Continue')}
                buttonType={ButtonType.Primary}
                onPress={() => void onContinue()}
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
            <Button
              title={t('SignIn.Done')}
              buttonType={ButtonType.Primary}
              onPress={onClose}
              testID={id(SignInIds.done)}
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
              {t('SignIn.SessionOnly')}
            </ThemedText>
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
