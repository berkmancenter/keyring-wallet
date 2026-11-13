/**
 * "Who approves": the people who approve for this person on their agent (trusted-approver plan §4 step 3), and the
 * people this person approves for.
 *
 * A contact who said yes to an offer (approverRole.ts) waits here until the person adds them: adding writes the one
 * trusted set and its rules on the agent (`vtaAgent.setTrustedApprovers`, Face ID first). Removing one is the same
 * write without them; the agent may hold that for the approvers' yes, as it holds any rule change they cover.
 * Approvers are named from the relationships this phone asked over; one added some other way is said to be someone
 * not in the contacts.
 *
 * Reached from My agent only while the trusted-approvers switch is on, and guarded here too: navigation restore, a
 * later entry point, or the remote off (TRUSTED_APPROVERS_REMOTE_OFF) must not leave a working screen behind. Read again
 * on each focus, so a switch-off while it is open takes effect the next time it shows.
 *
 * @module trust-tasks/screens/VtaTrustedApprovers
 */
import { useAgent } from '@bifold/react-hooks'
import { useFocusEffect } from '@react-navigation/native'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import {
  acceptedRoleOffers,
  approverNames,
  steppedDownApprovers,
  approverRemoved,
  approverRoleEvents,
  approvingFor,
  closeRoleOffer,
  nextTrustedRules,
  stepDownAsApprover,
  withoutApprover,
  type RoleOfferAsk,
  type RoleOfferPrompt,
} from '../approverRole'
import {
  approverCardStandings,
  cardConsents,
  cardToShare,
  guardianCardEvents,
  guardianDemoStates,
  guardianSourceKey,
  shareGuardianCard,
  type CardConsent,
  type GuardianStanding,
  type SocialStanding,
} from '../guardianEvidence'
import { releaseWarn } from '../module/releaseLog'
import { isStateVerifiedApproversEnabled } from '../module/stateVerifiedApproversFlag'
import { isTrustedApproversEnabled } from '../module/trustedApproversFlag'
import { vtaAgent, type TrustedApproversState } from '../module/vtaAgent'

import { localClock, localDate } from './localTime'
import { deviceErrorWords } from './VtaDevices'
import ApproverWaitNote from './ApproverWaitNote'
import { DemoPill } from '../components/DemoPill'
import { demoStateHost } from '../../sedi/webs/demoStateHost'

import { StateOfficeEntry } from '../../sedi/identity/StateOfficeCodes'

import { Mark, StatusPill, Zone } from './approver/ApproverZones'
import { EnforcementCheckCard } from './approver/EnforcementCheckCard'

export const TrustedApproversIds = {
  screen: 'TrustedApprovers',
  off: 'TrustedApproversOff',
  error: 'TrustedApproversError',
  none: 'TrustedApproversNone',
  approver: (did: string) => `TrustedApprover_${did}`,
  remove: (did: string) => `TrustedApproverRemove_${did}`,
  accepted: (connectionId: string) => `TrustedApproverAccepted_${connectionId}`,
  add: (connectionId: string) => `TrustedApproverAdd_${connectionId}`,
  notNow: (connectionId: string) => `TrustedApproverNotNow_${connectionId}`,
  approvingFor: 'TrustedApproversApprovingFor',
  steppedDown: (did: string) => `TrustedApproverSteppedDown_${did}`,
  stepDown: (connectionId: string) => `TrustedApproverStepDown_${connectionId}`,
  stepDownConfirm: (connectionId: string) => `TrustedApproverStepDownConfirm_${connectionId}`,
  stepDownCancel: (connectionId: string) => `TrustedApproverStepDownCancel_${connectionId}`,
  stepDownError: 'TrustedApproverStepDownError',
  guardianVerified: (did: string) => `TrustedApproverGuardianVerified_${did}`,
  guardianDemo: (did: string) => `TrustedApproverGuardianDemo_${did}`,
  guardianUnverified: (did: string) => `TrustedApproverGuardianUnverified_${did}`,
  guardianRevokedIssuer: (did: string) => `TrustedApproverGuardianRevokedIssuer_${did}`,
  guardianRevokedState: (did: string) => `TrustedApproverGuardianRevokedState_${did}`,
  guardianRevoked: (did: string) => `TrustedApproverGuardianRevoked_${did}`,
  guardianOutcome: (did: string) => `TrustedApproverGuardianOutcome_${did}`,
  guardianUnreachable: (did: string) => `TrustedApproverGuardianUnreachable_${did}`,
  guardianFetchedLive: (did: string) => `TrustedApproverGuardianFetchedLive_${did}`,
  guardianDemoCopy: (did: string) => `TrustedApproverGuardianDemoCopy_${did}`,
  cardStatus: (connectionId: string) => `TrustedApproverCardStatus_${connectionId}`,
  cardSend: (connectionId: string) => `TrustedApproverCardSend_${connectionId}`,
  cardStop: (connectionId: string) => `TrustedApproverCardStop_${connectionId}`,
  // The at-a-glance layout (B, 11-12): the header pill, the three boxes, and the state's "Check again".
  pill: (did: string) => `TrustedApproverPill_${did}`,
  checkedBox: (did: string) => `TrustedApproverChecked_${did}`,
  stateBox: (did: string) => `TrustedApproverStateBox_${did}`,
  needsBox: (did: string) => `TrustedApproverNeeds_${did}`,
  mark: (did: string) => `TrustedApproverMark_${did}`,
  noCard: (did: string) => `TrustedApproverNoCard_${did}`,
  checkAgain: (did: string) => `TrustedApproverCheckAgain_${did}`,
  guardianHostWithheld: (did: string) => `TrustedApproverGuardianHostWithheld_${did}`,
  checkHostAgain: (did: string) => `TrustedApproverCheckHostAgain_${did}`,
  triedAgain: (did: string) => `TrustedApproverTriedAgain_${did}`,
  // The Social Authorization (S2) the approver sent with the card: its mark, and its lines.
  socialMark: (did: string) => `TrustedApproverSocialMark_${did}`,
  socialAuthorized: (did: string) => `TrustedApproverSocialAuthorized_${did}`,
  socialFromPhone: (did: string) => `TrustedApproverSocialFromPhone_${did}`,
  socialRefused: (did: string) => `TrustedApproverSocialRefused_${did}`,
} as const

/** A card the check found revoked, in any of its three ways (its own revocation, the issuer's or the state's record). */
const REVOKED = ['revoked', 'revokedInIssuerRecord', 'revokedInStateRecord']
const isRevoked = (standing: GuardianStanding | undefined) =>
  standing?.kind === 'unverified' && REVOKED.includes(standing.outcome)

const VtaTrustedApprovers: React.FC = () => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const [state, setState] = useState<TrustedApproversState | undefined>()
  const [accepted, setAccepted] = useState<RoleOfferAsk[]>([])
  /** Approvers who said they stepped down, by the DID they had said yes as. */
  const [steppedDown, setSteppedDown] = useState<string[]>([])
  /** The "People I approve for" card whose Step down is being confirmed. */
  const [confirming, setConfirming] = useState<string | undefined>()
  const [stepDownError, setStepDownError] = useState<string | undefined>()
  const [names, setNames] = useState<Record<string, string>>({})
  /** Each approver's state Guardian card, checked again on this open (guardianEvidence.ts); none, no line. */
  const [standings, setStandings] = useState<Record<string, GuardianStanding>>({})
  const [socials, setSocials] = useState<Record<string, SocialStanding>>({})
  /** For an approver whose card names a demo root on this phone's list: that root's name (the state's box). */
  const [demoStates, setDemoStates] = useState<Record<string, string>>({})
  const [mine, setMine] = useState<RoleOfferPrompt[]>([])
  /** On an approver's phone: the card it could share (none, no card lines) and its answer for each person. */
  const [shareable, setShareable] = useState<{ state?: string; k1?: true } | undefined>()
  const [consents, setConsents] = useState<Record<string, CardConsent>>({})
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState<string | undefined>()
  const [on, setOn] = useState(isTrustedApproversEnabled)
  /** Who was just added: the screen then offers the check (never runs it). */
  const [justAdded, setJustAdded] = useState<string | undefined>()
  /** When "Check again" last ran on this open, so a state still unreachable says it was tried again, and when. */
  const [triedAgainAt, setTriedAgainAt] = useState<string | undefined>()

  const wordsFor = useCallback((e: unknown) => deviceErrorWords(e, t), [t])

  /** What this phone keeps (yeses, names, people I approve for): read without the agent. */
  const loadKept = useCallback(async () => {
    if (!agent) return
    const [yeses, known, approving] = await Promise.all([
      acceptedRoleOffers(agent),
      approverNames(agent),
      approvingFor(agent),
    ]).catch(() => [[], {}, []] as [RoleOfferAsk[], Record<string, string>, RoleOfferPrompt[]])
    // Read on its own: a note that cannot be read must not blank the lists above.
    const stepped = await steppedDownApprovers(agent).catch(() => [] as string[])
    // Also on its own. A card whose check fails is "couldn't verify" inside guardianStandings; this catch is for the
    // records not being readable at all, which shows no line, so it never claims a card is valid.
    // The card and its authorization from ONE check, so the two can never disagree about whether the card stands.
    const both = await approverCardStandings(agent).catch(
      () =>
        ({ cards: {}, social: {} }) as {
          cards: Record<string, GuardianStanding>
          social: Record<string, SocialStanding>
        }
    )
    // Unreadable reads as none: no state box, so a card is never drawn as a demo state's without the list saying so.
    const demos = await guardianDemoStates(agent).catch(() => ({}) as Record<string, string>)
    // Unreadable answers read as none given, which sends nothing.
    const share = await cardToShare(agent).catch(() => undefined)
    const answers = await cardConsents(agent).catch(() => ({}) as Record<string, CardConsent>)
    setAccepted(yeses)
    setShareable(share)
    setConsents(answers)
    setSteppedDown(stepped)
    setStandings(both.cards)
    setSocials(both.social)
    setDemoStates(demos)
    setNames(known)
    setMine(approving)
  }, [agent])

  const load = useCallback(
    async (options: { keepError?: boolean } = {}) => {
      if (!agent) return
      if (!options.keepError) setError(undefined)
      await loadKept()
      try {
        setState(await vtaAgent.trustedApprovers(agent))
      } catch (e) {
        setError(wordsFor(e))
      }
    },
    [agent, loadKept, wordsFor]
  )

  useFocusEffect(
    useCallback(() => {
      const now = isTrustedApproversEnabled()
      setOn(now)
      // Switched off: nothing is read or written, and the agent is not asked.
      if (now) void load()
    }, [load])
  )

  useEffect(() => {
    const refresh = () => void loadKept()
    approverRoleEvents.on('answered', refresh)
    approverRoleEvents.on('promptCleared', refresh)
    guardianCardEvents.on('question', refresh)
    return () => {
      approverRoleEvents.off('answered', refresh)
      approverRoleEvents.off('promptCleared', refresh)
      guardianCardEvents.off('question', refresh)
    }
  }, [loadKept])

  const write = async (key: string, rules: { approvers: string[]; keys: TrustedApproversState['view']['keys'] }) => {
    if (!agent) return undefined
    setError(undefined)
    setBusy(key)
    try {
      const next = await vtaAgent.setTrustedApprovers(agent, rules.approvers, rules.keys)
      setState(next)
      return next
    } catch (e) {
      releaseWarn(`[VTI] who approves: not changed (${(e as Error)?.name ?? 'error'}: ${(e as Error)?.message ?? e})`)
      setError(wordsFor(e))
      await load({ keepError: true })
      return undefined
    } finally {
      setBusy(undefined)
    }
  }

  const onAdd = async (ask: RoleOfferAsk) => {
    if (!agent || !state) return
    const written = await write(ask.connectionId, nextTrustedRules(state.view, ask))
    if (!written || !ask.acceptedAs || !written.view.approvers.includes(ask.acceptedAs)) return
    await closeRoleOffer(agent, ask.connectionId, true).catch(() => undefined)
    setJustAdded(names[ask.acceptedAs] ?? t('Approver.UnnamedContact'))
    await loadKept()
  }

  /**
   * "Check again" on a state that couldn't be reached (B5): every kept card is checked again now, as on an open. What
   * shows is whatever that check says: still unreachable (with the time of this try), or a verified card whose line
   * names where it was fetched from and, for our own earlier live result reused, when (guardianSourceKey). A copy on
   * this phone is never shown as a fresh check: an unreachable root is never checked against the card's copy.
   */
  const onCheckAgain = async () => {
    if (!agent) return
    setBusy('checkAgain')
    try {
      const both = await approverCardStandings(agent).catch(
        () =>
          ({ cards: {}, social: {} }) as {
            cards: Record<string, GuardianStanding>
            social: Record<string, SocialStanding>
          }
      )
      setStandings(both.cards)
      setSocials(both.social)
      setDemoStates(await guardianDemoStates(agent).catch(() => ({}) as Record<string, string>))
      setTriedAgainAt(new Date().toISOString())
    } finally {
      setBusy(undefined)
    }
  }

  const onNotNow = async (ask: RoleOfferAsk) => {
    if (!agent) return
    await closeRoleOffer(agent, ask.connectionId, false).catch(() => undefined)
    await loadKept()
  }

  const onStepDown = async (prompt: RoleOfferPrompt) => {
    if (!agent) return
    setStepDownError(undefined)
    setBusy(prompt.connectionId)
    try {
      await stepDownAsApprover(agent, prompt.connectionId)
      setConfirming(undefined)
      await loadKept()
    } catch (e) {
      releaseWarn(`[VTI] step down not sent (${(e as Error)?.name ?? 'error'}: ${(e as Error)?.message ?? e})`)
      setStepDownError(
        t('Approver.StepDownFailed', {
          asker: prompt.asker || t('Approver.UnnamedContact'),
          interpolation: { escapeValue: false },
        })
      )
    } finally {
      setBusy(undefined)
    }
  }

  /** Send my Guardian card to this person from now on (and now), or stop: the answer is kept either way. */
  const onShare = async (prompt: RoleOfferPrompt, send: boolean) => {
    if (!agent) return
    setStepDownError(undefined)
    setBusy(prompt.connectionId)
    try {
      await shareGuardianCard(agent, prompt.connectionId, send)
    } catch (e) {
      releaseWarn(
        `[VTI] guardian card answer not kept (${(e as Error)?.name ?? 'error'}: ${(e as Error)?.message ?? e})`
      )
    } finally {
      setBusy(undefined)
      await loadKept()
    }
  }

  const onRemove = async (did: string) => {
    if (!agent || !state) return
    const written = await write(did, withoutApprover(state.view, did))
    if (!written || written.view.approvers.includes(did)) return
    await approverRemoved(agent, did).catch(() => undefined)
  }

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 20, gap: 16 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 10 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    name: { flexShrink: 1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    error: { color: ColorPalette.semantic.error },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })

  const view = state?.view
  const actionList = (keys: readonly string[]) => keys.map((key) => t(`Approver.Action.${key}`)).join(', ')
  const nameOf = (did: string) => names[did] ?? t('Approver.Unnamed')
  /** The standing shown for an approver: none with the state-verified switch off, or for one with no card. */
  const standingFor = (did: string | undefined) =>
    did && isStateVerifiedApproversEnabled() ? standings[did] : undefined

  /**
   * The header pill beside an approver's name, in the state card's own words (B3): Checks out, Couldn't reach,
   * Revoked or Couldn't verify; "No state card" for an approver who sent none (a choice, never a failed check). None
   * with the state-verified switch off. Never a Demo pill: that belongs to the state's box.
   */
  const pillFor = (did: string | undefined) => {
    if (!did || !isStateVerifiedApproversEnabled()) return null
    const standing = standings[did]
    const [tone, words] = !standing
      ? (['quiet', t('Approver.PillNoCard')] as const)
      : standing.kind === 'verified'
        ? (['ok', t('Approver.PillChecksOut')] as const)
        : standing.kind === 'unreachable'
          ? (['unknown', t('StateCard.PillNotReached')] as const)
          : isRevoked(standing)
            ? (['bad', t('StateCard.PillRevoked')] as const)
            : (['bad', t('StateCard.PillCouldNotVerify')] as const)
    return <StatusPill tone={tone} words={words} testID={TrustedApproversIds.pill(did)} />
  }

  /** Where a verified card was checked from: fetched live (and when, for a reused result), or the demo copy. */
  const sourceLine = (did: string, standing: Extract<GuardianStanding, { kind: 'verified' }>) =>
    standing.fetchedFrom ? (
      <ThemedText style={styles.muted} testID={testIdWithKey(TrustedApproversIds.guardianFetchedLive(did))}>
        {/* Which line: guardianSourceKey decides (root and issuers live, or the root only), with the "at <time>"
            variant for our own earlier live result reused because the host just failed, never "just now". */}
        {t(guardianSourceKey(standing) ?? 'Approver.GuardianFetchedLive', {
          host: standing.fetchedFrom,
          // For "the host <name>'s card names" (K1 'fromCard'); the other lines do not use it.
          name: nameOf(did),
          ...(standing.fetchedAt ? { time: localClock(standing.fetchedAt) } : {}),
          interpolation: { escapeValue: false },
        })}
      </ThemedText>
    ) : standing.hostWithheld ? (
      // The host the card came with was not fetched, because the state does not name it (or that could not be read):
      // checked against the card's own copy, said so. "Check again" only for a failure to read that can pass; never
      // when the state said no, and never when the check was switched off (ac, #1059).
      <View style={{ gap: 4 }}>
        <ThemedText style={styles.muted} testID={testIdWithKey(TrustedApproversIds.guardianHostWithheld(did))}>
          {t(
            standing.hostWithheld.result === 'unreachable'
              ? 'Approver.GuardianHostUnchecked'
              : 'Approver.GuardianHostNotNamed',
            {
              host: standing.hostWithheld.host,
              interpolation: { escapeValue: false },
            }
          )}
        </ThemedText>
        {standing.hostWithheld.retryable ? (
          <Button
            title={t('Approver.CheckAgain')}
            buttonType={ButtonType.Tertiary}
            onPress={() => void onCheckAgain()}
            disabled={busy !== undefined}
            testID={testIdWithKey(TrustedApproversIds.checkHostAgain(did))}
          />
        ) : null}
      </View>
    ) : standing.demo ? (
      <ThemedText style={styles.muted} testID={testIdWithKey(TrustedApproversIds.guardianDemoCopy(did))}>
        {t('Approver.GuardianDemoCopy')}
      </ThemedText>
    ) : null

  /**
   * Under a verified card: the approver's Social Authorization, or what is not checked yet. `authorized` (it checks
   * out under this card, on this same check) is the only case that says the card is tied to their phone: the card's
   * holder signed it, and it came over this relationship. Refused for its own reason: said so, beside the open ring.
   * Refused because of the card under it, or none sent: the open ring alone, as before (the card's own line says why).
   */
  const socialLine = (did: string, name: string) => {
    const social = socials[did]
    const named = { name, interpolation: { escapeValue: false } }
    if (social?.kind === 'authorized')
      return (
        <Mark kind="pass" testID={TrustedApproversIds.socialMark(did)}>
          <ThemedText testID={testIdWithKey(TrustedApproversIds.socialAuthorized(did))}>
            {t('Approver.SocialAuthorized', { name, state: social.state, interpolation: { escapeValue: false } })}
          </ThemedText>
          <ThemedText style={styles.muted} testID={testIdWithKey(TrustedApproversIds.socialFromPhone(did))}>
            {t('Approver.SocialSignedFromPhone', named)}
          </ThemedText>
        </Mark>
      )
    return (
      <>
        <Mark kind="gap">
          <ThemedText style={styles.muted}>{t('Approver.GuardianAsShown', named)}</ThemedText>
        </Mark>
        {social?.kind === 'refused' && !social.underCard ? (
          <Mark kind="fail" testID={TrustedApproversIds.socialMark(did)}>
            <ThemedText testID={testIdWithKey(TrustedApproversIds.socialRefused(did))}>
              {t('Approver.SocialNotAuthorized', named)}
            </ThemedText>
            <ThemedText style={styles.muted}>
              {t('Approver.GuardianOutcome', { outcome: social.outcome, interpolation: { escapeValue: false } })}
            </ThemedText>
          </Mark>
        ) : null}
      </>
    )
  }

  /**
   * Box 1, "What Keyring checked", for an approver with a card (none with the state-verified switch off; an approver
   * with no card gets one plain line instead). Each line keeps the testID it always had:
   * - verified: a tick for the card, and an open ring for what isn't checked yet (that it is their phone's);
   * - a root whose did:webs could not be reached on this open: "Couldn't reach the state", never "Couldn't verify"
   *   (the card was not checked) and never verified (nothing falls back to the card's own copy), with "Check again";
   * - revoked, in its own words (the card's own revocation, or the issuer's or state's published record);
   * - otherwise "Couldn't verify", with the outcome.
   * For a demo root, where it was checked from goes in the state's box (box 2); otherwise here.
   */
  const checkedBox = (did: string | undefined, name: string) => {
    if (!did || !isStateVerifiedApproversEnabled()) return null
    const standing = standings[did]
    const named = { name, interpolation: { escapeValue: false } }
    if (!standing)
      return (
        <ThemedText style={styles.muted} testID={testIdWithKey(TrustedApproversIds.noCard(did))}>
          {t('Approver.NoCardNote', named)}
        </ThemedText>
      )
    const mark = TrustedApproversIds.mark(did)
    return (
      <Zone kind="checked" title={t('Approver.CheckedTitle')} testID={TrustedApproversIds.checkedBox(did)}>
        {standing.kind === 'verified' ? (
          <>
            <Mark kind="pass" testID={mark}>
              <View style={styles.row}>
                <ThemedText testID={testIdWithKey(TrustedApproversIds.guardianVerified(did))}>
                  {t('Approver.GuardianHas', { state: standing.state, interpolation: { escapeValue: false } })}
                </ThemedText>
              </View>
              {standing.demo ? null : sourceLine(did, standing)}
            </Mark>
            {socialLine(did, name)}
          </>
        ) : standing.kind === 'unreachable' ? (
          <Mark kind="warn" testID={mark}>
            <ThemedText testID={testIdWithKey(TrustedApproversIds.guardianUnreachable(did))}>
              {t('Approver.GuardianStateUnreachable')}
            </ThemedText>
            <ThemedText style={styles.muted}>
              {t('Approver.GuardianStateUnreachableHint', {
                state: standing.state,
                interpolation: { escapeValue: false },
              })}
            </ThemedText>
            {triedAgainAt ? (
              <ThemedText style={styles.muted} testID={testIdWithKey(TrustedApproversIds.triedAgain(did))}>
                {t('Approver.TriedAgainAt', { time: localClock(triedAgainAt) })}
              </ThemedText>
            ) : null}
            <Button
              title={t('Approver.CheckAgain')}
              buttonType={ButtonType.Secondary}
              onPress={() => void onCheckAgain()}
              disabled={busy !== undefined}
              testID={testIdWithKey(TrustedApproversIds.checkAgain(did))}
            >
              {busy === 'checkAgain' ? <ActivityIndicator color={ColorPalette.brand.primary} /> : undefined}
            </Button>
          </Mark>
        ) : isRevoked(standing) ? (
          <Mark kind="fail" testID={mark}>
            {standing.outcome === 'revokedInStateRecord' ? (
              <ThemedText testID={testIdWithKey(TrustedApproversIds.guardianRevokedState(did))}>
                {t('Approver.GuardianRevokedState')}
              </ThemedText>
            ) : standing.outcome === 'revokedInIssuerRecord' ? (
              <ThemedText testID={testIdWithKey(TrustedApproversIds.guardianRevokedIssuer(did))}>
                {t('Approver.GuardianRevokedIssuer')}
              </ThemedText>
            ) : (
              <ThemedText testID={testIdWithKey(TrustedApproversIds.guardianRevoked(did))}>
                {t('Approver.GuardianRevoked')}
              </ThemedText>
            )}
            <ThemedText style={styles.muted}>{t('Approver.RevokedMeans')}</ThemedText>
          </Mark>
        ) : (
          <Mark kind="fail" testID={mark}>
            <ThemedText testID={testIdWithKey(TrustedApproversIds.guardianUnverified(did))}>
              {t('Approver.GuardianCouldNotVerify')}
            </ThemedText>
            <ThemedText style={styles.muted} testID={testIdWithKey(TrustedApproversIds.guardianOutcome(did))}>
              {t('Approver.GuardianOutcome', { outcome: standing.outcome, interpolation: { escapeValue: false } })}
            </ThemedText>
          </Mark>
        )}
      </Zone>
    )
  }

  /**
   * Box 2, the demo state's own box: only for a root this phone's list marks demo (stateRoots.ts `demo`: on a
   * verified standing, or for any other standing from guardianDemoStates; never read from the card or the name). Titled with the state's name and the Demo pill (its testID
   * as before), saying it is a test state and, for a verified card, where it was checked from (the tunnel's host when
   * fetched live, or the copy on this phone). Unreachable: names the Demo state host this phone fetches from.
   */
  const stateBox = (did: string | undefined) => {
    const standing = standingFor(did)
    if (!did || !standing) return null
    // Verified: the check's own `demo` (from the root list). Unreachable (the card is ours, only the live fetch failed)
    // or revoked (it checked up to the revocation): the root list's entry the card names. Any other refusal (a bad
    // signature, the wrong ward, an untrusted root): no box, since the root it names is only the card's own unchecked
    // claim, and a state's name must never sit beside a forged card as if it vouched for it (SEDI lane, 11-12).
    const state =
      standing.kind === 'verified'
        ? standing.demo
          ? standing.state
          : undefined
        : standing.kind === 'unreachable' || isRevoked(standing)
          ? demoStates[did]
          : undefined
    if (!state) return null
    const host = demoStateHost()
    return (
      <Zone
        kind="state"
        title={state}
        beside={<DemoPill testID={TrustedApproversIds.guardianDemo(did)} />}
        testID={TrustedApproversIds.stateBox(did)}
      >
        <ThemedText style={styles.muted}>
          {standing.kind === 'unreachable'
            ? host
              ? t('Approver.DemoStateUnreachableHost', { state, host, interpolation: { escapeValue: false } })
              : t('Approver.DemoStateIs', { state, interpolation: { escapeValue: false } })
            : standing.kind === 'unverified' && isRevoked(standing)
              ? t('Approver.DemoStateRevoked', { state, interpolation: { escapeValue: false } })
              : t('Approver.DemoStateIs', { state, interpolation: { escapeValue: false } })}
        </ThemedText>
        {standing.kind === 'verified' ? sourceLine(did, standing) : null}
      </Zone>
    )
  }

  /** Box 3: what the agent won't do without this person's yes (or would not, once they are added). */
  const needsBox = (did: string, name: string, keys: readonly string[], opts: { added: boolean }) => (
    <Zone
      kind="needs"
      title={t(opts.added ? 'Approver.NeedsTitle' : 'Approver.NeedsTitleOnceAdded', {
        name,
        interpolation: { escapeValue: false },
      })}
      testID={TrustedApproversIds.needsBox(did)}
    >
      {opts.added && isRevoked(standingFor(did)) ? (
        <ThemedText style={styles.muted}>
          {t('Approver.RevokedStillWaits', { name, interpolation: { escapeValue: false } })}
        </ThemedText>
      ) : null}
      {keys.map((key) => (
        <ThemedText key={key}>{`\u00B7 ${t(`Approver.Action.${key}`)}`}</ThemedText>
      ))}
    </Zone>
  )

  /**
   * On an approver's phone, for one person: whether this phone's Guardian card goes to them, and the button to change
   * it. Only with a card held and both switches on (read again at render). Never answered reads as not sent.
   */
  const cardLine = (prompt: RoleOfferPrompt, asker: { asker: string; interpolation: { escapeValue: boolean } }) => {
    if (!shareable || !isStateVerifiedApproversEnabled()) return null
    const goes = consents[prompt.connectionId] === 'yes'
    return (
      <View>
        <ThemedText style={styles.muted} testID={testIdWithKey(TrustedApproversIds.cardStatus(prompt.connectionId))}>
          {/* A K1 card goes as guardian-evidence/0.2: a phone on an older build will not show it, and nothing tells
              this phone either way, so the line says what is known and claims no receipt. */}
          {t(goes ? (shareable.k1 ? 'Approver.CardSentToK1' : 'Approver.CardSentTo') : 'Approver.CardNotSentTo', asker)}
        </ThemedText>
        {goes ? <ThemedText style={styles.muted}>{t('Approver.CardStopNote', asker)}</ThemedText> : null}
        <Button
          title={goes ? t('Approver.CardStop') : t('Approver.CardSendTo', asker)}
          buttonType={ButtonType.Tertiary}
          onPress={() => void onShare(prompt, !goes)}
          disabled={busy !== undefined}
          testID={testIdWithKey(
            goes ? TrustedApproversIds.cardStop(prompt.connectionId) : TrustedApproversIds.cardSend(prompt.connectionId)
          )}
        />
      </View>
    )
  }
  const waiting = accepted.filter((ask) => !view?.approvers.includes(ask.acceptedAs as string))

  if (!on || !isTrustedApproversEnabled())
    return (
      <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
        <View style={styles.content}>
          <ThemedText testID={testIdWithKey(TrustedApproversIds.off)}>{t('Approver.SwitchedOff')}</ThemedText>
        </View>
      </SafeAreaView>
    )

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} testID={testIdWithKey(TrustedApproversIds.screen)}>
        {/* A held task waits here as anywhere: who it waits on (off with the trusted-approvers switch). */}
        <ApproverWaitNote />
        <ThemedText>{t('Approver.Intro')}</ThemedText>
        {error ? (
          <ThemedText style={styles.error} testID={testIdWithKey(TrustedApproversIds.error)}>
            {error}
          </ThemedText>
        ) : null}

        {waiting.map((ask) => {
          const name = names[ask.acceptedAs as string] ?? t('Approver.UnnamedContact')
          return (
            <View
              key={ask.connectionId}
              style={styles.card}
              testID={testIdWithKey(TrustedApproversIds.accepted(ask.connectionId))}
            >
              <View style={styles.header}>
                <ThemedText variant="bold" style={styles.name}>
                  {name}
                </ThemedText>
                {pillFor(ask.acceptedAs)}
              </View>
              <ThemedText style={styles.muted}>{t('Approver.Accepted')}</ThemedText>
              {checkedBox(ask.acceptedAs, name)}
              {stateBox(ask.acceptedAs)}
              {needsBox(ask.acceptedAs ?? ask.connectionId, name, ask.actions, { added: false })}
              <Button
                title={t('Approver.Add', { name, interpolation: { escapeValue: false } })}
                buttonType={ButtonType.Primary}
                onPress={() => void onAdd(ask)}
                disabled={!view || busy !== undefined}
                testID={testIdWithKey(TrustedApproversIds.add(ask.connectionId))}
              >
                {busy === ask.connectionId ? <ActivityIndicator color={ColorPalette.brand.primary} /> : undefined}
              </Button>
              <Button
                title={t('Approver.NotNow')}
                buttonType={ButtonType.Tertiary}
                onPress={() => void onNotNow(ask)}
                disabled={busy !== undefined}
                testID={testIdWithKey(TrustedApproversIds.notNow(ask.connectionId))}
              />
            </View>
          )
        })}

        <ThemedText variant="bold" accessibilityRole="header">
          {t('Approver.Approvers')}
        </ThemedText>
        {!view && !error ? (
          <View style={styles.row}>
            <ActivityIndicator color={ColorPalette.brand.primary} />
            <ThemedText style={styles.muted}>{t('Approver.Loading')}</ThemedText>
          </View>
        ) : null}
        {view && view.approvers.length === 0 ? (
          <ThemedText testID={testIdWithKey(TrustedApproversIds.none)}>{t('Approver.None')}</ThemedText>
        ) : null}
        {view?.approvers.map((did) => (
          <View key={did} style={styles.card} testID={testIdWithKey(TrustedApproversIds.approver(did))}>
            <View style={styles.header}>
              <ThemedText variant="bold" style={styles.name}>
                {nameOf(did)}
              </ThemedText>
              {pillFor(did)}
            </View>
            {checkedBox(did, nameOf(did))}
            {stateBox(did)}
            {steppedDown.includes(did) ? (
              <ThemedText testID={testIdWithKey(TrustedApproversIds.steppedDown(did))}>
                {t('Approver.SteppedDownRemove', { name: nameOf(did), interpolation: { escapeValue: false } })}
              </ThemedText>
            ) : null}
            {needsBox(did, nameOf(did), view.keys, { added: true })}
            <Button
              title={t('Approver.Remove', { name: nameOf(did), interpolation: { escapeValue: false } })}
              // A revoked card leaves the agent waiting for them until removed (B6): Remove turns solid red.
              buttonType={isRevoked(standingFor(did)) ? ButtonType.Critical : ButtonType.Secondary}
              onPress={() => void onRemove(did)}
              disabled={busy !== undefined}
              testID={testIdWithKey(TrustedApproversIds.remove(did))}
            >
              {busy === did ? <ActivityIndicator color={ColorPalette.brand.primary} /> : undefined}
            </Button>
          </View>
        ))}
        {view && view.approvers.length > 0 ? (
          <ThemedText style={styles.muted}>{t('Approver.RemoveNeedsYes')}</ThemedText>
        ) : null}
        {/* The practice request, one shared card (Developer › Demos shows it too). Here only once there is someone to
            approve; it holds this screen's buttons while it runs, and waits while they write. */}
        {view && view.approvers.length > 0 ? (
          <EnforcementCheckCard
            justAdded={justAdded}
            hostBusy={busy !== undefined && busy !== 'check'}
            onBusy={(running) => setBusy(running ? 'check' : undefined)}
          />
        ) : null}
        {view?.heldElsewhere.length ? (
          <ThemedText style={styles.muted}>
            {t('Approver.HeldElsewhere', { actions: actionList(view.heldElsewhere) })}
          </ThemedText>
        ) : null}

        <ThemedText variant="bold" accessibilityRole="header">
          {t('Approver.IApproveFor')}
        </ThemedText>
        <View testID={testIdWithKey(TrustedApproversIds.approvingFor)} style={{ gap: 8 }}>
          {mine.length === 0 ? (
            <ThemedText style={styles.muted}>{t('Approver.IApproveForNone')}</ThemedText>
          ) : (
            <ThemedText style={styles.muted}>{t('Approver.IApproveForIntro')}</ThemedText>
          )}
          {stepDownError ? (
            <ThemedText style={styles.error} testID={testIdWithKey(TrustedApproversIds.stepDownError)}>
              {stepDownError}
            </ThemedText>
          ) : null}
          {mine.map((prompt) => {
            const asker = { asker: prompt.asker || t('Approver.UnnamedContact'), interpolation: { escapeValue: false } }
            return (
              <View key={prompt.connectionId} style={styles.card}>
                <ThemedText variant="bold">{asker.asker}</ThemedText>
                <ThemedText style={styles.muted}>
                  {t('Approver.IApproveForSince', { date: localDate(prompt.receivedAt) })}
                </ThemedText>
                <ThemedText style={styles.muted}>{t('Approver.YouApprove')}</ThemedText>
                <ThemedText>{actionList(prompt.actions)}</ThemedText>
                {cardLine(prompt, asker)}
                {confirming === prompt.connectionId ? (
                  <>
                    <ThemedText variant="bold">{t('Approver.StepDownConfirmTitle', asker)}</ThemedText>
                    <ThemedText>{t('Approver.StepDownConfirmBody', asker)}</ThemedText>
                    <Button
                      title={t('Approver.StepDown')}
                      buttonType={ButtonType.Secondary}
                      onPress={() => void onStepDown(prompt)}
                      disabled={busy !== undefined}
                      testID={testIdWithKey(TrustedApproversIds.stepDownConfirm(prompt.connectionId))}
                    >
                      {busy === prompt.connectionId ? (
                        <ActivityIndicator color={ColorPalette.brand.primary} />
                      ) : undefined}
                    </Button>
                    <Button
                      title={t('Global.Cancel')}
                      buttonType={ButtonType.Tertiary}
                      onPress={() => setConfirming(undefined)}
                      disabled={busy !== undefined}
                      testID={testIdWithKey(TrustedApproversIds.stepDownCancel(prompt.connectionId))}
                    />
                  </>
                ) : (
                  <Button
                    title={t('Approver.StepDown')}
                    buttonType={ButtonType.Tertiary}
                    onPress={() => {
                      setStepDownError(undefined)
                      setConfirming(prompt.connectionId)
                    }}
                    disabled={busy !== undefined}
                    testID={testIdWithKey(TrustedApproversIds.stepDown(prompt.connectionId))}
                  />
                )}
              </View>
            )
          })}
        </View>
        {/* This phone's codes for a state office (K1): draws nothing unless the SEDI switches are on and an office is
            on this build; the screen it opens checks the same again. */}
        <StateOfficeEntry />
      </ScrollView>
    </SafeAreaView>
  )
}

export default VtaTrustedApprovers
