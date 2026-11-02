/**
 * Your agent — what "signed in" looks like to a person (plan §4.1).
 *
 * A VTA has no session a person enters and leaves, so this screen shows the
 * agent's presence, what it holds, what it did and what the person can do
 * next; the operator's view (DIDs, keys, transport) stays under Details. The
 * first-link introduction presents the agent as the person's stand-in online,
 * once, and "What is my agent?" brings it back.
 *
 * Status and in-flight work come from the link state machine (plan §4.2);
 * what the agent holds is re-read from the stores, each section with its own
 * loading, empty and content states.
 *
 * @module trust-tasks/screens/VtaAgentHome
 */

import { useAgent } from '@bifold/react-hooks'
import type { Agent } from '@credo-ts/core'
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native'
import React, { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, DeviceEventEmitter, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { heldByAgent } from '../module/heldByAgent'
import { GenericRecordsCommunityStore, isCurrentMembership, type VtiMembership } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from '../module/VtiIdentityStore'
import { agentTransition, vtaAgent } from '../module/vtaAgent'
import { loadCardStanding } from '../module/vtiCardStanding'
import { ownVetterGrantState, type VetterGrantState } from '../module/vtiGrantState'
import { useCommunityJourneysOf } from '../module/communityJourney'
import { COMMUNITY_CHANGED_EVENT, VTI_PERSONA_DELIVERIES_EVENT } from '../module/communityChanged'
import { communityNameIsStale, refreshPublishedNameThrottled } from '../module/communityNameRefresh'
import { communityTarget } from '../module/vtiCommunityLink'
import { RoomsCard } from '../../rooms/components/RoomsCard'
import { useMyRooms } from '../../rooms/useMyRooms'
import { useRereadOnReturn } from '../../rooms/useRereadOnReturn'
import { useRoomOffersBadge } from '../../rooms/useRoomOffersCount'
import { useRoomsService } from '../../rooms/useRoomsService'

import { DevicesCard } from './DevicesCard'
import { ErasedNotice, RemovedPhoneCard } from './RemovedPhoneCard'
import { agentDisplayName, withAgentName } from './agentName'
import { useWaitingRequestsCount, waitingRequests } from '../module/waitingRequests'
import { CommunityCard } from './CommunityCard'
import { useOtherAgentsWaiting } from './OtherAgentsRequests'
import { AgentChips } from './AgentChips'
import { AgentSettingsButton } from './AgentHeaderButtons'
import { SectionRule } from './SectionRule'
import { RequestsSection } from './RequestsSection'
import { cardJoinOf, communityCardModel, type CommunityCardPrimary } from './communityCardModel'
import { communityHeadingOf, communityLabelOf } from './communityName'
import { communityCardKey as communityKeyOf } from './CommunityCard'
import { VtaAgentHomeIds } from './VtaAgentHome.ids'
import { useVtaLinkWithClock, VtaStatusLine } from './VtaStatus'
import { useRoomAboveTabBar } from './aboveTabBar'
import { absoluteDate, appDateWords } from '../../../utils/localDay'

interface Holdings {
  personas: VtiPersona[]
  memberships: VtiMembership[]
  /** Communities whose invitation is waiting for an identity this phone holds. */
  invited: string[]
  vetterFor: string[]
  /** Communities where this phone was a vetter and is not now: why, for the person. */
  lapsed: { communityDid: string; grant: Exclude<VetterGrantState, { state: 'active' } | { state: 'none' }> }[]
}

/** Every community this phone knows: an identity, a membership or a waiting invitation — each once. */
/**
 * This agent's identities and memberships only: another agent's are its own,
 * shown when it is current (several-agents device check, R5: B's home said
 * "Member of" a community only A had joined). A membership nothing ties to this
 * agent is not its own either (heldByAgent); it stays on the phone. An identity
 * goes only when it is known to be another agent's.
 */
export function ownHoldings(
  personas: VtiPersona[],
  memberships: VtiMembership[],
  agentDid: string | undefined
): { personas: VtiPersona[]; memberships: VtiMembership[] } {
  const others = new Set(personas.filter((p) => p.vtaDid && p.vtaDid !== agentDid).map((p) => p.did))
  return {
    personas: personas.filter((p) => !others.has(p.did)),
    memberships: memberships.filter((m) => heldByAgent(m.personaDid, personas, agentDid)),
  }
}

export const communitiesHeld = (holdings: Pick<Holdings, 'personas' | 'memberships' | 'invited'>): string[] =>
  Array.from(
    new Set([
      ...holdings.memberships.map((m) => m.communityDid),
      ...holdings.personas.map((p) => p.communityDid),
      ...holdings.invited,
    ])
  )

/**
 * How often an open agent home re-reads a live vetter grant's status, so a
 * revoke shows within this long. One small no-store fetch per grant.
 */
export const VETTER_RECHECK_MS = 15_000
const INTRO_PANELS = ['IntroKeeps', 'IntroAnswers', 'IntroApprove'] as const
/** How long a community just joined stays picked out on its card. */
export const HIGHLIGHT_MS = 4000
/** The page's padding, and the first card's: the agent chips run out past both to the screen's edges. */
const PAGE_PADDING = 20
const CARD_PADDING = 16

/**
 * What the agent holds, read from this phone's stores (and its vetter grants'
 * status lists), with the names the communities published as kept. `local`:
 * the grants' revocation as last recorded, with no status-list fetch.
 */
async function readHoldings(agent: Agent, agentKey: string | undefined, options: { local?: boolean } = {}) {
  // A cold start may come here before anything loaded what was recorded.
  if (options.local) await loadCardStanding(agent).catch(() => undefined)
  const communities = new GenericRecordsCommunityStore(agent)
  const [allPersonas, allMemberships, invitations, names] = await Promise.all([
    new GenericRecordsIdentityStore(agent).listPersonas(),
    communities.listMemberships(),
    communities.listInvitations(),
    communities.listCommunityNames().catch(() => []),
  ])
  const { personas, memberships } = ownHoldings(allPersonas, allMemberships, agentKey)
  // Names the communities published, kept from their manifests, so a
  // relaunch still says what each is called (IN-26).
  for (const { communityDid, name } of names) communityTarget.publishedName(communityDid, name)
  // An invitation that is waiting for this phone — one issued to an
  // identity it holds, not yet acted on. The panel listed every
  // invitation and said "none" when there were none; here it is a line
  // that appears only when there is one, and it hands over to the door
  // that knows how to accept it rather than growing a second way in.
  const waiting = invitations.filter(
    (i) => i.status === 'pending' && personas.some((p) => p.did === i.subjectDid && p.communityDid === i.communityDid)
  )
  // A vetter is one whose grant still stands — in its window and not
  // revoked — not one who was ever granted.
  const grants = await Promise.all(
    personas.map(async (p) => {
      const held = await communities.listHeldCredentials('vetter-grant', p.communityDid)
      const own = held.filter((g) => g.subjectDid === p.did)
      return {
        communityDid: p.communityDid,
        grant: await ownVetterGrantState(agent, own, { allowInsecureLocal: __DEV__, local: options.local }),
      }
    })
  )
  const read: Holdings = {
    personas,
    memberships,
    invited: waiting.map((i) => i.communityDid),
    vetterFor: grants.filter((g) => g.grant.state === 'active').map((g) => g.communityDid),
    lapsed: grants.flatMap((g) =>
      g.grant.state === 'revoked' || g.grant.state === 'expired' || g.grant.state === 'notYetValid'
        ? [{ communityDid: g.communityDid, grant: g.grant }]
        : []
    ),
  }
  return { holdings: read, names }
}

/** What the agent holds as last read, and whether the last read failed (the reading is kept). */
interface HoldingsSnapshot {
  holdings?: Holdings
  /** The names the communities published, as kept when the holdings were read. */
  names?: Awaited<ReturnType<typeof readHoldings>>['names']
  failed: boolean
}
const NOT_READ: HoldingsSnapshot = Object.freeze({ failed: false })

/**
 * What each agent holds, as last read, kept at module level and keyed by the
 * agent. Every tab unmounts when it loses focus (TabStack, `unmountOnBlur`),
 * so a return rebuilt this screen with nothing read: for a frame "Holds" spun,
 * the seat line was missing and Join looked like the next step (219). A return
 * shows the last reading at once and refreshes it. And a change this phone
 * stores (an approval that arrives, a join, a leave) is read again here even
 * with the screen unmounted, so the return shows today's page, not the one
 * before the join (UI-smoothness plan, Phase 2). Only the newest read of an
 * agent lands. Unlinking forgets it, and a different agent never sees another's.
 */
class AgentHoldingsStore {
  private readonly entries = new Map<string, { snapshot: HoldingsSnapshot; seq: number; agent?: Agent }>()
  private readonly listeners = new Set<() => void>()
  private watching = false

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    this.watch()
    return () => {
      this.listeners.delete(listener)
    }
  }

  get(agentKey: string | undefined): HoldingsSnapshot {
    return this.entries.get(agentKey ?? '')?.snapshot ?? NOT_READ
  }

  private set(key: string, snapshot: HoldingsSnapshot) {
    const entry = this.entries.get(key)
    if (!entry) return
    entry.snapshot = snapshot
    this.listeners.forEach((l) => l())
  }

  /** Try again: the failure is not said while the read is out. */
  clearFailed(agentKey: string | undefined) {
    const before = this.get(agentKey)
    if (before.failed) this.set(agentKey ?? '', { ...before, failed: false })
  }

  /**
   * Read; resolves with the reading when it lands, undefined when a newer read
   * landed first. Rejects when it fails.
   *
   * What the phone holds lands first — the vetter grants' revocation as last
   * recorded, no status-list fetch — and then the full read, which checks the
   * lists. A vetter's desk waited for those fetches, about a second, on every
   * visit with nothing kept: after a launch, or a switch to an agent not read
   * yet (UI-smoothness plan, Phase 3). A grant revoked since its last check
   * shows the desk until the full read lands; the desk checks the grant again
   * before it acts (vtiVetting `grantWithState`).
   */
  async read(
    agent: Agent,
    agentKey: string | undefined
  ): Promise<Awaited<ReturnType<typeof readHoldings>> | undefined> {
    const key = agentKey ?? ''
    const entry = this.entries.get(key) ?? { snapshot: NOT_READ, seq: 0 }
    entry.agent = agent
    const seq = ++entry.seq
    this.entries.set(key, entry)
    try {
      const local = await readHoldings(agent, agentKey, { local: true })
      // Whether the last full read failed is the full read's to say.
      if (this.entries.get(key) === entry && seq === entry.seq)
        this.set(key, { holdings: local.holdings, names: local.names, failed: entry.snapshot.failed })
    } catch {
      // The full read below says what failed.
    }
    try {
      const read = await readHoldings(agent, agentKey)
      if (this.entries.get(key) !== entry || seq !== entry.seq) return undefined
      this.set(key, { holdings: read.holdings, names: read.names, failed: false })
      return read
    } catch (e) {
      // Keep what was shown; say it could not be refreshed.
      if (this.entries.get(key) === entry && seq === entry.seq) this.set(key, { ...entry.snapshot, failed: true })
      throw e
    }
  }

  /** A change this phone stores is read again for the agent current now; changes that land together, once. */
  private watch(): void {
    if (this.watching) return
    this.watching = true
    let queued = false
    const onChange = () => {
      if (queued) return
      queued = true
      setTimeout(() => {
        queued = false
        const { link } = vtaAgent.getState()
        const key = link.kind === 'linked' ? link.vtaDid : undefined
        const entry = this.entries.get(key ?? '')
        if (entry?.agent) void this.read(entry.agent, key).catch(() => undefined)
      }, 0)
    }
    DeviceEventEmitter.addListener(COMMUNITY_CHANGED_EVENT, onChange)
    DeviceEventEmitter.addListener(VTI_PERSONA_DELIVERIES_EVENT, onChange)
  }

  /** Forget every reading (unlink does; tests start clean with it). */
  forget(): void {
    this.entries.clear()
  }
}

const agentHoldings = new AgentHoldingsStore()
/** Forget every reading (unlink does; tests start clean with it). */
export const forgetAgentHoldings = () => agentHoldings.forget()

const VtaAgentHome: React.FC = () => {
  // The tab bar draws over the page: the last line scrolls clear of it.
  const roomAboveTabBar = useRoomAboveTabBar()
  const { t } = useTranslation()
  const { agent } = useAgent()
  const navigation = useNavigation()
  const { ColorPalette, TextTheme } = useTheme()
  const { state, now } = useVtaLinkWithClock()
  const { link } = state
  const agentKey = link.kind === 'linked' ? link.vtaDid : undefined
  // What this page shows is worked out in render, for the agent current now:
  // the reading this screen made for it, else the last one kept for it, else
  // none yet. An effect that swapped the reading after paint showed the agent
  // before's holdings, or a member's page as a non-member's, for a frame
  // (UI-smoothness plan, Phase 1b).
  const {
    holdings,
    names,
    failed: holdingsError,
  } = useSyncExternalStore(agentHoldings.subscribe, () => agentHoldings.get(agentKey))
  // Bumped when a community's name is read again, so the cards say it (the name lives in communityTarget).
  const [, setNamesRead] = useState(0)
  const [introPanel, setIntroPanel] = useState(0)
  const otherWaiting = useOtherAgentsWaiting()
  // The communities' cards read each one's journey; this page reads the same
  // readings, so it leads with a card's next step in the same render as the
  // card shows it. Each card told it after painting, one render late.
  const held = holdings ? communitiesHeld(holdings) : []
  const journeys = useCommunityJourneysOf(held)
  // Rooms, while the rooms flag is on: one card, its rooms read here, its offers badge read from the poll the tab
  // navigator runs while an agent is linked and the app is in the foreground (nothing pushes an offer).
  const roomsService = useRoomsService()
  const myRooms = useMyRooms(roomsService)
  // Read again on coming back here, and on returning to the app after a read that failed: the first read alone
  // kept a failure until the screen was left (a tester's run, 10-29).
  useRereadOnReturn(myRooms)
  const roomOffers = useRoomOffersBadge()

  // Only what still waits: a decided or expired request is not listed. The
  // same rule as the badge on the My Agent tab (waitingRequests.ts).
  // The count's hook also re-renders this screen when a request expires.
  const waitingCount = useWaitingRequestsCount()
  const waiting = waitingCount > 0 ? waitingRequests(state.approvals, Date.now()) : []
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: PAGE_PADDING, paddingBottom: PAGE_PADDING + roomAboveTabBar, gap: 16 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: CARD_PADDING, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    mono: { ...TextTheme.normal, fontFamily: 'Menlo', fontSize: 12 },
    strip: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 },
    // A stop and the chevron before it wrap as one, so a narrow screen never
    // leaves a '›' alone at the end of a line (Pixel 6, 2026-09-26).
    stopGroup: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
    stop: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, flexShrink: 1 },
    stopNow: { backgroundColor: ColorPalette.brand.primary },
    stopNowText: { color: ColorPalette.grayscale.white, fontWeight: '700' },
    stopDone: { color: ColorPalette.semantic.success, fontWeight: '700' },
    tip: { borderLeftWidth: 4, borderLeftColor: ColorPalette.semantic.success },
    door: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
      minHeight: 64,
    },
    doorNext: { borderWidth: 2, borderColor: ColorPalette.brand.primary },
    link: { color: ColorPalette.brand.link, textDecorationLine: 'underline' },
    highlight: { borderWidth: 2, borderColor: ColorPalette.brand.primary, borderRadius: 8, padding: 4 },
  })

  const load = useCallback(async () => {
    if (!agent) return
    // The store keeps what was shown when a read fails, and says so.
    await agentHoldings.read(agent, agentKey).catch(() => undefined)
  }, [agent, agentKey])

  // Whenever a reading lands — on focus, on the timer, or from a change the
  // store read again — a community this agent belongs to whose name on record
  // is missing or over a day old has its published name read again, after the
  // stored one is shown, and never waited on (IN-340, as sign-in reads it).
  // Only these: a stored name with no holding here, another agent's identity,
  // or a membership that has ended sends nothing (VTI-LNK-050, 051). The bump
  // only re-renders; it changes nothing this effect depends on.
  useEffect(() => {
    if (!agent || !holdings || !names) return
    const belongsTo = new Set([
      ...holdings.memberships.filter(isCurrentMembership).map((m) => m.communityDid),
      ...holdings.personas.map((p) => p.communityDid),
    ])
    const now = Date.now()
    for (const communityDid of belongsTo) {
      const kept = names.find((n) => n.communityDid === communityDid)
      if (!communityNameIsStale(kept, now)) continue
      void refreshPublishedNameThrottled(agent, communityDid, { scope: agentKey, now })
        .then((fresh) => {
          if (fresh && fresh !== kept?.name) setNamesRead((n) => n + 1)
        })
        .catch(() => undefined)
    }
  }, [agent, agentKey, holdings, names])

  // Read again whenever the screen comes back into view. It stays mounted
  // under Join and Vetting, so without this a phone that had just made its
  // identity came back to "You have not joined a community yet" and no way
  // back into vetting, until a pull to refresh (Farm gate, 2026-09-23).
  const isFocused = useIsFocused()
  // A community just joined, from Join's "Done": its card picked out for a
  // few seconds, so the person sees where the membership went (Alberto, 238).
  const highlightParam = (useRoute()?.params as { highlightCommunity?: string } | undefined)?.highlightCommunity
  const [highlighted, setHighlighted] = useState<string | undefined>()
  useEffect(() => {
    if (!highlightParam) return
    setHighlighted(highlightParam)
    ;(navigation as unknown as { setParams?: (p: object) => void }).setParams?.({ highlightCommunity: undefined })
    const timer = setTimeout(() => setHighlighted(undefined), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlightParam, navigation])
  // A switch, an unlink or an add passes through "not linked": the store says
  // which (agentTransition), and this page shows the change, never "Link your
  // agent" for that moment (238, iPhone: Add drew it for an instant; and a
  // switch drew it for the whole sign-in to the next agent).
  const transition = agentTransition(state)
  // Back on this page with an "Add" still open and nothing under way (it
  // failed, or the person left by a way that did not close it): the add is
  // given up and the agent before comes back, rather than "Link your agent"
  // until a restart (IN-138). Only on arriving here: pressing Add on this
  // page does not count. What keeps it arrival-only is that it reads the
  // store imperatively and depends on isFocused alone: addingAgent is now set
  // before the agent is left (Phase 1), so an addingAgent read from the
  // subscribed state and added to the deps would cancel every add mid-flight.
  useEffect(() => {
    if (!isFocused) return
    const now = vtaAgent.getState()
    if (now.addingAgent && now.link.kind === 'notLinked') vtaAgent.cancelLink()
  }, [isFocused])
  useEffect(() => {
    if (isFocused) void load()
  }, [load, isFocused])
  // A grant, a card or an invitation that arrives while this screen is open
  // shows without a visit to Vetting — and so does anything this phone stores
  // itself (a join, a vetting, a leave): the stores say when they write.
  // (The store reads it again itself, mounted or not.)

  // A revoke sends the phone nothing: the community only flips a bit on its
  // status list. So while this screen shows a vetter's seat, the grants are read
  // again on a timer. Without it the seat stood until the app locked and came
  // back — about five minutes after a revoke on the Farm (2026-09-23), while a
  // re-grant, which arrives as a delivery, showed in seconds.
  const seatedAsVetter = (holdings?.vetterFor.length ?? 0) > 0
  useEffect(() => {
    if (!isFocused || !seatedAsVetter) return
    const timer = setInterval(() => void load(), VETTER_RECHECK_MS)
    return () => clearInterval(timer)
  }, [isFocused, seatedAsVetter, load])

  const go = (screen: Screens) => (navigation as unknown as { navigate: (name: string) => void }).navigate(screen)

  /** A screen that needs to be told which community it is about. */
  const goToCommunity = (communityDid: string) =>
    (navigation as unknown as { navigate: (name: string, params: object) => void }).navigate(Screens.VtiCommunity, {
      communityDid,
    })

  // The header's gear opens Agent settings, on the agent's own page once the
  // introduction is done. The Join menu that sat in the other corner said
  // again what the page's cards say (Alberto, 239): a member joins another
  // community from a row at the page's end.
  const withCorners = link.kind === 'linked' && state.introSeen
  useLayoutEffect(() => {
    const setOptions = (navigation as unknown as { setOptions?: (options: object) => void }).setOptions
    if (!setOptions) return
    if (!withCorners) {
      setOptions({ headerLeft: () => null, headerRight: () => null })
      return
    }
    setOptions({
      headerLeft: () => null,
      headerRight: () => (
        <AgentSettingsButton onPress={() => go(Screens.VtaAgentSettings)} testID={testIdWithKey('AgentSettings')} />
      ),
    })
    // `go` is a fresh closure each render over the same navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, withCorners])

  // A removed phone is told so here, where it lands, not only behind "Link your agent".
  if (link.kind === 'revoked') {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.content}>
          <RemovedPhoneCard link={link} />
        </View>
      </SafeAreaView>
    )
  }

  if (link.kind !== 'linked' && transition) {
    return (
      <SafeAreaView
        style={styles.container}
        edges={['left', 'right']}
        testID={testIdWithKey(VtaAgentHomeIds.homeLeaving)}
      >
        {transition === 'switching' && state.switchingTo ? (
          <View style={styles.content}>
            <ActivityIndicator />
            <ThemedText>
              {t('VtaLink.Switching', {
                agent: agentDisplayName(withAgentName({ vtaDid: state.switchingTo }, state.agentNames), t),
                interpolation: { escapeValue: false },
              })}
            </ThemedText>
          </View>
        ) : null}
      </SafeAreaView>
    )
  }

  if (link.kind !== 'linked') {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.content}>
          <ErasedNotice />
          <ThemedText>{t('VtaLink.NothingToLink')}</ThemedText>
          <Button
            title={t('VtaLink.LinkYourAgent')}
            buttonType={ButtonType.Primary}
            onPress={() => go(Screens.VtaLink)}
            testID={testIdWithKey(VtaAgentHomeIds.homeLink)}
          />
        </View>
      </SafeAreaView>
    )
  }

  // The first-link introduction: three short panels, once.
  if (!state.introSeen) {
    const last = introPanel === INTRO_PANELS.length - 1
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        {/* The words and their buttons, centred together between the header
            and the tab bar. The tab bar sits below the screen, not over it,
            so no room is kept for it here; with that room the panel sat
            high (238, iPhone). */}
        <View
          style={{ flex: 1, justifyContent: 'center', padding: 20, gap: 16 }}
          testID={testIdWithKey(VtaAgentHomeIds.intro)}
        >
          <ThemedText variant="headingTwo" accessibilityRole="header">
            {t(`VtaLink.${INTRO_PANELS[introPanel]}Title`)}
          </ThemedText>
          <ThemedText>{t(`VtaLink.${INTRO_PANELS[introPanel]}Body`)}</ThemedText>
          <ThemedText style={styles.muted}>
            {t('VtaLink.IntroStep', { n: introPanel + 1, of: INTRO_PANELS.length })}
          </ThemedText>
          <View style={{ gap: 16, marginTop: 8 }} testID={testIdWithKey(VtaAgentHomeIds.introButtons)}>
            <Button
              title={last ? t('VtaLink.IntroDone') : t('VtaLink.IntroNext')}
              buttonType={ButtonType.Primary}
              onPress={() => {
                if (last && agent) {
                  setIntroPanel(0)
                  void vtaAgent.markIntroSeen(agent)
                } else setIntroPanel(introPanel + 1)
              }}
              testID={testIdWithKey(VtaAgentHomeIds.introNext)}
            />
            {!last ? (
              <Button
                title={t('VtaLink.IntroSkip')}
                buttonType={ButtonType.Tertiary}
                onPress={() => agent && void vtaAgent.markIntroSeen(agent)}
                testID={testIdWithKey(VtaAgentHomeIds.introSkip)}
              />
            ) : null}
          </View>
        </View>
      </SafeAreaView>
    )
  }

  // Every linked agent; the current one is `link` (several agents, step 2).
  const agents = state.agents?.length ? state.agents : [{ vtaDid: link.vtaDid, label: link.label }]
  const nameOf = (vtaDid: string) =>
    agentDisplayName(withAgentName(agents.find((a) => a.vtaDid === vtaDid) ?? { vtaDid }, state.agentNames), t)
  const isVetter = (holdings?.vetterFor.length ?? 0) > 0
  // A membership the community removed stays on its card ("… removed you"),
  // but it is not membership (#166).
  const currentMemberships = (holdings?.memberships ?? []).filter(isCurrentMembership)
  const isMember = currentMemberships.length > 0
  // Holds an identity for a community it has never been a member of, and
  // neither belongs nor vets anywhere yet.
  const everMemberOf = new Set((holdings?.memberships ?? []).map((m) => m.communityDid))
  const isApplicant =
    !isMember && !isVetter && (holdings?.personas ?? []).some((p) => !everMemberOf.has(p.communityDid))
  // Removed, and nothing since: the seat names who removed them (the latest
  // removal), where it used to read "not a member yet" and offer vetting to
  // continue (227 gate U11). The community's card says what to do next.
  const removedBy =
    !isMember && !isVetter && !isApplicant
      ? (holdings?.memberships ?? [])
          .filter((m) => !isCurrentMembership(m))
          .sort((a, b) => String(b.removal?.decidedAt ?? '').localeCompare(String(a.removal?.decidedAt ?? '')))[0]
      : undefined
  const lapsed = holdings?.lapsed ?? []
  const memberOf = Array.from(new Set(currentMemberships.map((m) => m.communityDid)))
  // The next step is the one a community's card offers (its model knows where
  // a join stands), led with here: an invitation first, then a vetting.
  const stepOf = (kind: CommunityCardPrimary) =>
    held.find(
      (did, i) =>
        holdings &&
        communityCardModel({
          join: cardJoinOf(
            journeys[i],
            holdings.memberships.find((m) => m.communityDid === did)
          ),
          hasIdentity: holdings.personas.some((p) => p.communityDid === did),
          invited: holdings.invited.includes(did),
          vetter: holdings.vetterFor.includes(did),
        }).primary === kind
    )
  const invitationFor = stepOf('acceptInvitation')
  const vettingFor = stepOf('continueVetting')
  const nextStep: { kind: 'invitation' | 'vetting'; communityDid: string } | undefined = invitationFor
    ? { kind: 'invitation', communityDid: invitationFor }
    : vettingFor
      ? { kind: 'vetting', communityDid: vettingFor }
      : undefined
  const day = (iso: string) => absoluteDate(new Date(iso), appDateWords())
  const lapsedText = (communityDid: string, grant: Holdings['lapsed'][number]['grant']) => {
    const community = communityLabelOf(communityDid, t)
    const opts = { community, interpolation: { escapeValue: false } }
    switch (grant.state) {
      case 'revoked':
        return t('VtaLink.VetterRevoked', opts)
      case 'expired':
        return t('VtaLink.VetterExpired', { ...opts, date: day(grant.validUntil) })
      case 'notYetValid':
        return t('VtaLink.VetterNotYet', { ...opts, date: day(grant.validFrom) })
    }
  }

  const doorsCard = (
    <View style={styles.card} testID={testIdWithKey(VtaAgentHomeIds.doors)}>
      {/* Before joining, the two ways in lead the page; after, they are the
          header's Join menu. */}
      <ThemedText variant="labelTitle" accessibilityRole="header">
        {t('VtaLink.WhatBringsYou')}
      </ThemedText>
      <Pressable
        style={[styles.door, styles.doorNext]}
        onPress={() => go(Screens.VtiInvited)}
        accessibilityRole="button"
        testID={testIdWithKey(VtaAgentHomeIds.invited)}
      >
        <Icon name="email-open-outline" size={24} color={ColorPalette.brand.primary} />
        <View style={{ flex: 1 }}>
          <ThemedText variant="bold">{t('VtaLink.IWasInvited')}</ThemedText>
          {/* An invitation that has already arrived says so here, named. */}
          {holdings?.invited?.length ? (
            <ThemedText testID={testIdWithKey(VtaAgentHomeIds.invitationWaiting)}>
              {t('VtaLink.InvitationWaiting', {
                community: communityLabelOf(holdings.invited[0], t),
                interpolation: { escapeValue: false },
              })}
            </ThemedText>
          ) : (
            <ThemedText style={styles.muted}>{t('VtaLink.IWasInvitedHint')}</ThemedText>
          )}
        </View>
        <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
      </Pressable>
      <Pressable
        style={[styles.door, styles.doorNext]}
        onPress={() => {
          // From the beginning: which community, not the last one a link opened.
          communityTarget.clearViewing()
          go(Screens.VtiJoin)
        }}
        accessibilityRole="button"
        testID={testIdWithKey(VtaAgentHomeIds.joinCommunity)}
      >
        <Icon name="account-group-outline" size={24} color={ColorPalette.brand.primary} />
        <View style={{ flex: 1 }}>
          <ThemedText variant="bold">{t('VtaLink.WantToJoin')}</ThemedText>
          <ThemedText style={styles.muted}>{t('VtaLink.WantToJoinHint')}</ThemedText>
        </View>
        <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
      </Pressable>
    </View>
  )

  // The chips: each agent by its name, "Agent 2" for one that has none, so
  // two unnamed agents never both read "your agent".
  const chips = agents.map((a, i) => {
    const named = withAgentName(a, state.agentNames)
    const name =
      agentDisplayName(named, t) === t('VtaLink.YourAgentFallback') && agents.length > 1
        ? (t('VtaLink.ChipUnnamed', { n: i + 1 }) as string)
        : agentDisplayName(named, t)
    const current = a.vtaDid === link.vtaDid
    return {
      vtaDid: a.vtaDid,
      name,
      current,
      waiting: current ? waiting.length : (otherWaiting.find((o) => o.vtaDid === a.vtaDid)?.count ?? 0),
    }
  })

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        // No pull-to-refresh here (234 known issue, fixed in 235): after a
        // refused request, Android's SwipeRefreshLayout behind it took every
        // tap on the agent switcher's rows until the screen remounted (root
        // touch target = the refresh layout, dumpsys at the miss). The screen
        // reads again on focus, and a community card has its own Check now.
        testID={testIdWithKey(VtaAgentHomeIds.home)}
      >
        <View style={styles.card}>
          {/* The header says "Your agent"; this card says which, and switches. */}
          <ThemedText
            variant="labelTitle"
            style={styles.muted}
            accessibilityRole="header"
            testID={testIdWithKey(VtaAgentHomeIds.homeTitle)}
          >
            {t('VtaLink.SwitcherTitle')}
          </ThemedText>
          <AgentChips
            agents={chips}
            inset={PAGE_PADDING + CARD_PADDING}
            switchingTo={state.switchingTo}
            switchingText={
              state.switchingTo
                ? (t('VtaLink.Switching', {
                    agent: nameOf(state.switchingTo),
                    interpolation: { escapeValue: false },
                  }) as string)
                : undefined
            }
            onUse={(vtaDid) => {
              if (agent) void vtaAgent.useAgent(agent, vtaDid)
            }}
            onAdd={() => {
              void vtaAgent.startAddingAgent().then(() => go(Screens.VtaLink))
            }}
          />
          <VtaStatusLine connection={link.connection} now={now} />
          {/* Replies have stopped reaching this phone (VtaClient's breaker): it is
              catching up, and asks wait a few minutes rather than fail one by one. */}
          {state.repliesStalled && link.connection.kind !== 'gone' ? (
            <ThemedText style={styles.muted} testID={testIdWithKey(VtaAgentHomeIds.catchingUp)}>
              {t('VtaLink.CatchingUp')}
            </ThemedText>
          ) : null}
          {link.connection.kind === 'gone' ? (
            // Gone for good (agentGone.ts): said plainly, with the way on — a new agent.
            // Unlinking is still confirmed, in Agent settings, with words for an agent that is gone.
            <View style={{ gap: 8 }} testID={testIdWithKey(VtaAgentHomeIds.gone)}>
              <ThemedText variant="bold" style={{ color: ColorPalette.semantic.error }}>
                {t('VtaLink.AgentGoneTitle')}
              </ThemedText>
              <ThemedText testID={testIdWithKey(VtaAgentHomeIds.goneWhy)}>
                {t(link.connection.why === 'notFound' ? 'VtaLink.AgentGoneNotFound' : 'VtaLink.AgentGoneUnreachable')}
              </ThemedText>
              <Button
                title={t('VtaLink.AgentGoneLinkNew')}
                buttonType={ButtonType.Primary}
                onPress={() =>
                  (navigation as unknown as { navigate: (name: string, params: object) => void }).navigate(
                    Screens.VtaAgentSettings,
                    { unlink: true }
                  )
                }
                testID={testIdWithKey(VtaAgentHomeIds.goneLinkNew)}
              />
              <Button
                title={t('VtaLink.TryAgainNow')}
                buttonType={ButtonType.Secondary}
                onPress={() => {
                  if (agent) void vtaAgent.tryAgainNow(agent)
                }}
                testID={testIdWithKey(VtaAgentHomeIds.goneTryAgain)}
              />
            </View>
          ) : state.reconnectGaveUp ? (
            // Reconnecting stopped after its tries: said, with the way on, never a silent loop.
            <View style={{ gap: 8 }} testID={testIdWithKey(VtaAgentHomeIds.gaveUp)}>
              <ThemedText style={{ color: ColorPalette.semantic.error }}>{t('VtaLink.AgentDidNotAnswer')}</ThemedText>
              <Button
                title={t('VtaLink.TryAgainNow')}
                buttonType={ButtonType.Primary}
                onPress={() => {
                  if (agent) void vtaAgent.tryAgainNow(agent)
                }}
                testID={testIdWithKey(VtaAgentHomeIds.tryAgain)}
              />
            </View>
          ) : null}
          {/* What this phone is here, in one line and one place: member,
              vetter, applicant, or none of those yet. Only once what the agent
              holds has been read, so a reader can trust the cards below. */}
          {holdings ? (
            <ThemedText style={styles.muted} testID={testIdWithKey(VtaAgentHomeIds.seat)}>
              {removedBy
                ? t('VtaLink.SeatRemoved', {
                    community: communityLabelOf(removedBy.communityDid, t),
                    interpolation: { escapeValue: false },
                  })
                : t(
                    holdings.vetterFor.length
                      ? 'VtaLink.SeatVetter'
                      : isMember
                        ? 'VtaLink.SeatMember'
                        : isApplicant
                          ? 'VtaLink.SeatApplicant'
                          : 'VtaLink.SeatNone'
                  )}
            </ThemedText>
          ) : null}
          {/* The step bar teaches the first setup, so it shows only until the
              first membership; after that a status line says where this agent
              stands (233). Neither until what the agent holds is read: a
              vetter's cold launch drew the step bar, "Join" next, until the
              read came back, then jumped to the vetter's page (271). */}
          {!holdings ? null : everMemberOf.size > 0 ? (
            isMember ? (
              // The id the vetting e2e has always read as "this phone is a member".
              <ThemedText variant="bold" testID={testIdWithKey(VtaAgentHomeIds.journeyJoined)}>
                {memberOf.length === 1
                  ? t('VtaLink.StatusMemberOf', {
                      community: communityHeadingOf(memberOf[0], t, { claim: 'plain' }),
                      interpolation: { escapeValue: false },
                    })
                  : t('VtaLink.StatusMemberOfMany', { count: memberOf.length })}
              </ThemedText>
            ) : null
          ) : (
            <View testID={testIdWithKey(VtaAgentHomeIds.journey)} accessibilityRole="summary">
              <View style={styles.strip} testID={testIdWithKey(VtaAgentHomeIds.journeyRow)}>
                {[
                  { key: 'Linked', label: t('VtaLink.JourneyLinked'), done: true, now: false },
                  { key: 'Join', label: t('VtaLink.JourneyJoin'), done: false, now: true },
                  { key: 'Member', label: t('VtaLink.JourneyMember'), done: false, now: false },
                ].map((stop, i) => (
                  <View key={stop.key} style={styles.stopGroup} testID={testIdWithKey(`AgentJourneyStop_${stop.key}`)}>
                    {i > 0 ? <Icon name="chevron-right" size={16} color={ColorPalette.grayscale.mediumGrey} /> : null}
                    <View
                      style={[styles.stop, stop.now ? styles.stopNow : undefined]}
                      accessibilityState={{ selected: stop.now }}
                      testID={testIdWithKey(`AgentJourney${stop.key}`)}
                    >
                      <ThemedText style={stop.done ? styles.stopDone : stop.now ? styles.stopNowText : styles.muted}>
                        {stop.done ? '✓ ' : ''}
                        {stop.label}
                      </ThemedText>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}
          <Pressable
            onPress={() => vtaAgent.showIntro()}
            accessibilityRole="link"
            testID={testIdWithKey(VtaAgentHomeIds.whatIsMyAgent)}
          >
            <ThemedText style={styles.link}>{t('VtaLink.WhatIsMyAgent')}</ThemedText>
          </Pressable>
        </View>

        {/* An agent was just added: it is current now; keep it, or go back. */}
        {state.addedAgent && state.addedAgent.added === link.vtaDid ? (
          <View style={[styles.card, styles.tip]} testID={testIdWithKey(VtaAgentHomeIds.addedCard)}>
            <ThemedText variant="bold">
              {t('VtaLink.AddedLinked', {
                agent: nameOf(state.addedAgent.added),
                interpolation: { escapeValue: false },
              })}
            </ThemedText>
            <Button
              title={t('VtaLink.AddedUseNow')}
              buttonType={ButtonType.Primary}
              onPress={() => vtaAgent.acknowledgeAdded()}
              testID={testIdWithKey(VtaAgentHomeIds.addedUse)}
            />
            <Button
              title={t('VtaLink.AddedKeep', {
                agent: nameOf(state.addedAgent.from),
                interpolation: { escapeValue: false },
              })}
              buttonType={ButtonType.Secondary}
              onPress={() => agent && state.addedAgent && void vtaAgent.useAgent(agent, state.addedAgent.from)}
              testID={testIdWithKey(VtaAgentHomeIds.addedKeep)}
            />
          </View>
        ) : null}

        {/* A vetter's desk, at the top, one tap away: it sat in a community's
            card further down, under a scroll (Alberto, 10-06). */}
        {holdings?.vetterFor.map((communityDid) => (
          <View key={communityDid} style={[styles.card, styles.tip]} testID={testIdWithKey(VtaAgentHomeIds.vetterCard)}>
            <ThemedText variant="bold">
              {t('VtaLink.YouCanVet', {
                community: communityHeadingOf(communityDid, t),
                interpolation: { escapeValue: false },
              })}
            </ThemedText>
            <ThemedText style={styles.muted}>{t('VtaLink.YouCanVetBody')}</ThemedText>
            <Button
              title={t('VtaLink.OpenDesk')}
              buttonType={ButtonType.Primary}
              onPress={() => {
                // The vetting screen works on the chosen community.
                communityTarget.choose(communityDid)
                go(Screens.VtiVetting)
              }}
              testID={testIdWithKey(
                holdings.vetterFor.length > 1
                  ? `AgentOpenDesk_${communityKeyOf(communityDid)}`
                  : VtaAgentHomeIds.openDesk
              )}
            />
          </View>
        ))}
        {!isVetter && lapsed.length > 0 ? (
          <View style={styles.card}>
            {lapsed.map(({ communityDid, grant }) => (
              <ThemedText key={communityDid} style={styles.muted} testID={testIdWithKey(VtaAgentHomeIds.vetterLapsed)}>
                {lapsedText(communityDid, grant)}
              </ThemedText>
            ))}
          </View>
        ) : null}

        {/* One next step, only when there is one: an invitation waiting, else
            a vetting to continue. */}
        {nextStep ? (
          <View style={[styles.card, styles.tip]} testID={testIdWithKey(VtaAgentHomeIds.nextStep)}>
            <ThemedText variant="labelTitle" style={styles.muted}>
              {t('VtaLink.NextStep')}
            </ThemedText>
            <ThemedText variant="bold" testID={testIdWithKey(VtaAgentHomeIds.nextStepText)}>
              {nextStep.kind === 'invitation'
                ? t('VtaLink.InvitationWaiting', {
                    community: communityHeadingOf(nextStep.communityDid, t),
                    interpolation: { escapeValue: false },
                  })
                : t('VtaLink.NextVetting', {
                    community: communityHeadingOf(nextStep.communityDid, t),
                    interpolation: { escapeValue: false },
                  })}
            </ThemedText>
            <Button
              title={t(nextStep.kind === 'invitation' ? 'VtaLink.NextInvitationAction' : 'VtaLink.ContinueVetting')}
              buttonType={ButtonType.Primary}
              onPress={() => {
                // The invitation and vetting screens work on the chosen community.
                communityTarget.choose(nextStep.communityDid)
                go(nextStep.kind === 'invitation' ? Screens.VtiInvited : Screens.VtiVetting)
              }}
              testID={testIdWithKey(
                nextStep.kind === 'invitation' ? VtaAgentHomeIds.nextInvitation : VtaAgentHomeIds.continueVetting
              )}
            />
          </View>
        ) : null}

        {/* Before joining, the two ways in lead; after, one row at the page's end.
            Not before the holdings are known: a member saw the ways in until
            the first read came back (Phase 1b). */}
        {holdings && !isMember ? (
          <>
            <SectionRule />
            {doorsCard}
          </>
        ) : null}

        {/* What waits for this person's decision, on this agent: always here,
            after the ways in (Alberto, 239). */}
        <SectionRule />
        <RequestsSection
          waiting={waiting}
          onOpen={() => go(Screens.VtaRequests)}
          onAskMe={() => go(Screens.VtaAskMe)}
        />

        <SectionRule />
        <View style={styles.card} testID={testIdWithKey(VtaAgentHomeIds.holds)}>
          <ThemedText variant="labelTitle" accessibilityRole="header">
            {t('VtaLink.Holds')}
          </ThemedText>
          {/* Waiting and broken are told apart: the spinner only while a first
              read is out; a first read that failed, with nothing kept, says so
              and offers to try again — not "showing what was last read" (nothing
              was), and not the ways in either, since nobody knows yet whether
              this phone is a member. */}
          {!holdings && holdingsError ? (
            <>
              <ThemedText testID={testIdWithKey(VtaAgentHomeIds.holdsUnread)}>{t('VtaLink.HoldsUnread')}</ThemedText>
              <Button
                title={t('VtaLink.TryAgain')}
                buttonType={ButtonType.Secondary}
                onPress={() => {
                  // Only a read that will run clears the error: with no agent, load() returns at once and the
                  // spinner would never stop — the hung screen this card replaces (7a, #483).
                  if (!agent) return
                  agentHoldings.clearFailed(agentKey)
                  void load()
                }}
                testID={testIdWithKey(VtaAgentHomeIds.holdsRetry)}
              />
            </>
          ) : !holdings ? (
            <ActivityIndicator color={ColorPalette.brand.primary} />
          ) : communitiesHeld(holdings).length === 0 ? (
            <ThemedText style={styles.muted}>{t('VtaLink.HoldsNothing')}</ThemedText>
          ) : (
            // One card per community, with what the agent holds for it under
            // it and at most one next step (IN-20c).
            communitiesHeld(holdings).map((communityDid) => (
              <View
                key={communityDid}
                style={communityDid === highlighted ? styles.highlight : undefined}
                testID={communityDid === highlighted ? testIdWithKey(VtaAgentHomeIds.communityHighlighted) : undefined}
              >
                <CommunityCard
                  agent={agent}
                  communityDid={communityDid}
                  persona={holdings.personas.find((p) => p.communityDid === communityDid)}
                  membership={holdings.memberships.find((m) => m.communityDid === communityDid)}
                  invited={holdings.invited.includes(communityDid)}
                  vetter={holdings.vetterFor.includes(communityDid)}
                  deskShownAbove={holdings.vetterFor.includes(communityDid)}
                  linkedAt={link.linkedAt}
                  onOpen={goToCommunity}
                  onPrimary={(action, did) => {
                    // The vetting and invitation screens work on the chosen community.
                    communityTarget.choose(did)
                    go(action === 'acceptInvitation' ? Screens.VtiInvited : Screens.VtiVetting)
                  }}
                />
              </View>
            ))
          )}
          {holdings && holdingsError ? (
            <ThemedText style={styles.muted} testID={testIdWithKey(VtaAgentHomeIds.holdsStale)}>
              {t('VtaLink.HoldsStale')}
            </ThemedText>
          ) : null}
        </View>

        {roomsService ? (
          <>
            <SectionRule />
            <RoomsCard
              service={roomsService}
              myRooms={myRooms}
              offersCount={roomOffers}
              onOpen={() => go(Screens.RoomsHome)}
            />
          </>
        ) : null}

        <SectionRule />
        <DevicesCard onPress={() => go(Screens.VtaDevices)} />

        {/* A member joins another community from here: one row, not the two
            cards again (Alberto, 239). Join takes a community's link or an
            invitation's. */}
        {isMember ? (
          <>
            <SectionRule />
            <Pressable
              style={[styles.row, { paddingHorizontal: 16 }]}
              onPress={() => {
                // From the beginning: which community, not the last one a link opened.
                communityTarget.clearViewing()
                go(Screens.VtiJoin)
              }}
              accessibilityRole="button"
              testID={testIdWithKey(VtaAgentHomeIds.joinAnother)}
            >
              <Icon name="account-group-outline" size={24} color={ColorPalette.brand.primary} />
              <ThemedText variant="bold" style={{ flex: 1 }}>
                {t('VtaLink.JoinAnother')}
              </ThemedText>
              <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

export default VtaAgentHome
