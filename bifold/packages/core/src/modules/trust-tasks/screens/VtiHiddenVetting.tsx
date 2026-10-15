/**
 * Private (hidden) vetting: applying to a community whose way in admits on a
 * proof that enough vetters vouched for the person, without the community
 * learning which. The person's agent holds the keys and builds the proof;
 * this screen carries what it is asked to (hiddenVettingSeam).
 *
 * What it shows is what hidden vetting allows: how many attestations the
 * agent has verified against how many the community needs, never who gave
 * them — an attestation carries a period label, shared by everyone drawing
 * in that period, and no vetter.
 *
 * Sending is three steps, each said: a single-use challenge from the
 * community, the proof (slow by design, up to about a minute and a half), and
 * the application. "Not enough vetters yet" belongs to the proof, not to the
 * community's answer, and only the last step's answer is the community's.
 *
 * @module trust-tasks/screens/VtiHiddenVetting
 */

import { useAgent } from '@bifold/react-hooks'
import { useNavigation, useRoute } from '@react-navigation/native'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import type { VtiCriterion } from '../module/joinManifest'
import { vtiAgent } from '../module/vtiAgent'

import { communityLabelOf } from './communityName'
import {
  hiddenVettingSeam,
  pcsErrorCode,
  type HiddenVettingProgress,
  type HiddenVettingRecord,
  type HiddenVettingVerdict,
} from './hiddenVettingSeam'
import { localDate } from './localTime'

export const HiddenVettingIds = {
  screen: 'HiddenVetting',
  notAvailable: 'HiddenVettingNotAvailable',
  start: 'HiddenVettingStart',
  progress: 'HiddenVettingProgress',
  attestation: 'HiddenVettingAttestation',
  ticketInput: 'HiddenVettingTicketInput',
  askVetter: 'HiddenVettingAskVetter',
  asked: 'HiddenVettingAsked',
  send: 'HiddenVettingSend',
  needMore: 'HiddenVettingNeedMore',
  step: 'HiddenVettingStep',
  result: 'HiddenVettingResult',
  error: 'HiddenVettingError',
  startAgain: 'HiddenVettingStartAgain',
  changed: 'HiddenVettingChanged',
  withdraw: 'HiddenVettingWithdraw',
} as const

/** The step under way while sending. */
export type SendStep = 'challenge' | 'prove' | 'submit'

/** How a trust-task error code reads, for the codes the screen knows; the rest is said plainly. */
export function hiddenVettingErrorKey(code: string | undefined): string {
  if (!code) return 'Vetting.Hidden.ErrorGeneric'
  if (code.endsWith(':noUsableAttestation')) return 'Vetting.Hidden.NotEnoughYet'
  // A step this build does not carry yet (an interim build, for testing).
  if (code.endsWith(':notImplemented')) return 'Vetting.Hidden.NotInThisBuild'
  if (code.endsWith(':notFound')) return 'Vetting.Hidden.ApplicationGone'
  if (code.endsWith(':attestationInvalid')) return 'Vetting.Hidden.AttestationRefused'
  // The community runs a suite agents cannot: what Join says of it.
  if (code.endsWith(':unsupportedSuite')) return 'Join.Ways.PrivateVetting'
  return 'Vetting.Hidden.ErrorGeneric'
}

/**
 * A challenge that has lapsed, or nearly, when the proof comes back. The
 * agent does not check it (it only binds it into the proof); the community
 * does, so the screen goes by the time it was given, with a little margin.
 */
export const CHALLENGE_MARGIN_MS = 5000
const lapsed = (expiresAt: string | undefined, now: number) =>
  Boolean(expiresAt) && Date.parse(expiresAt as string) - now < CHALLENGE_MARGIN_MS

/**
 * The community did not count the proof (`vetting:hidden:no-proof`): where a
 * challenge that lapsed on the way lands. Worth one fresh challenge and proof.
 */
const noProof = (answer: unknown) => {
  try {
    return JSON.stringify(answer ?? '').includes('vetting:hidden:no-proof')
  } catch {
    return false
  }
}

/** The community's answer, in words (the same effects as a named application). */
export function verdictKey(verdict: HiddenVettingVerdict): string {
  switch (verdict.effect) {
    case 'allow':
      return 'Vetting.Hidden.Admitted'
    case 'deny':
      return 'Vetting.Hidden.TurnedDown'
    case 'requestMore':
      return 'Vetting.Hidden.AsksMore'
    default:
      return 'Vetting.Hidden.Sent'
  }
}

/** The threshold the community set for this way in: its vetting's `minStatements`. */
export const neededFor = (criterion: VtiCriterion | undefined): number =>
  typeof criterion?.vetting?.minStatements === 'number' ? criterion.vetting.minStatements : 1

const VtiHiddenVetting: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { agent } = useAgent()
  const navigation = useNavigation()
  const {
    communityDid,
    criterionId,
    ticket: handedTicket,
  } = (useRoute().params ?? {}) as { communityDid: string; criterionId: string; ticket?: string }
  const seam = hiddenVettingSeam()
  const community = communityLabelOf(communityDid, t)
  const named = { community, interpolation: { escapeValue: false } }

  const [criterion, setCriterion] = useState<VtiCriterion>()
  const [record, setRecord] = useState<HiddenVettingRecord>()
  const [loaded, setLoaded] = useState(false)
  const [progress, setProgress] = useState<HiddenVettingProgress>()
  // A ticket handed over by the named screen starts in the field, so the
  // person does not paste the same ticket a second time.
  const [ticket, setTicket] = useState(handedTicket ?? '')
  const [asked, setAsked] = useState(false)
  const [busy, setBusy] = useState<string>()
  const [step, setStep] = useState<SendStep>()
  const [error, setError] = useState<string>()
  const [verdict, setVerdict] = useState<HiddenVettingVerdict>()

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 20, gap: 16 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    input: {
      minHeight: 44,
      borderWidth: 1,
      borderRadius: 4,
      borderColor: ColorPalette.grayscale.mediumGrey,
      color: ColorPalette.grayscale.white,
      padding: 8,
    },
  })

  const needed = neededFor(criterion)

  const refresh = useCallback(
    async (kept: HiddenVettingRecord) => {
      if (!agent || !seam) return
      setProgress(await seam.progress(agent, kept, needed))
    },
    [agent, seam, needed]
  )

  // The way in, and an application the agent already holds for it.
  useEffect(() => {
    if (!agent || !seam || !communityDid) return
    let live = true
    void (async () => {
      try {
        const manifest = await vtiAgent.fetchManifest(communityDid)
        const found = manifest.criteria.find((c) => c.id === criterionId)
        const kept = await seam.record(agent, communityDid)
        if (!live) return
        setCriterion(found)
        setRecord(kept)
        if (kept) setProgress(await seam.progress(agent, kept, neededFor(found)))
      } catch (e) {
        if (live) setError(t(hiddenVettingErrorKey(pcsErrorCode(e)), named))
      } finally {
        if (live) setLoaded(true)
      }
    })()
    return () => {
      live = false
    }
    // Read once per community and way in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, seam, communityDid, criterionId])

  const run = async (name: string, work: () => Promise<void>) => {
    setBusy(name)
    setError(undefined)
    try {
      await work()
    } catch (e) {
      setError(t(hiddenVettingErrorKey(pcsErrorCode(e)), named))
    } finally {
      setBusy(undefined)
      setStep(undefined)
    }
  }

  if (!seam) {
    // A build without hidden vetting: fails closed, as Join does (#405).
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.content} testID={testIdWithKey(HiddenVettingIds.notAvailable)}>
          <ThemedText>{t('Join.Ways.PrivateVetting', named)}</ThemedText>
        </View>
      </SafeAreaView>
    )
  }

  const start = () =>
    run('start', async () => {
      if (!agent || !criterion) throw new Error('no way in to apply under')
      const created = await seam.createApplication(agent, communityDid, criterion)
      setRecord(created)
      await refresh(created)
    })

  const askVetter = () =>
    run('ask', async () => {
      if (!agent || !record) return
      await seam.requestVetting(agent, record, { link: ticket.trim() })
      setTicket('')
      setAsked(true)
      await refresh(record)
    })

  const send = () =>
    run('send', async () => {
      if (!agent || !record || !criterion) return
      // A challenge is single-use and lapses; a proof is bound to one. Each try
      // is a fresh challenge and a fresh proof, never a proof sent again.
      const proveFresh = async () => {
        for (let attempt = 0; ; attempt++) {
          setStep('challenge')
          const { challenge, expiresAt } = await seam.fetchChallenge(agent, record, criterion)
          setStep('prove')
          const proof = await seam.prove(agent, record, criterion, challenge)
          // The proof took long enough for the challenge to lapse: once more.
          if (attempt === 0 && lapsed(expiresAt, Date.now())) continue
          return proof
        }
      }
      const sendOnce = async () => {
        const proof = await proveFresh()
        setStep('submit')
        return seam.submitJoin(agent, record, criterion, proof)
      }
      let answer: HiddenVettingVerdict
      try {
        answer = await sendOnce()
        if (noProof(answer)) answer = await sendOnce()
      } catch (e) {
        if (!noProof(e) && !noProof(pcsErrorCode(e))) throw e
        answer = await sendOnce()
      }
      setVerdict(answer)
      // Decided either way: the application's keys and attestations leave the agent.
      if (answer.effect === 'allow' || answer.effect === 'deny') {
        await seam.deleteApplication(agent, record).catch(() => undefined)
        setRecord(undefined)
      }
    })

  const startAgain = () =>
    run('again', async () => {
      if (!agent || !record) return
      await seam.deleteApplication(agent, record).catch(() => undefined)
      setRecord(undefined)
      setProgress(undefined)
    })

  const gone = error === t('Vetting.Hidden.ApplicationGone', named)
  const enough = (progress?.verified ?? 0) >= needed
  // The proof is bound to the way in as it was when the application was made:
  // a community that has changed it since cannot count this one.
  const changed = Boolean(
    record?.requirementsDigest &&
      criterion?.requirementsDigest &&
      record.requirementsDigest !== criterion.requirementsDigest
  )

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} testID={testIdWithKey(HiddenVettingIds.screen)}>
        <ThemedText variant="headingThree" accessibilityRole="header">
          {t('Vetting.Hidden.Title', named)}
        </ThemedText>
        <ThemedText style={styles.muted}>{t('Vetting.Hidden.Explain', named)}</ThemedText>

        {!loaded ? <ActivityIndicator color={ColorPalette.brand.primary} /> : null}

        {verdict ? (
          <View style={styles.card} testID={testIdWithKey(HiddenVettingIds.result)}>
            <ThemedText variant="bold">{t(verdictKey(verdict), named)}</ThemedText>
            {verdict.effect === 'allow' ? (
              <Button
                title={t('Vetting.Hidden.ToYourAgent')}
                buttonType={ButtonType.Primary}
                onPress={() => (navigation as unknown as { navigate: (s: string) => void }).navigate(Screens.VtaAgent)}
                testID={testIdWithKey('HiddenVettingToAgent')}
              />
            ) : null}
          </View>
        ) : null}

        {loaded && !record && !verdict ? (
          <Button
            title={t('Vetting.Hidden.Start')}
            buttonType={ButtonType.Primary}
            disabled={Boolean(busy) || !criterion}
            onPress={start}
            testID={testIdWithKey(HiddenVettingIds.start)}
          />
        ) : null}

        {record && changed && !verdict ? (
          <View style={styles.card} testID={testIdWithKey(HiddenVettingIds.changed)}>
            <ThemedText>{t('Vetting.Hidden.Changed', named)}</ThemedText>
            <Button
              title={t('Vetting.Hidden.StartAgain')}
              buttonType={ButtonType.Primary}
              disabled={Boolean(busy)}
              onPress={startAgain}
              testID={testIdWithKey(HiddenVettingIds.startAgain)}
            />
          </View>
        ) : null}

        {record && progress && !verdict && !changed ? (
          <>
            <View style={styles.card} testID={testIdWithKey(HiddenVettingIds.progress)}>
              <ThemedText variant="bold">
                {t('Vetting.Hidden.Progress', { verified: progress.verified, needed: progress.needed })}
              </ThemedText>
              <ThemedText style={styles.muted}>{t('Vetting.Hidden.NoNames', named)}</ThemedText>
              {(progress.attestations ?? []).map((a, i) => (
                <ThemedText
                  key={`${a.tokenLabel ?? ''}-${a.validFrom ?? i}`}
                  style={styles.muted}
                  testID={testIdWithKey(`${HiddenVettingIds.attestation}_${i}`)}
                >
                  {a.validFrom
                    ? t('Vetting.Hidden.AttestationOn', { date: localDate(a.validFrom) })
                    : t('Vetting.Hidden.Attestation')}
                </ThemedText>
              ))}
            </View>

            <View style={styles.card}>
              <ThemedText variant="bold">{t('Vetting.Hidden.AskTitle')}</ThemedText>
              <ThemedText style={styles.muted}>{t('Vetting.Hidden.AskHint', named)}</ThemedText>
              <TextInput
                style={styles.input}
                value={ticket}
                onChangeText={setTicket}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t('Vetting.Hidden.TicketPlaceholder')}
                accessibilityLabel={t('Vetting.Hidden.TicketPlaceholder')}
                testID={testIdWithKey(HiddenVettingIds.ticketInput)}
              />
              <Button
                title={t('Vetting.Hidden.AskVetter')}
                buttonType={ButtonType.Secondary}
                disabled={Boolean(busy) || !ticket.trim()}
                onPress={askVetter}
                testID={testIdWithKey(HiddenVettingIds.askVetter)}
              />
              {asked ? (
                <ThemedText testID={testIdWithKey(HiddenVettingIds.asked)}>{t('Vetting.Hidden.Asked')}</ThemedText>
              ) : null}
            </View>

            {!enough ? (
              <ThemedText style={styles.muted} testID={testIdWithKey(HiddenVettingIds.needMore)}>
                {t('Vetting.Hidden.NeedMore', { count: needed - progress.verified })}
              </ThemedText>
            ) : null}
            <Button
              title={t('Vetting.Hidden.Send')}
              buttonType={enough ? ButtonType.Primary : ButtonType.Secondary}
              disabled={Boolean(busy)}
              onPress={send}
              testID={testIdWithKey(HiddenVettingIds.send)}
            />
            {/* Walking away leaves keys and attestations on the agent: stopping takes them off. */}
            <Button
              title={t('Vetting.Hidden.Withdraw')}
              buttonType={ButtonType.Tertiary}
              disabled={Boolean(busy)}
              onPress={startAgain}
              testID={testIdWithKey(HiddenVettingIds.withdraw)}
            />
          </>
        ) : null}

        {step ? (
          <View style={styles.row} testID={testIdWithKey(HiddenVettingIds.step)}>
            <ActivityIndicator color={ColorPalette.brand.primary} />
            <ThemedText style={{ flex: 1 }}>
              {t(
                step === 'challenge'
                  ? 'Vetting.Hidden.StepChallenge'
                  : step === 'prove'
                    ? 'Vetting.Hidden.StepProve'
                    : 'Vetting.Hidden.StepSubmit',
                named
              )}
            </ThemedText>
          </View>
        ) : null}

        {error ? (
          <View style={styles.card}>
            <ThemedText testID={testIdWithKey(HiddenVettingIds.error)}>{error}</ThemedText>
            {gone && record ? (
              <Button
                title={t('Vetting.Hidden.StartAgain')}
                buttonType={ButtonType.Secondary}
                disabled={Boolean(busy)}
                onPress={startAgain}
                testID={testIdWithKey(HiddenVettingIds.startAgain)}
              />
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

export default VtiHiddenVetting
