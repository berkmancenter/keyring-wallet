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
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
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
import { releaseWarn } from '../module/releaseLog'
import { removalNeeds, trustedKeyOf, writableKeys } from '../module/trustedApprovers'
import { isTrustedApproversEnabled } from '../module/trustedApproversFlag'
import { vtaAgent, type TrustedApproversState, type VtiApproval } from '../module/vtaAgent'
import { waitingRequests } from '../module/waitingRequests'

import { localDate } from './localTime'
import { deviceErrorWords } from './VtaDevices'
import ApproverWaitNote from './ApproverWaitNote'

import { StatusPill } from './approver/ApproverZones'
import { EnforcementCheckIds } from './approver/EnforcementCheckCard'

export const TrustedApproversIds = {
  screen: 'TrustedApprovers',
  off: 'TrustedApproversOff',
  error: 'TrustedApproversError',
  none: 'TrustedApproversNone',
  approver: (did: string) => `TrustedApprover_${did}`,
  remove: (did: string) => `TrustedApproverRemove_${did}`,
  // What removing an approver takes (removalNeeds), and the note that changing who approves needs two.
  removalNeeds: 'TrustedApproversRemovalNeeds',
  changeNeedsTwo: 'TrustedApproversChangeNeedsTwo',
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
  /** Row I2 (Alberto, 11-17): on a card in I approve for, what you approve as tags. */
  approvingTags: (connectionId: string) => `TrustedApproverApprovingTags_${connectionId}`,
  /** Row I4: a request from this person's agent waits on this phone's yes; its code, and Open. */
  approvingWaiting: (connectionId: string) => `TrustedApproverApprovingWaiting_${connectionId}`,
  approvingOpen: (connectionId: string) => `TrustedApproverApprovingOpen_${connectionId}`,
  saidYes: (connectionId: string) => `TrustedApproverSaidYes_${connectionId}`,
  person: 'TrustedApproverPerson',
  personGone: 'TrustedApproverPersonGone',
  approvingPerson: (connectionId: string) => `TrustedApproverApproving_${connectionId}`,
  steppedDown: (did: string) => `TrustedApproverSteppedDown_${did}`,
  stepDown: (connectionId: string) => `TrustedApproverStepDown_${connectionId}`,
  stepDownConfirm: (connectionId: string) => `TrustedApproverStepDownConfirm_${connectionId}`,
  stepDownCancel: (connectionId: string) => `TrustedApproverStepDownCancel_${connectionId}`,
  stepDownError: 'TrustedApproverStepDownError',
  // Row E (Alberto, 11-16): a person's page in sections. A held request shows on each approver it waits on (their
  // row and their page), with its code.
  waiting: (did: string) => `TrustedApproverWaiting_${did}`,
  waitCode: (did: string) => `TrustedApproverWaitCode_${did}`,
  rowWaiting: (did: string) => `TrustedApproverRowWaiting_${did}`,
  needsBox: (did: string) => `TrustedApproverNeeds_${did}`,
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

/** Each action's icon on a card's tags in I approve for (row I2); MaterialIcons names. */
const ACTION_ICON: Record<string, string> = {
  shareCredential: 'badge',
  joinCommunity: 'groups',
  addDevice: 'smartphone',
  changeApprovers: 'person-add',
}

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
  const [mine, setMine] = useState<RoleOfferPrompt[]>([])
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState<string | undefined>()
  const [on, setOn] = useState(isTrustedApproversEnabled)
  /** Who was just added: the screen then offers the check (never runs it). */
  const [justAdded, setJustAdded] = useState<string | undefined>()
  /** Whether what this phone keeps has been read once: until then a person's page loads, never "nothing to show". */
  const [keptRead, setKeptRead] = useState(false)
  /** A task the agent holds for consent, and its code: shown on each approver it waits on. */
  const held = useSyncExternalStore(vtaAgent.subscribe, () => vtaAgent.getState().awaitingConsentFor)
  const heldCode = useSyncExternalStore(vtaAgent.subscribe, () => vtaAgent.getState().awaitingConsentCode)
  /**
   * Row I4 (Alberto, 11-17): requests from the agents this phone approves for that wait on its yes, from every linked
   * agent's list (as the My Agent badge counts them). A person with one goes first in I approve for, with the code.
   * Read at render: an expired one drops out the next time the list changes or the tab redraws.
   */
  // Each list goes through waitingRequests as it is read, so a request from someone else's agent never shows while
  // the trusted-approvers switch is off (approvalsShownThroughSwitch).
  const approvals = useSyncExternalStore(vtaAgent.subscribe, () => vtaAgent.getState().approvals)
  const otherRequests = useSyncExternalStore(vtaAgent.subscribe, () => vtaAgent.getState().otherRequests)
  const waitingForMe = useMemo(() => {
    const now = Date.now()
    return [
      ...waitingRequests(approvals, now),
      ...Object.values(otherRequests ?? {}).flatMap((o) => waitingRequests(o.approvals, now)),
    ].filter((a): a is VtiApproval & { forAgent: NonNullable<VtiApproval['forAgent']> } => !!a.forAgent)
  }, [approvals, otherRequests])
  /** The request waiting on this phone from this person's agent, if any (the newest). */
  const waitingFrom = (prompt: RoleOfferPrompt) =>
    waitingForMe
      .filter((a) => a.forAgent.agentDid === prompt.agentDid)
      .sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))[0]

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
    // Unreadable reads as none set aside: the section is not drawn, and nothing is lost (the records stay).
    const setAsideYeses = await setAsideRoleOffers(agent).catch(() => [] as RoleOfferAsk[])
    setAccepted(yeses)
    setAside(setAsideYeses)
    setSteppedDown(stepped)
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
    return () => {
      approverRoleEvents.off('answered', refresh)
      approverRoleEvents.off('promptCleared', refresh)
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
    // Row I2 (Alberto, 11-17): each person in I approve for is a card, not a flat row.
    approvingCard: {
      backgroundColor: ColorPalette.grayscale.white,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
      borderRadius: 14,
      padding: 14,
      gap: 10,
    },
    approvingCardWaiting: { borderWidth: 2, borderColor: ColorPalette.brand.primary },
    approvingTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    waitStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    codeBold: { fontWeight: '700' },
    openButton: {
      minHeight: 44,
      minWidth: 64,
      borderRadius: 10,
      paddingHorizontal: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: ColorPalette.brand.primary,
    },
    openButtonText: { color: ColorPalette.grayscale.white, fontWeight: '700' },
    approvingName: { fontSize: 19, lineHeight: 24 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    tag: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 3,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    tagText: { fontSize: 14, lineHeight: 18, fontWeight: '600' },
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
    pillStart: { alignSelf: 'flex-start' },
  })

  const view = state?.view
  const actionList = (keys: readonly string[]) => keys.map((key) => t(`Approver.Action.${key}`)).join(', ')
  const nameOf = (did: string) => names[did] ?? t('Approver.Unnamed')

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
  const section = (label: string, body: React.ReactNode, opts: { testID?: string } = {}) => (
    <View style={styles.section} testID={opts.testID}>
      <View style={styles.sectionHead}>
        <ThemedText style={styles.sectionLabel} accessibilityRole="header">
          {label}
        </ThemedText>
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
  /**
   * What removing an approver takes, said as it is (removalNeeds): with one approver and no rule on changing who
   * approves, at once; with an older such rule, their yes; with two or more, any one's yes. Unread: the old hedge.
   */
  const removalWords = (v: TrustedApproversState['view'] | null | undefined) => {
    const needs = v ? removalNeeds(v) : 'mayAsk'
    return needs === 'mayAsk' ? 'Approver.RemoveNeedsYes' : `Approver.Removal.${needs}`
  }
  /** The actions `ask`'s yes would be written for once added: never `changeApprovers` while they would be the only one. */
  const afterAdding = (ask: RoleOfferAsk): readonly string[] =>
    view ? writableKeys(nextTrustedRules(view, ask).approvers.length, ask.actions) : ask.actions

  const needsBox = (did: string, name: string, keys: readonly string[], opts: { added: boolean }) =>
    section(
      t(opts.added ? 'Approver.NeedsTitle' : 'Approver.NeedsTitleOnceAdded', {
        name,
        interpolation: { escapeValue: false },
      }),
      <>{actionChips(keys)}</>,
      { testID: testIdWithKey(TrustedApproversIds.needsBox(did)) }
    )

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

  /**
   * One person in I approve for (row I2, Alberto, 11-17: the list was "very flat"): a card with their initials and name,
   * when they asked, what you approve as short tags, and The whole card opens their page.
   * The date is when they asked; there is no separate date for the yes.
   */
  const approvingCard = (prompt: RoleOfferPrompt) => {
    const { asker } = askerOf(prompt)
    const stopAsked = isStopAsked(prompt)
    const waiting = waitingFrom(prompt)
    return (
      <Pressable
        key={`approving_${prompt.connectionId}`}
        onPress={() => navigation.navigate(Screens.VtaApproverPerson, { kind: 'approving', id: prompt.connectionId })}
        accessibilityRole="button"
        accessibilityLabel={asker}
        testID={testIdWithKey(TrustedApproversIds.row('approving', prompt.connectionId))}
        style={[styles.approvingCard, waiting && styles.approvingCardWaiting]}
      >
        <View style={styles.approvingTop}>
          {avatar(asker)}
          <View style={styles.personRowText}>
            <ThemedText variant="bold" style={styles.approvingName}>
              {asker}
            </ThemedText>
            <ThemedText style={styles.muted}>
              {t('Approver.AskedYouOn', { date: localDate(prompt.receivedAt) })}
            </ThemedText>
          </View>
          {stopAsked ? (
            <StatusPill
              tone="unknown"
              words={t('Approver.AskedToStop')}
              testID={TrustedApproversIds.stopAsked(prompt.connectionId)}
            />
          ) : null}
          <Icon name="chevron-right" size={24} color={ColorPalette.grayscale.mediumGrey} />
        </View>
        {waiting ? (
          <View
            style={styles.waitStrip}
            testID={testIdWithKey(TrustedApproversIds.approvingWaiting(prompt.connectionId))}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <ThemedText variant="bold">{t('Approver.NeedsYourYesNow')}</ThemedText>
              {waiting.matchCode ? (
                <ThemedText style={styles.muted}>
                  {t('Approver.CodeLabel')}{' '}
                  <ThemedText style={[styles.code, styles.codeBold]}>{waiting.matchCode}</ThemedText>
                </ThemedText>
              ) : null}
            </View>
            <Pressable
              onPress={() => navigation.navigate(Screens.VtaRequests)}
              accessibilityRole="button"
              accessibilityLabel={t('Approver.OpenRequest', { name: asker, interpolation: { escapeValue: false } })}
              testID={testIdWithKey(TrustedApproversIds.approvingOpen(prompt.connectionId))}
              style={styles.openButton}
            >
              <ThemedText style={styles.openButtonText}>{t('Approver.Open')}</ThemedText>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.tags} testID={testIdWithKey(TrustedApproversIds.approvingTags(prompt.connectionId))}>
          {prompt.actions.map((key) => (
            <View key={key} style={styles.tag}>
              <Icon name={ACTION_ICON[key] ?? 'check'} size={15} color={ColorPalette.brand.primary} />
              <ThemedText style={styles.tagText}>{t(`Approver.ActionShort.${key}`)}</ThemedText>
            </View>
          ))}
        </View>
      </Pressable>
    )
  }

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

  /** A stepped-down approver's pill, on their row and on their page. */
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
      <>{stepped ? steppedDownPill(did) : null}</>,
      null,
      <>
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
            // A step-down leaves the agent waiting for them until removed: Remove turns solid red.
            buttonType={stepped ? ButtonType.Critical : ButtonType.Secondary}
            onPress={() => void onRemove(did)}
            disabled={busy !== undefined}
            testID={testIdWithKey(TrustedApproversIds.remove(did))}
          >
            {busy === did ? <ActivityIndicator color={ColorPalette.brand.primary} /> : undefined}
          </Button>
          <ThemedText style={styles.muted} testID={testIdWithKey(TrustedApproversIds.removalNeeds)}>
            {t(removalWords(view))}
          </ThemedText>
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
      null,
      <ThemedText style={[styles.muted, styles.center]}>
        {isAside ? t('Approver.SetAsideNote') : t('Approver.Accepted')}
      </ThemedText>,
      <>
        {needsBox(ask.acceptedAs ?? ask.connectionId, name, afterAdding(ask), { added: false })}
        {ask.actions.includes('changeApprovers') && !afterAdding(ask).includes('changeApprovers') ? (
          <ThemedText style={styles.muted} testID={testIdWithKey(TrustedApproversIds.changeNeedsTwo)}>
            {t('Approver.ChangeNeedsTwo')}
          </ThemedText>
        ) : null}
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
   * Someone this phone approves for (row E): what I approve as tags, and my role with Step down, a red button asked
   * first.
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
                steppedDown.includes(did) ? steppedDownPill(did) : null,
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
                      personRow('setAside', ask.connectionId, askName(ask), t('Approver.SetAsideSub'), null)
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
              <ThemedText style={styles.muted} testID={testIdWithKey(TrustedApproversIds.removalNeeds)}>
                {t(removalWords(view))}
              </ThemedText>
            ) : null}
            {/* More: the held-request note, off the main list. */}
            <View style={styles.more} testID={testIdWithKey(TrustedApproversIds.more)}>
              <ThemedText variant="bold" accessibilityRole="header">
                {t('Approver.More')}
              </ThemedText>
              {/* A held task waits here as anywhere: who it waits on (off with the trusted-approvers switch). While a
              row above shows the wait and its code (row E), the note would say it twice; once it ends, the note says
              how (approved, or not given). */}
              {held && view?.approvers.some(waitsOn) ? null : <ApproverWaitNote />}
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
            {/* Row I4: whoever has a request waiting on this phone first; otherwise as listed. */}
            {[...mine]
              .sort((a, b) => Number(!!waitingFrom(b)) - Number(!!waitingFrom(a)))
              .map((prompt) => approvingCard(prompt))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

export default VtaTrustedApprovers
