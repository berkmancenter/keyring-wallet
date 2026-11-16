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
 * Design B (Alberto, 11-14): the list is one row per person (name, one line, a pill); a row opens that person's page,
 * which is this same screen under a second route (Screens.VtaApproverPerson, with { kind, id }) showing their detail and
 * what can be done. An action that ends the matter there (added, set aside, forgotten, removed, stepped down) goes back.
 *
 * @module trust-tasks/screens/VtaTrustedApprovers
 */
import { useAgent } from '@bifold/react-hooks'
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native'
import type { StackNavigationProp } from '@react-navigation/stack'
import { EventEmitter } from 'events'
import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialIcons'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens, type MyAgentStackParams } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import {
  acceptedRoleOffers,
  approverNames,
  steppedDownApprovers,
  approverRemovedAndTold,
  approverRoleEvents,
  closeRoleOffer,
  isStopAsked,
  listeningFor,
  setAsideRoleOffer,
  setAsideRoleOffers,
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
  guardianTestStates,
  guardianSourceKey,
  shareGuardianCard,
  type CardConsent,
  type GuardianStanding,
  type SocialStanding,
} from '../guardianEvidence'
import { releaseWarn } from '../module/releaseLog'
import { isStateVerifiedApproversEnabled } from '../module/stateVerifiedApproversFlag'
import { trustedKeyOf } from '../module/trustedApprovers'
import { isTrustedApproversEnabled } from '../module/trustedApproversFlag'
import { vtaAgent, type TrustedApproversState } from '../module/vtaAgent'

import { localClock, localDate } from './localTime'
import { deviceErrorWords } from './VtaDevices'
import ApproverWaitNote from './ApproverWaitNote'
import { DemoPill } from '../components/DemoPill'
import { demoStateHost } from '../../sedi/webs/demoStateHost'

import { StateOfficeEntry } from '../../sedi/identity/StateOfficeCodes'

import { Mark, StatusPill, Zone } from './approver/ApproverZones'
import { EnforcementCheckIds } from './approver/EnforcementCheckCard'
import { guardianReasonKeys } from './approver/guardianReasonWords'

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
  // "Set aside (n)" (Alberto, 278.19; cf's D2): the yeses "Not now" kept, each still addable or forgotten.
  setAside: 'TrustedApproversSetAside',
  setAsideOpen: 'TrustedApproversSetAsideOpen',
  setAsideRow: (connectionId: string) => `TrustedApproverSetAside_${connectionId}`,
  setAsideAdd: (connectionId: string) => `TrustedApproverSetAsideAdd_${connectionId}`,
  setAsideForget: (connectionId: string) => `TrustedApproverSetAsideForget_${connectionId}`,
  // Two tabs (Alberto's design B-lite, 11-14): my approvers, and the people I approve for. And "More".
  tabMine: 'TrustedApproversTabMine',
  tabTheirs: 'TrustedApproversTabTheirs',
  more: 'TrustedApproversMore',
  approvingFor: 'TrustedApproversApprovingFor',
  // Design B (11-14): a row per person on the list, and the person's own page.
  row: (kind: string, id: string) => `TrustedApproverRow_${kind}_${id}`,
  saidYes: (connectionId: string) => `TrustedApproverSaidYes_${connectionId}`,
  person: 'TrustedApproverPerson',
  personGone: 'TrustedApproverPersonGone',
  approvingPerson: (connectionId: string) => `TrustedApproverApproving_${connectionId}`,
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
  // Row E (Alberto, 11-16): a person's page in sections. The state card shows one line until Details opens the checks;
  // a held request shows on each approver it waits on (their row and their page), with its code.
  details: (did: string) => `TrustedApproverDetails_${did}`,
  guardianWhat: (did: string) => `TrustedApproverGuardianWhat_${did}`,
  waiting: (did: string) => `TrustedApproverWaiting_${did}`,
  waitCode: (did: string) => `TrustedApproverWaitCode_${did}`,
  rowWaiting: (did: string) => `TrustedApproverRowWaiting_${did}`,
  steppedDownPill: (did: string) => `TrustedApproverSteppedDownPill_${did}`,
  // 7d's step-down fix (#1081): a step-down asks to be removed; until the asker removes this phone, it says so.
  stopAsked: (connectionId: string) => `TrustedApproverStopAsked_${connectionId}`,
} as const

/** Up to two initials for a person's round mark: the first letter of their first two words. */
export const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase()

/** A card the check found revoked, in any of its three ways (its own revocation, the issuer's or the state's record). */
const REVOKED = ['revoked', 'revokedInIssuerRecord', 'revokedInStateRecord']
const isRevoked = (standing: GuardianStanding | undefined) =>
  standing?.kind === 'unverified' && REVOKED.includes(standing.outcome)

type PersonParams = MyAgentStackParams[Screens.VtaApproverPerson]
type PersonKind = PersonParams['kind']

/**
 * Who was just added, from a person's page to the list under it: each route is its own mount, and the list says where
 * the practice request is. Nothing is kept: with no list mounted, nobody hears it.
 */
const whoApprovesEvents = new EventEmitter()

const VtaTrustedApprovers: React.FC = () => {
  const { t } = useTranslation()
  const navigation = useNavigation<StackNavigationProp<MyAgentStackParams>>()
  // Opened on one person (Screens.VtaApproverPerson), or the list (Screens.VtaTrustedApprovers, no params).
  const params = useRoute()?.params as Partial<PersonParams> | undefined
  const person: PersonParams | undefined = params?.kind && params.id ? { kind: params.kind, id: params.id } : undefined
  const onPersonPage = person !== undefined
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const [state, setState] = useState<TrustedApproversState | undefined>()
  const [accepted, setAccepted] = useState<RoleOfferAsk[]>([])
  /** The yeses set aside with "Not now", and whether their section is open. */
  const [aside, setAside] = useState<RoleOfferAsk[]>([])
  const [asideOpen, setAsideOpen] = useState(false)
  /** Which tab shows: my approvers (first), or the people I approve for. */
  const [tab, setTab] = useState<'mine' | 'theirs'>('mine')
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
  /** Those whose root the list marks `test` (the K0 preload): the box shows "Test" and the test words. */
  const [testStates, setTestStates] = useState<Record<string, true>>({})
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
  /** Whether what this phone keeps has been read once: until then a person's page loads, never "nothing to show". */
  const [keptRead, setKeptRead] = useState(false)
  /** On a person's page: whether the state card's full checks show (Details), or its one line. */
  const [detailsOpen, setDetailsOpen] = useState(false)
  /** A task the agent holds for consent, and its code: shown on each approver it waits on. */
  const held = useSyncExternalStore(vtaAgent.subscribe, () => vtaAgent.getState().awaitingConsentFor)
  const heldCode = useSyncExternalStore(vtaAgent.subscribe, () => vtaAgent.getState().awaitingConsentCode)

  const wordsFor = useCallback((e: unknown) => deviceErrorWords(e, t), [t])

  /** What this phone keeps (yeses, names, people I approve for): read without the agent. */
  const loadKept = useCallback(async () => {
    if (!agent) return
    const [yeses, known, approving] = await Promise.all([
      acceptedRoleOffers(agent),
      approverNames(agent),
      // Stop-asked people stay listed: their agent still waits for this phone until they remove it.
      listeningFor(agent),
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
    // Unreadable reads as none: a demo box then says "Demo", never "Test" for a root the list did not mark.
    const tests = await guardianTestStates(agent).catch(() => ({}) as Record<string, true>)
    // Unreadable answers read as none given, which sends nothing.
    const share = await cardToShare(agent).catch(() => undefined)
    const answers = await cardConsents(agent).catch(() => ({}) as Record<string, CardConsent>)
    // Unreadable reads as none set aside: the section is not drawn, and nothing is lost (the records stay).
    const setAsideYeses = await setAsideRoleOffers(agent).catch(() => [] as RoleOfferAsk[])
    setAccepted(yeses)
    setAside(setAsideYeses)
    setShareable(share)
    setConsents(answers)
    setSteppedDown(stepped)
    setStandings(both.cards)
    setSocials(both.social)
    setDemoStates(demos)
    setTestStates(tests)
    setNames(known)
    setMine(approving)
    setKeptRead(true)
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
    const added = (name: string) => setJustAdded(name)
    whoApprovesEvents.on('added', added)
    return () => {
      whoApprovesEvents.off('added', added)
    }
  }, [])

  /**
   * Off a person's page, once what was done there is done: back to the list, which reads everything again on focus.
   * Only while the page is still the one showing: one already left (back pressed during Face ID) pops nothing else.
   */
  const leave = () => {
    if (onPersonPage && navigation.isFocused()) navigation.goBack()
  }

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
    // The set as the agent holds it NOW, not as this screen loaded it: the write replaces the whole set, and a set-aside
    // yes is added later by design, so a snapshot could put back an approver removed meanwhile. What remains is the
    // window of the Face ID prompt inside setTrustedApprovers (its version check comes after it), a known gap.
    let fresh: TrustedApproversState
    try {
      fresh = await vtaAgent.trustedApprovers(agent)
    } catch (e) {
      setError(wordsFor(e))
      return
    }
    setState(fresh)
    const written = await write(ask.connectionId, nextTrustedRules(fresh.view, ask))
    if (!written || !ask.acceptedAs || !written.view.approvers.includes(ask.acceptedAs)) return
    await closeRoleOffer(agent, ask.connectionId, true).catch(() => undefined)
    // Heard here and by the list under this page (whoApprovesEvents), which says where the practice request is.
    whoApprovesEvents.emit('added', names[ask.acceptedAs] ?? t('Approver.UnnamedContact'))
    await loadKept()
    leave()
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
      setTestStates(await guardianTestStates(agent).catch(() => ({}) as Record<string, true>))
      setTriedAgainAt(new Date().toISOString())
    } finally {
      setBusy(undefined)
    }
  }

  // "Not now" sets the yes aside (kept, still addable, or forgotten later), never closes it (Alberto, 278.19).
  const onNotNow = async (ask: RoleOfferAsk) => {
    if (!agent) return
    await setAsideRoleOffer(agent, ask.connectionId).catch(() => undefined)
    await loadKept()
    leave()
  }

  /** "Forget" on a set-aside yes: closed, not written. To add them later, they are asked again. */
  const onForget = async (ask: RoleOfferAsk) => {
    if (!agent) return
    await closeRoleOffer(agent, ask.connectionId, false).catch(() => undefined)
    await loadKept()
    leave()
  }

  const onStepDown = async (prompt: RoleOfferPrompt) => {
    if (!agent) return
    setStepDownError(undefined)
    setBusy(prompt.connectionId)
    try {
      await stepDownAsApprover(agent, prompt.connectionId)
      setConfirming(undefined)
      await loadKept()
      leave()
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
    await approverRemovedAndTold(agent, did).catch(() => undefined)
    leave()
  }

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 20, gap: 16 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    name: { flexShrink: 1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    error: { color: ColorPalette.semantic.error },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    aside: {
      borderRadius: 8,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: ColorPalette.grayscale.lightGrey,
      padding: 12,
      gap: 10,
    },
    asideHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
    tabs: {
      flexDirection: 'row',
      backgroundColor: ColorPalette.brand.secondaryBackground,
      borderRadius: 10,
      padding: 4,
      gap: 4,
    },
    tab: {
      flex: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      paddingHorizontal: 6,
    },
    tabOn: { backgroundColor: ColorPalette.brand.primary },
    tabOnText: { color: ColorPalette.grayscale.white },
    more: { gap: 10, marginTop: 8 },
    personRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 64,
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    personRowText: { flex: 1, gap: 2 },
    pageRoot: { gap: 16 },
    page: { gap: 12 },
    bar: { gap: 10, marginTop: 8 },
    // Row E (Alberto, 11-16): a person reads as one card, in sections, with far less text.
    personCard: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 12, overflow: 'hidden' },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: ColorPalette.brand.primary,
    },
    avatarBig: { width: 64, height: 64, borderRadius: 32 },
    avatarText: { color: ColorPalette.grayscale.white, fontSize: 16, lineHeight: 20 },
    avatarTextBig: { fontSize: 24, lineHeight: 30 },
    pageHead: { alignItems: 'center', gap: 6, paddingTop: 4 },
    pills: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' },
    center: { textAlign: 'center' },
    section: { gap: 6 },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    sectionLabel: { fontSize: 14, fontWeight: '700', color: ColorPalette.grayscale.mediumGrey },
    sectionCard: {
      backgroundColor: ColorPalette.brand.secondaryBackground,
      borderRadius: 12,
      padding: 14,
      gap: 10,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    chipText: { fontSize: 15 },
    linkRow: { minHeight: 44, justifyContent: 'center' },
    link: { color: ColorPalette.brand.primary, fontWeight: '700' },
    spread: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    code: { fontFamily: 'Menlo', letterSpacing: 2 },
    rowWait: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: ColorPalette.grayscale.lightGrey,
    },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
    track: {
      width: 52,
      height: 32,
      borderRadius: 16,
      padding: 3,
      backgroundColor: ColorPalette.grayscale.lightGrey,
    },
    trackOn: { backgroundColor: ColorPalette.brand.primary },
    thumb: { width: 26, height: 26, borderRadius: 13, backgroundColor: ColorPalette.grayscale.white },
    thumbOn: { alignSelf: 'flex-end' },
    trackLocked: { opacity: 0.5 },
    pillStart: { alignSelf: 'flex-start' },
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
        {t(standing.test ? 'Approver.GuardianTestCopy' : 'Approver.GuardianDemoCopy')}
      </ThemedText>
    ) : null

  /**
   * Under a verified card: the approver's Social Authorization, or what is not checked yet. `authorized` (it checks
   * out under this card, on this same check) is the only case that says the card is tied to their phone: the card's
   * holder signed it, and it came over this relationship. Refused for its own reason: said so, beside the open ring.
   * Refused because of the card under it, or none sent: the open ring alone, as before (the card's own line says why).
   */
  /** Why a card or authorization didn't check out, in plain words, and what to do: never the reason code itself. */
  const reasonWords = (outcome: string, name: string) => {
    const keys = guardianReasonKeys(outcome)
    const named = { name, interpolation: { escapeValue: false } }
    return `${t(keys.what, named)} ${t(keys.todo, named)}`
  }

  /** A revoked card's line, in its own way of being revoked (its own revocation, the issuer's or the state's record). */
  const revokedLine = (did: string, standing: GuardianStanding) =>
    standing.kind === 'unverified' && standing.outcome === 'revokedInStateRecord' ? (
      <ThemedText testID={testIdWithKey(TrustedApproversIds.guardianRevokedState(did))}>
        {t('Approver.GuardianRevokedState')}
      </ThemedText>
    ) : standing.kind === 'unverified' && standing.outcome === 'revokedInIssuerRecord' ? (
      <ThemedText testID={testIdWithKey(TrustedApproversIds.guardianRevokedIssuer(did))}>
        {t('Approver.GuardianRevokedIssuer')}
      </ThemedText>
    ) : (
      <ThemedText testID={testIdWithKey(TrustedApproversIds.guardianRevoked(did))}>
        {t('Approver.GuardianRevoked')}
      </ThemedText>
    )

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
            <ThemedText style={styles.muted}>{reasonWords(social.outcome, name)}</ThemedText>
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
   * - otherwise "Couldn't verify", with why in plain words and what to do (guardianReasonWords), never the code.
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
            {revokedLine(did, standing)}
            <ThemedText style={styles.muted}>{t('Approver.RevokedMeans')}</ThemedText>
          </Mark>
        ) : (
          <Mark kind="fail" testID={mark}>
            <ThemedText testID={testIdWithKey(TrustedApproversIds.guardianUnverified(did))}>
              {t('Approver.GuardianCouldNotVerify')}
            </ThemedText>
            <ThemedText style={styles.muted} testID={testIdWithKey(TrustedApproversIds.guardianOutcome(did))}>
              {reasonWords(standing.outcome, name)}
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
  const demoStateOf = (did: string | undefined): { state: string; test: boolean } | undefined => {
    const standing = standingFor(did)
    if (!did || !standing) return undefined
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
    if (!state) return undefined
    // The test mark, as the state itself was read: a verified standing's own, else the list entry the card names.
    return { state, test: standing.kind === 'verified' ? standing.test === true : testStates[did] === true }
  }

  const stateBox = (did: string | undefined) => {
    const standing = standingFor(did)
    const demo = demoStateOf(did)
    if (!did || !standing || !demo) return null
    const { state, test } = demo
    const words = test
      ? {
          is: 'Approver.TestStateIs',
          unreachable: 'Approver.TestStateUnreachableHost',
          revoked: 'Approver.TestStateRevoked',
        }
      : {
          is: 'Approver.DemoStateIs',
          unreachable: 'Approver.DemoStateUnreachableHost',
          revoked: 'Approver.DemoStateRevoked',
        }
    const host = demoStateHost()
    return (
      <Zone
        kind="state"
        title={state}
        beside={<DemoPill testID={TrustedApproversIds.guardianDemo(did)} test={test} />}
        testID={TrustedApproversIds.stateBox(did)}
      >
        <ThemedText style={styles.muted}>
          {standing.kind === 'unreachable'
            ? host
              ? t(words.unreachable, { state, host, interpolation: { escapeValue: false } })
              : t(words.is, { state, interpolation: { escapeValue: false } })
            : standing.kind === 'unverified' && isRevoked(standing)
              ? t(words.revoked, { state, interpolation: { escapeValue: false } })
              : t(words.is, { state, interpolation: { escapeValue: false } })}
        </ThemedText>
        {standing.kind === 'verified' ? sourceLine(did, standing) : null}
      </Zone>
    )
  }

  /** A person's round mark: their initials, never read out (their name is beside it). */
  const avatar = (name: string, big = false) => (
    <View
      style={[styles.avatar, big && styles.avatarBig]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <ThemedText variant="bold" style={[styles.avatarText, big && styles.avatarTextBig]}>
        {initialsOf(name)}
      </ThemedText>
    </View>
  )

  /** One labelled section of a person's page (row E): a small heading, then its own card. */
  const section = (label: string, body: React.ReactNode, opts: { testID?: string; beside?: React.ReactNode } = {}) => (
    <View style={styles.section} testID={opts.testID}>
      <View style={styles.sectionHead}>
        <ThemedText style={styles.sectionLabel} accessibilityRole="header">
          {label}
        </ThemedText>
        {opts.beside}
      </View>
      <View style={styles.sectionCard}>{body}</View>
    </View>
  )

  /** What someone approves, as tags. */
  const actionChips = (keys: readonly string[]) => (
    <View style={styles.chips}>
      {keys.map((key) => (
        <View key={key} style={styles.chip}>
          <ThemedText style={styles.chipText}>{t(`Approver.Action.${key}`)}</ThemedText>
        </View>
      ))}
    </View>
  )

  /** What the agent won't do without this person's yes (or would not, once they are added): its own section. */
  const needsBox = (did: string, name: string, keys: readonly string[], opts: { added: boolean }) =>
    section(
      t(opts.added ? 'Approver.NeedsTitle' : 'Approver.NeedsTitleOnceAdded', {
        name,
        interpolation: { escapeValue: false },
      }),
      <>
        {opts.added && isRevoked(standingFor(did)) ? (
          <ThemedText style={styles.muted}>
            {t('Approver.RevokedStillWaits', { name, interpolation: { escapeValue: false } })}
          </ThemedText>
        ) : null}
        {actionChips(keys)}
      </>,
      { testID: testIdWithKey(TrustedApproversIds.needsBox(did)) }
    )

  /**
   * The state card's one line (row E), shown until Details opens the full checks (checkedBox and the state's box).
   * Each line keeps its testID, and the two are never on screen together, so a testID names one element. Check again
   * stays here: it is something to do, not something to read.
   */
  const cardSummary = (did: string, standing: GuardianStanding, name: string) => {
    const mark = TrustedApproversIds.mark(did)
    if (standing.kind === 'verified')
      return (
        <Mark kind="pass" testID={mark}>
          <ThemedText testID={testIdWithKey(TrustedApproversIds.guardianVerified(did))}>
            {t('Approver.GuardianHas', { state: standing.state, interpolation: { escapeValue: false } })}
          </ThemedText>
        </Mark>
      )
    if (standing.kind === 'unreachable')
      return (
        <Mark kind="warn" testID={mark}>
          <ThemedText testID={testIdWithKey(TrustedApproversIds.guardianUnreachable(did))}>
            {t('Approver.GuardianStateUnreachable')}
          </ThemedText>
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
      )
    if (isRevoked(standing))
      return (
        <Mark kind="fail" testID={mark}>
          {revokedLine(did, standing)}
        </Mark>
      )
    return (
      <Mark kind="fail" testID={mark}>
        <ThemedText testID={testIdWithKey(TrustedApproversIds.guardianUnverified(did))}>
          {t('Approver.GuardianCouldNotVerify')}
        </ThemedText>
        {standing.kind === 'unverified' ? (
          <ThemedText style={styles.muted} testID={testIdWithKey(TrustedApproversIds.guardianWhat(did))}>
            {t(guardianReasonKeys(standing.outcome).what, { name, interpolation: { escapeValue: false } })}
          </ThemedText>
        ) : null}
      </Mark>
    )
  }

  /**
   * The "State card" section (row E): one line and Details, which opens what Keyring checked and the demo state's
   * box. An approver with no card: the one plain line, nothing to open. None with the state-verified switch off.
   */
  const stateCardSection = (did: string | undefined, name: string) => {
    if (!did || !isStateVerifiedApproversEnabled()) return null
    const standing = standings[did]
    if (!standing) return section(t('Approver.SectionStateCard'), checkedBox(did, name))
    const demo = demoStateOf(did)
    const toggle = (
      <Pressable
        onPress={() => setDetailsOpen((open) => !open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: detailsOpen }}
        testID={testIdWithKey(TrustedApproversIds.details(did))}
        style={styles.linkRow}
      >
        <ThemedText style={styles.link}>{t(detailsOpen ? 'Approver.HideDetails' : 'Approver.Details')}</ThemedText>
      </Pressable>
    )
    return section(
      t('Approver.SectionStateCard'),
      detailsOpen ? (
        <>
          {checkedBox(did, name)}
          {stateBox(did)}
          {toggle}
        </>
      ) : (
        <>
          {cardSummary(did, standing, name)}
          {toggle}
        </>
      ),
      // Closed, the Demo pill sits by the heading, so a demo card never reads as a real state's.
      {
        beside:
          !detailsOpen && demo ? <DemoPill testID={TrustedApproversIds.guardianDemo(did)} test={demo.test} /> : null,
      }
    )
  }

  /** Whether the task the agent holds waits on this approver: they are on the set, and the set covers it. */
  const waitsOn = (did: string) => {
    const key = held ? trustedKeyOf(held) : undefined
    return !!key && !!view?.approvers.includes(did) && view.keys.includes(key)
  }

  /** On an approver's page, while a task waits on them: that it is held, its code, and that they may need to open. */
  const waitingSection = (did: string, name: string) => {
    if (!waitsOn(did)) return null
    const named = { name, names: name, interpolation: { escapeValue: false } }
    return section(
      t('Approver.SectionWaiting'),
      <>
        <View style={styles.spread}>
          <ThemedText variant="bold" style={{ flex: 1 }}>
            {t('Approver.PersonHolding', named)}
          </ThemedText>
          {heldCode ? (
            <ThemedText
              variant="bold"
              style={styles.code}
              selectable
              testID={testIdWithKey(TrustedApproversIds.waitCode(did))}
            >
              {heldCode}
            </ThemedText>
          ) : null}
        </View>
        {heldCode ? <ThemedText style={styles.muted}>{t('Approver.PersonWaitCode', named)}</ThemedText> : null}
        <ThemedText style={styles.muted}>{t('Approver.WaitMayNeedOpen', named)}</ThemedText>
      </>,
      { testID: testIdWithKey(TrustedApproversIds.waiting(did)) }
    )
  }

  /**
   * On an approver's phone, for one person: a switch for whether this phone's Guardian card goes to them (row E, so it
   * never reads like Step down). Only with a card held and both switches on (read again at render). Never answered
   * reads as off. The switch's testID says what a press does (send, or stop), as the button's did.
   */
  const cardSwitch = (
    prompt: RoleOfferPrompt,
    asker: { asker: string; interpolation: { escapeValue: boolean } },
    stopAsked = false
  ) => {
    if (!shareable || !isStateVerifiedApproversEnabled()) return null
    // Asked to stop (#1081): no card goes while the step-down waits, so the switch reads off and can't be turned on.
    const goes = !stopAsked && consents[prompt.connectionId] === 'yes'
    const locked = stopAsked || busy !== undefined
    return section(
      t('Approver.SectionYourCard'),
      <Pressable
        onPress={() => void onShare(prompt, !goes)}
        disabled={locked}
        accessibilityRole="switch"
        accessibilityState={{ checked: goes, disabled: locked }}
        accessibilityLabel={t('Approver.CardSwitch', asker)}
        testID={testIdWithKey(
          goes ? TrustedApproversIds.cardStop(prompt.connectionId) : TrustedApproversIds.cardSend(prompt.connectionId)
        )}
        style={styles.switchRow}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <ThemedText variant="bold">{t('Approver.CardSwitch', asker)}</ThemedText>
          <ThemedText style={styles.muted} testID={testIdWithKey(TrustedApproversIds.cardStatus(prompt.connectionId))}>
            {t(stopAsked ? 'Approver.CardStoppedNote' : 'Approver.CardSwitchNote', asker)}
          </ThemedText>
          {/* A K1 card goes as guardian-evidence/0.2: a phone on an older build will not show it, and nothing tells
              this phone either way, so the line says what is known and claims no receipt. */}
          {goes && shareable.k1 ? <ThemedText style={styles.muted}>{t('Approver.CardK1Note')}</ThemedText> : null}
        </View>
        <View style={[styles.track, goes && styles.trackOn, stopAsked && styles.trackLocked]}>
          <View style={[styles.thumb, goes && styles.thumbOn]} />
        </View>
      </Pressable>
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

  const errorLine = error ? (
    <ThemedText style={styles.error} testID={testIdWithKey(TrustedApproversIds.error)}>
      {error}
    </ThemedText>
  ) : null
  const stepDownErrorLine = stepDownError ? (
    <ThemedText style={styles.error} testID={testIdWithKey(TrustedApproversIds.stepDownError)}>
      {stepDownError}
    </ThemedText>
  ) : null
  // The practice request lives on Developer › Demos (B7 step 3); right after an add, this says where it is. It runs
  // nothing from here.
  const justAddedLine = justAdded ? (
    <ThemedText variant="bold" testID={testIdWithKey(EnforcementCheckIds.checkPrompt)}>
      {t('Approver.CheckAfterAdd', { name: justAdded, interpolation: { escapeValue: false } })}
    </ThemedText>
  ) : null
  const loadingLine = (
    <View style={styles.row}>
      <ActivityIndicator color={ColorPalette.brand.primary} />
      <ThemedText style={styles.muted}>{t('Approver.Loading')}</ThemedText>
    </View>
  )
  const askName = (ask: RoleOfferAsk) => names[ask.acceptedAs as string] ?? t('Approver.UnnamedContact')
  const askerOf = (prompt: RoleOfferPrompt) => ({
    asker: prompt.asker || t('Approver.UnnamedContact'),
    interpolation: { escapeValue: false },
  })

  /** One person on the list: their initials, name, one line, a pill, the way to their page, and a wait under it. */
  const personRow = (
    kind: PersonKind,
    rowId: string,
    name: string,
    sub: string,
    chip: React.ReactNode,
    below: React.ReactNode = null
  ) => (
    <View key={`${kind}_${rowId}`} style={styles.personCard}>
      <Pressable
        onPress={() => navigation.navigate(Screens.VtaApproverPerson, { kind, id: rowId })}
        accessibilityRole="button"
        accessibilityLabel={name}
        testID={testIdWithKey(TrustedApproversIds.row(kind, rowId))}
        style={styles.personRow}
      >
        {avatar(name)}
        <View style={styles.personRowText}>
          <ThemedText variant="bold">{name}</ThemedText>
          <ThemedText style={styles.muted}>{sub}</ThemedText>
        </View>
        {chip}
        <Icon name="chevron-right" size={24} color={ColorPalette.grayscale.mediumGrey} />
      </Pressable>
      {below}
    </View>
  )

  /** Under an approver's row while a task waits on them: one line and the code. */
  const rowWaiting = (did: string) =>
    waitsOn(did) ? (
      <View style={styles.rowWait} testID={testIdWithKey(TrustedApproversIds.rowWaiting(did))}>
        <Icon name="schedule" size={18} color={ColorPalette.grayscale.mediumGrey} />
        <ThemedText style={{ flex: 1 }}>
          {t('Approver.RowWaiting', { name: nameOf(did), interpolation: { escapeValue: false } })}
        </ThemedText>
        {heldCode ? (
          <ThemedText variant="bold" style={styles.code}>
            {heldCode}
          </ThemedText>
        ) : null}
      </View>
    ) : null

  /** A stepped-down approver's pill: in place of the card's on their row, beside it on their page. */
  const steppedDownPill = (did: string) => (
    <StatusPill tone="bad" words={t('Approver.PillSteppedDown')} testID={TrustedApproversIds.steppedDownPill(did)} />
  )

  /**
   * A person's page (row E): their initials, name and pills on top, one line under them, then the sections, each in
   * its own card, inside the person's own container. The container's testID comes keyed (testIdWithKey at each call),
   * so the testids scan sees each one used.
   */
  const personPage = (
    testID: string,
    name: string,
    pills: React.ReactNode,
    sub: React.ReactNode,
    children: React.ReactNode
  ) => (
    <View style={styles.page} testID={testID}>
      <View style={styles.pageHead}>
        {avatar(name, true)}
        <ThemedText variant="headingThree" style={styles.name} accessibilityRole="header">
          {name}
        </ThemedText>
        {pills ? <View style={styles.pills}>{pills}</View> : null}
        {sub}
      </View>
      {children}
    </View>
  )

  const approverPage = (did: string) => {
    const name = nameOf(did)
    const stepped = steppedDown.includes(did)
    return personPage(
      testIdWithKey(TrustedApproversIds.approver(did)),
      name,
      <>
        {pillFor(did)}
        {stepped ? steppedDownPill(did) : null}
      </>,
      null,
      <>
        {stateCardSection(did, name)}
        {view ? needsBox(did, name, view.keys, { added: true }) : null}
        {waitingSection(did, name)}
        <View style={styles.bar}>
          {stepped ? (
            <ThemedText testID={testIdWithKey(TrustedApproversIds.steppedDown(did))}>
              {t('Approver.SteppedDownRemove', { name, interpolation: { escapeValue: false } })}
            </ThemedText>
          ) : null}
          <Button
            title={t('Approver.Remove', { name, interpolation: { escapeValue: false } })}
            // A revoked card leaves the agent waiting for them until removed (B6), and so does a step-down: Remove
            // turns solid red.
            buttonType={stepped || isRevoked(standingFor(did)) ? ButtonType.Critical : ButtonType.Secondary}
            onPress={() => void onRemove(did)}
            disabled={busy !== undefined}
            testID={testIdWithKey(TrustedApproversIds.remove(did))}
          >
            {busy === did ? <ActivityIndicator color={ColorPalette.brand.primary} /> : undefined}
          </Button>
          <ThemedText style={styles.muted}>{t('Approver.RemoveNeedsYes')}</ThemedText>
        </View>
      </>
    )
  }

  /** A yes waiting to be added ('yes'), or one "Not now" set aside ('setAside'): what was checked, and Add. */
  const askPage = (kind: 'yes' | 'setAside', ask: RoleOfferAsk) => {
    const name = askName(ask)
    const words = { name, interpolation: { escapeValue: false } }
    const isAside = kind === 'setAside'
    return personPage(
      isAside
        ? testIdWithKey(TrustedApproversIds.setAsideRow(ask.connectionId))
        : testIdWithKey(TrustedApproversIds.accepted(ask.connectionId)),
      name,
      pillFor(ask.acceptedAs),
      <ThemedText style={[styles.muted, styles.center]}>
        {isAside ? t('Approver.SetAsideNote') : t('Approver.Accepted')}
      </ThemedText>,
      <>
        {stateCardSection(ask.acceptedAs, name)}
        {needsBox(ask.acceptedAs ?? ask.connectionId, name, ask.actions, { added: false })}
        <View style={styles.bar}>
          {isAside ? null : (
            <ThemedText style={styles.muted}>{t('Approver.PersonNothingUntilAdded', words)}</ThemedText>
          )}
          <Button
            title={t('Approver.Add', words)}
            buttonType={ButtonType.Primary}
            onPress={() => void onAdd(ask)}
            disabled={!view || busy !== undefined}
            testID={testIdWithKey(
              isAside ? TrustedApproversIds.setAsideAdd(ask.connectionId) : TrustedApproversIds.add(ask.connectionId)
            )}
          >
            {busy === ask.connectionId ? <ActivityIndicator color={ColorPalette.brand.primary} /> : undefined}
          </Button>
          {isAside ? (
            <>
              <Button
                title={t('Approver.Forget')}
                buttonType={ButtonType.Secondary}
                onPress={() => void onForget(ask)}
                disabled={busy !== undefined}
                testID={testIdWithKey(TrustedApproversIds.setAsideForget(ask.connectionId))}
              />
              <ThemedText style={styles.muted}>{t('Approver.ForgetNote', words)}</ThemedText>
            </>
          ) : (
            <Button
              title={t('Approver.NotNow')}
              buttonType={ButtonType.Tertiary}
              onPress={() => void onNotNow(ask)}
              disabled={busy !== undefined}
              testID={testIdWithKey(TrustedApproversIds.notNow(ask.connectionId))}
            />
          )}
        </View>
      </>
    )
  }

  /**
   * Someone this phone approves for (row E): what I approve as tags, my Guardian card as a switch in its own section,
   * and my role with Step down, a red button asked first. The card and the role never share a section, so stopping
   * the card never reads as stepping down.
   */
  const approvingPage = (prompt: RoleOfferPrompt) => {
    const asker = askerOf(prompt)
    const stopAsked = isStopAsked(prompt)
    return personPage(
      testIdWithKey(TrustedApproversIds.approvingPerson(prompt.connectionId)),
      asker.asker,
      null,
      <ThemedText style={[styles.muted, styles.center]}>
        {t('Approver.ApprovingSince', { ...asker, date: localDate(prompt.receivedAt) })}
      </ThemedText>,
      <>
        {section(t('Approver.SectionYouApprove'), actionChips(prompt.actions))}
        {cardSwitch(prompt, asker, stopAsked)}
        {section(
          t('Approver.SectionYourRole'),
          stopAsked ? (
            // Asked to stop (#1081): still their approver until they remove this phone; nothing to tap here.
            <>
              <View style={styles.pillStart}>
                <StatusPill
                  tone="unknown"
                  words={t('Approver.AskedToStop')}
                  testID={TrustedApproversIds.stopAsked(prompt.connectionId)}
                />
              </View>
              <ThemedText>{t('Approver.AskedToStopNote', asker)}</ThemedText>
            </>
          ) : (
            <>
              <ThemedText style={styles.muted}>{t('Approver.YourRoleNote', asker)}</ThemedText>
              {stepDownErrorLine}
              {confirming === prompt.connectionId ? (
                <>
                  <ThemedText variant="bold">{t('Approver.StepDownConfirmTitle', asker)}</ThemedText>
                  <ThemedText>{t('Approver.StepDownConfirmBody', asker)}</ThemedText>
                  <Button
                    title={t('Approver.StepDown')}
                    buttonType={ButtonType.Critical}
                    onPress={() => void onStepDown(prompt)}
                    disabled={busy !== undefined}
                    testID={testIdWithKey(TrustedApproversIds.stepDownConfirm(prompt.connectionId))}
                  >
                    {busy === prompt.connectionId ? (
                      <ActivityIndicator color={ColorPalette.grayscale.white} />
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
                  title={t('Approver.StepDownAs', asker)}
                  buttonType={ButtonType.Critical}
                  onPress={() => {
                    setStepDownError(undefined)
                    setConfirming(prompt.connectionId)
                  }}
                  disabled={busy !== undefined}
                  testID={testIdWithKey(TrustedApproversIds.stepDown(prompt.connectionId))}
                />
              )}
            </>
          )
        )}
      </>
    )
  }

  /**
   * What the person page shows, found again on each render from what is loaded: nothing found (removed, forgotten,
   * stepped down) says so. A yes or a set-aside yes whose approver is now on the agent (just added, here or
   * elsewhere) shows as that approver.
   */
  const personContent = (p: PersonParams) => {
    if (p.kind === 'approving') {
      const prompt = mine.find((m) => m.connectionId === p.id)
      if (prompt) return approvingPage(prompt)
      if (!keptRead) return loadingLine
    } else if (p.kind === 'approver') {
      if (view?.approvers.includes(p.id)) return approverPage(p.id)
      if (!view && !error) return loadingLine
    } else {
      const ask = (p.kind === 'yes' ? accepted : aside).find((a) => a.connectionId === p.id)
      if (ask?.acceptedAs && view?.approvers.includes(ask.acceptedAs)) return approverPage(ask.acceptedAs)
      if (ask) return askPage(p.kind, ask)
      if (!keptRead) return loadingLine
    }
    return (
      <ThemedText style={styles.muted} testID={testIdWithKey(TrustedApproversIds.personGone)}>
        {t('Approver.PersonGone')}
      </ThemedText>
    )
  }

  if (person)
    return (
      <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content} testID={testIdWithKey(TrustedApproversIds.screen)}>
          <View style={styles.pageRoot} testID={testIdWithKey(TrustedApproversIds.person)}>
            {errorLine}
            {personContent(person)}
            {justAddedLine}
          </View>
        </ScrollView>
      </SafeAreaView>
    )

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} testID={testIdWithKey(TrustedApproversIds.screen)}>
        {/* Two tabs (design B-lite, Alberto 11-14: "too much flat text, no separation"): each list on its own. */}
        <View style={styles.tabs} accessibilityRole="tablist">
          {(
            [
              ['mine', TrustedApproversIds.tabMine, t('Approver.TabMine', { count: view?.approvers.length ?? 0 })],
              ['theirs', TrustedApproversIds.tabTheirs, t('Approver.TabTheirs', { count: mine.length })],
            ] as const
          ).map(([key, testID, label]) => (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              accessibilityLabel={label}
              testID={testIdWithKey(testID)}
              style={[styles.tab, tab === key && styles.tabOn]}
            >
              <ThemedText variant={tab === key ? 'bold' : undefined} style={tab === key ? styles.tabOnText : undefined}>
                {label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        {errorLine}
        {tab === 'mine' ? (
          <>
            <ThemedText style={styles.muted}>{t('Approver.Intro')}</ThemedText>

            {/* Design B (11-14): one row per person; their detail and what can be done are on their own page. */}
            {waiting.map((ask) => {
              const name = askName(ask)
              return personRow(
                'yes',
                ask.connectionId,
                name,
                t('Approver.RowSaidYes', { name, interpolation: { escapeValue: false } }),
                <StatusPill
                  tone="unknown"
                  words={t('Approver.Accepted')}
                  testID={TrustedApproversIds.saidYes(ask.connectionId)}
                />
              )
            })}

            {!view && !error ? loadingLine : null}
            {view && view.approvers.length === 0 ? (
              <ThemedText testID={testIdWithKey(TrustedApproversIds.none)}>{t('Approver.None')}</ThemedText>
            ) : null}
            {view?.approvers.map((did) =>
              personRow(
                'approver',
                did,
                nameOf(did),
                steppedDown.includes(did)
                  ? t('Approver.RowSteppedDown', { name: nameOf(did), interpolation: { escapeValue: false } })
                  : t('Approver.RowApproves', { count: view.keys.length }),
                steppedDown.includes(did) ? steppedDownPill(did) : pillFor(did),
                rowWaiting(did)
              )
            )}
            {/* "Set aside (n)", at the end of My approvers (cf's D2): the yeses "Not now" kept. Closed, one row; open,
            a row per person, each opening their page (what was checked, what they would approve, Add and Forget).
            Nothing is sent to them. */}
            {aside.length > 0 ? (
              <View style={styles.aside} testID={testIdWithKey(TrustedApproversIds.setAside)}>
                <Pressable
                  onPress={() => setAsideOpen((open) => !open)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: asideOpen }}
                  accessibilityLabel={t('Approver.SetAsideTitle', { count: aside.length })}
                  testID={testIdWithKey(TrustedApproversIds.setAsideOpen)}
                  style={styles.asideHead}
                >
                  <View style={{ flex: 1 }}>
                    <ThemedText variant="bold">{t('Approver.SetAsideTitle', { count: aside.length })}</ThemedText>
                    <ThemedText style={styles.muted}>
                      {asideOpen ? t('Approver.SetAsideNote') : t('Approver.SetAsideSub')}
                    </ThemedText>
                  </View>
                  <Icon
                    name={asideOpen ? 'expand-less' : 'expand-more'}
                    size={24}
                    color={ColorPalette.grayscale.mediumGrey}
                  />
                </Pressable>
                {asideOpen
                  ? aside.map((ask) =>
                      personRow(
                        'setAside',
                        ask.connectionId,
                        askName(ask),
                        t('Approver.SetAsideSub'),
                        pillFor(ask.acceptedAs)
                      )
                    )
                  : null}
              </View>
            ) : null}
            <ThemedText style={styles.muted}>{t('Approver.RowAddHint')}</ThemedText>
            {justAddedLine}
            {view?.heldElsewhere.length ? (
              <ThemedText style={styles.muted}>
                {t('Approver.HeldElsewhere', { actions: actionList(view.heldElsewhere) })}
              </ThemedText>
            ) : null}
            {view && view.approvers.length > 0 ? (
              <ThemedText style={styles.muted}>{t('Approver.RemoveNeedsYes')}</ThemedText>
            ) : null}
            {/* More: the held-request note and this phone's codes for a state office, off the main list. */}
            <View style={styles.more} testID={testIdWithKey(TrustedApproversIds.more)}>
              <ThemedText variant="bold" accessibilityRole="header">
                {t('Approver.More')}
              </ThemedText>
              {/* A held task waits here as anywhere: who it waits on (off with the trusted-approvers switch). While a
              row above shows the wait and its code (row E), the note would say it twice; once it ends, the note says
              how (approved, or not given). */}
              {held && view?.approvers.some(waitsOn) ? null : <ApproverWaitNote />}
              {/* This phone's codes for a state office (K1): draws nothing unless the SEDI switches are on and an office is
              on this build; the screen it opens checks the same again. */}
              <StateOfficeEntry />
            </View>
          </>
        ) : (
          <View testID={testIdWithKey(TrustedApproversIds.approvingFor)} style={{ gap: 8 }}>
            {mine.length === 0 ? (
              <ThemedText style={styles.muted}>{t('Approver.IApproveForNone')}</ThemedText>
            ) : (
              <ThemedText style={styles.muted}>{t('Approver.IApproveForIntro')}</ThemedText>
            )}
            {stepDownErrorLine}
            {mine.map((prompt) =>
              personRow(
                'approving',
                prompt.connectionId,
                askerOf(prompt).asker,
                t('Approver.RowApproving', { count: prompt.actions.length, date: localDate(prompt.receivedAt) }),
                isStopAsked(prompt) ? (
                  <StatusPill
                    tone="unknown"
                    words={t('Approver.AskedToStop')}
                    testID={TrustedApproversIds.stopAsked(prompt.connectionId)}
                  />
                ) : null
              )
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

export default VtaTrustedApprovers
