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
import { useIsFocused, useNavigation } from '@react-navigation/native'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { GenericRecordsCommunityStore, isCurrentMembership, type VtiMembership } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from '../module/VtiIdentityStore'
import { vtaAgent, type VtaActivity } from '../module/vtaAgent'
import { ownVetterGrantState, type VetterGrantState } from '../module/vtiGrantState'
import { useCommunityChanged } from '../module/communityChanged'
import { communityTarget } from '../module/vtiCommunityLink'

import { DevicesCard } from './DevicesCard'
import { ErasedNotice, RemovedPhoneCard } from './RemovedPhoneCard'
import { agentDisplayName, withAgentName } from './agentName'
import { useWaitingRequestsCount } from '../module/waitingRequests'
import { CommunityCard } from './CommunityCard'
import { OtherAgentsRequests, useOtherAgentsWaiting } from './OtherAgentsRequests'
import type { CommunityCardPrimary } from './communityCardModel'
import { communityHeadingOf, communityLabelOf } from './communityName'
import { GetCardsFromAgent } from './GetCardsFromAgent'
import { SEGMENT_MIN_SCALE, segmentLayout } from './segmentLayout'
import { shortTask } from './RequestCard'
import { useVtaLinkWithClock, VtaStatusLine } from './VtaStatus'

interface Holdings {
  personas: VtiPersona[]
  memberships: VtiMembership[]
  /** Communities whose invitation is waiting for an identity this phone holds. */
  invited: string[]
  vetterFor: string[]
  /** Communities where this phone was a vetter and is not now: why, for the person. */
  lapsed: { communityDid: string; grant: Exclude<VetterGrantState, { state: 'active' } | { state: 'none' }> }[]
}

/** The segments of "Your agent" (IN-20c); the one shown is kept for the session. */
type AgentSegment = 'communities' | 'manage' | 'status'
const SEGMENT_LABEL: Record<AgentSegment, string> = {
  communities: 'MyAgent.Communities',
  manage: 'VtaLink.SegmentManage',
  status: 'VtaLink.SegmentStatus',
}
let sessionSegment: AgentSegment = 'communities'

/** Every community this phone knows: an identity, a membership or a waiting invitation — each once. */
/**
 * This agent's identities and memberships only: another agent's are its own,
 * shown when it is current (several-agents device check, R5: B's home said
 * "Member of" a community only A had joined). Only what is known to be another
 * agent's is left out, so a phone with one agent sees what it saw before.
 */
export function ownHoldings(
  personas: VtiPersona[],
  memberships: VtiMembership[],
  agentDid: string | undefined
): { personas: VtiPersona[]; memberships: VtiMembership[] } {
  const others = new Set(personas.filter((p) => p.vtaDid && p.vtaDid !== agentDid).map((p) => p.did))
  return {
    personas: personas.filter((p) => !others.has(p.did)),
    memberships: memberships.filter((m) => !others.has(m.personaDid)),
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

/**
 * What the agent holds, as last read, kept across remounts and keyed by the
 * linked agent. Every tab unmounts when it loses focus (TabStack,
 * `unmountOnBlur`), so a return rebuilt this screen with nothing read: for a
 * frame "Holds" spun, the seat line was missing and Join looked like the next
 * step (219). A return now shows the last reading at once and refreshes it.
 * Unlinking forgets it, and a different agent never sees another's.
 */
const lastHoldings = new Map<string, Holdings>()
/** Forget every reading (unlink does; tests start clean with it). */
export const forgetAgentHoldings = () => {
  lastHoldings.clear()
  sessionSegment = 'communities'
}

const VtaAgentHome: React.FC = () => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const navigation = useNavigation()
  const { ColorPalette, TextTheme } = useTheme()
  const { state, now } = useVtaLinkWithClock()
  const { link } = state
  const agentKey = link.kind === 'linked' ? link.vtaDid : undefined
  const [holdings, setHoldings] = useState<Holdings | undefined>(() =>
    agentKey ? lastHoldings.get(agentKey) : undefined
  )
  // Another agent linked while this screen stays mounted: its own reading, or none.
  const shownFor = useRef(agentKey)
  useEffect(() => {
    if (shownFor.current === agentKey) return
    shownFor.current = agentKey
    setHoldings(agentKey ? lastHoldings.get(agentKey) : undefined)
  }, [agentKey])
  const [holdingsError, setHoldingsError] = useState(false)
  const [unlinkOpen, setUnlinkOpen] = useState(false)
  // The card opens below the button, at the foot of the screen: bring it into
  // view, or a tap on "Unlink this agent" looks like it did nothing (Farm, 2026-09-24).
  const scrollRef = useRef<ScrollView>(null)
  useEffect(() => {
    if (!unlinkOpen) return
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50)
    return () => clearTimeout(timer)
  }, [unlinkOpen])
  const [refreshing, setRefreshing] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [introPanel, setIntroPanel] = useState(0)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  /** The other agent the person asked to unlink, awaiting their confirmation. */
  const [unlinkTarget, setUnlinkTarget] = useState<string>()
  const otherWaiting = useOtherAgentsWaiting()
  const [cardSteps, setCardSteps] = useState<Record<string, CommunityCardPrimary | undefined>>({})
  const onCardStep = useCallback((communityDid: string, primary: CommunityCardPrimary | undefined) => {
    setCardSteps((prev) => (prev[communityDid] === primary ? prev : { ...prev, [communityDid]: primary }))
  }, [])

  const [segment, setSegment] = useState<AgentSegment>(sessionSegment)
  const chooseSegment = useCallback((next: AgentSegment) => {
    sessionSegment = next
    setSegment(next)
  }, [])
  // Only what still waits: a decided or expired request is not in the count.
  // The same count as the badge on the My Agent tab (waitingRequests.ts).
  const pendingApprovals = useWaitingRequestsCount()
  // One line per label, always: side by side while that stays readable,
  // stacked when the phone is narrow or the text is large (IN-37).
  const { width, fontScale } = useWindowDimensions()
  const segmentLabels = (['communities', 'manage', 'status'] as const).map((key) => t(SEGMENT_LABEL[key]) as string)
  const segmentsStacked =
    segmentLayout({
      width,
      fontScale,
      labels: segmentLabels,
      fontSize: TextTheme.bold.fontSize ?? 18,
      // page padding 20 × 2, row padding 4 × 2, two gaps of 4
      chrome: 56,
      pillPadding: 12,
    }) === 'stacked'

  const styles = StyleSheet.create({
    segments: {
      flexDirection: 'row',
      backgroundColor: ColorPalette.brand.secondaryBackground,
      borderRadius: 8,
      padding: 4,
      gap: 4,
    },
    segmentsStacked: { flexDirection: 'column' },
    // Stacked, a pill is as tall as its line, not a share of the column.
    segmentInStack: { flex: 0 },
    // Every pill the same: only the selected one's colour differs, never its size.
    segment: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      paddingHorizontal: 6,
      borderRadius: 6,
    },
    segmentOn: { backgroundColor: ColorPalette.brand.primary },
    segmentOnText: { color: ColorPalette.grayscale.white },
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 20, gap: 16 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
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
  })

  const load = useCallback(async () => {
    if (!agent) return
    try {
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
        (i) =>
          i.status === 'pending' && personas.some((p) => p.did === i.subjectDid && p.communityDid === i.communityDid)
      )
      // A vetter is one whose grant still stands — in its window and not
      // revoked — not one who was ever granted.
      const grants = await Promise.all(
        personas.map(async (p) => {
          const held = await communities.listHeldCredentials('vetter-grant', p.communityDid)
          const own = held.filter((g) => g.subjectDid === p.did)
          return {
            communityDid: p.communityDid,
            grant: await ownVetterGrantState(agent, own, { allowInsecureLocal: __DEV__ }),
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
      if (agentKey) lastHoldings.set(agentKey, read)
      setHoldings(read)
      setHoldingsError(false)
    } catch {
      // Keep what was shown; say it could not be refreshed.
      setHoldingsError(true)
    }
  }, [agent, agentKey])

  // Read again whenever the screen comes back into view. It stays mounted
  // under Join and Vetting, so without this a phone that had just made its
  // identity came back to "You have not joined a community yet" and no way
  // back into vetting, until a pull to refresh (Farm gate, 2026-09-23).
  const isFocused = useIsFocused()
  useEffect(() => {
    if (isFocused) void load()
  }, [load, isFocused])
  // A grant, a card or an invitation that arrives while this screen is open
  // shows without a visit to Vetting — and so does anything this phone stores
  // itself (a join, a vetting, a leave): the stores say when they write.
  const loadNow = useCallback(() => void load(), [load])
  useCommunityChanged(loadNow)

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

  const onRefresh = useCallback(async () => {
    if (!agent) return
    setRefreshing(true)
    await vtaAgent.ensureOnline(agent)
    await load()
    setRefreshing(false)
  }, [agent, load])

  const go = (screen: Screens) => (navigation as unknown as { navigate: (name: string) => void }).navigate(screen)

  // Unlinking is local: this phone forgets the agent and its own key for it.
  // The agent keeps the key on its list until its owner removes it — a client
  // cannot remove its own entry (VTI-Q23) — and the confirmation says so. It
  // confirms in place rather than in a native alert, which the e2e runner's
  // autoAcceptAlerts would answer by itself.
  const unlink = () => {
    if (!agent) return
    setUnlinkOpen(false)
    forgetAgentHoldings()
    void vtaAgent.unlink(agent).then(() => go(Screens.VtaLink))
  }
  /** A screen that needs to be told which community it is about. */
  const goToCommunity = (communityDid: string) =>
    (navigation as unknown as { navigate: (name: string, params: object) => void }).navigate(Screens.VtiCommunity, {
      communityDid,
    })

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
            testID={testIdWithKey('AgentHomeLink')}
          />
        </View>
      </SafeAreaView>
    )
  }

  // The first-link introduction: three short panels, once.
  if (!state.introSeen) {
    const last = introPanel === INTRO_PANELS.length - 1
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={[styles.content, { flex: 1, justifyContent: 'center' }]} testID={testIdWithKey('AgentIntro')}>
          <ThemedText variant="headingTwo" accessibilityRole="header">
            {t(`VtaLink.${INTRO_PANELS[introPanel]}Title`)}
          </ThemedText>
          <ThemedText>{t(`VtaLink.${INTRO_PANELS[introPanel]}Body`)}</ThemedText>
          <ThemedText style={styles.muted}>
            {t('VtaLink.IntroStep', { n: introPanel + 1, of: INTRO_PANELS.length })}
          </ThemedText>
        </View>
        <View style={[styles.content, { paddingTop: 0 }]}>
          <Button
            title={last ? t('VtaLink.IntroDone') : t('VtaLink.IntroNext')}
            buttonType={ButtonType.Primary}
            onPress={() => {
              if (last && agent) {
                setIntroPanel(0)
                void vtaAgent.markIntroSeen(agent)
              } else setIntroPanel(introPanel + 1)
            }}
            testID={testIdWithKey('AgentIntroNext')}
          />
          {!last ? (
            <Button
              title={t('VtaLink.IntroSkip')}
              buttonType={ButtonType.Tertiary}
              onPress={() => agent && void vtaAgent.markIntroSeen(agent)}
              testID={testIdWithKey('AgentIntroSkip')}
            />
          ) : null}
        </View>
      </SafeAreaView>
    )
  }

  const activityText = (a: VtaActivity) => t(`VtaLink.Activity.${a.kind}`)
  // Every linked agent; the current one is `link` (several agents, step 2).
  const agents = state.agents?.length ? state.agents : [{ vtaDid: link.vtaDid, label: link.label }]
  const otherAgents = agents.filter((a) => a.vtaDid !== link.vtaDid)
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
  const held = holdings ? communitiesHeld(holdings) : []
  const stepOf = (kind: CommunityCardPrimary) => held.find((did) => cardSteps[did] === kind)
  const invitationFor = stepOf('acceptInvitation')
  const vettingFor = stepOf('continueVetting')
  const nextStep: { kind: 'invitation' | 'vetting'; communityDid: string } | undefined = invitationFor
    ? { kind: 'invitation', communityDid: invitationFor }
    : vettingFor
      ? { kind: 'vetting', communityDid: vettingFor }
      : undefined
  const day = (iso: string) => new Date(iso).toLocaleDateString()
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

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
        testID={testIdWithKey('AgentHome')}
      >
        <View style={styles.card}>
          {/* "Your agent" leads; the name the host gave it is a line under it
              (IN-20c: the name alone at the top meant little). */}
          <ThemedText variant="headingThree" accessibilityRole="header" testID={testIdWithKey('AgentHomeTitle')}>
            {t('MyAgent.Title')}
          </ThemedText>
          {/* The agent's name opens the list of agents (several agents, step 2). */}
          <Pressable
            style={styles.row}
            onPress={() => setSwitcherOpen(!switcherOpen)}
            disabled={Boolean(state.switchingTo)}
            accessibilityRole="button"
            accessibilityState={{ expanded: switcherOpen, busy: Boolean(state.switchingTo) }}
            accessibilityHint={t('VtaLink.SwitcherTitle')}
            testID={testIdWithKey('AgentSwitcherOpen')}
          >
            <ThemedText variant="bold" style={{ flexShrink: 1 }} testID={testIdWithKey('AgentHomeName')}>
              {agentDisplayName(withAgentName(link, state.agentNames), t)}
            </ThemedText>
            <Icon name={switcherOpen ? 'chevron-up' : 'chevron-down'} size={22} color={TextTheme.normal.color} />
          </Pressable>
          {/* A switch leaves one agent and signs in to the next (about 20 s on the
              device check): said while it lasts, so it is not tapped again. */}
          {state.switchingTo ? (
            <View style={styles.row} testID={testIdWithKey('AgentSwitching')}>
              <ActivityIndicator color={ColorPalette.brand.primary} />
              <ThemedText style={styles.muted}>
                {t('VtaLink.Switching', {
                  agent: agentDisplayName(
                    withAgentName(
                      agents.find((a) => a.vtaDid === state.switchingTo) ?? { vtaDid: state.switchingTo },
                      state.agentNames
                    ),
                    t
                  ),
                  interpolation: { escapeValue: false },
                })}
              </ThemedText>
            </View>
          ) : null}
          {switcherOpen ? (
            <View style={{ gap: 4 }} testID={testIdWithKey('AgentSwitcher')}>
              <ThemedText variant="labelTitle" accessibilityRole="header">
                {t('VtaLink.SwitcherTitle')}
              </ThemedText>
              {otherAgents.length > 0 ? (
                <ThemedText style={styles.muted} testID={testIdWithKey('AgentSwitcherNote')}>
                  {t('VtaLink.SwitcherOnlyCurrent')}
                </ThemedText>
              ) : null}
              {agents.map((a, i) => {
                const isCurrent = a.vtaDid === link.vtaDid
                return (
                  <Pressable
                    key={a.vtaDid}
                    style={styles.row}
                    disabled={isCurrent}
                    onPress={() => {
                      setSwitcherOpen(false)
                      if (agent) void vtaAgent.useAgent(agent, a.vtaDid)
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isCurrent, disabled: isCurrent }}
                    testID={testIdWithKey(`AgentSwitcherRow_${i}`)}
                  >
                    <View style={{ flex: 1 }}>
                      <ThemedText variant="bold">{agentDisplayName(withAgentName(a, state.agentNames), t)}</ThemedText>
                      <ThemedText
                        style={styles.muted}
                        testID={testIdWithKey(isCurrent ? 'AgentSwitcherCurrent' : `AgentSwitcherOther_${i}`)}
                      >
                        {isCurrent
                          ? t('VtaLink.SwitcherCurrent')
                          : (otherWaiting.find((o) => o.vtaDid === a.vtaDid)?.count ?? 0) > 0
                            ? t('VtaLink.SwitcherWaiting', {
                                count: otherWaiting.find((o) => o.vtaDid === a.vtaDid)?.count,
                              })
                            : t('VtaLink.SwitcherNotConnected')}
                      </ThemedText>
                    </View>
                    {isCurrent ? (
                      <Icon name="check" size={22} color={ColorPalette.brand.primary} />
                    ) : (
                      <Pressable
                        onPress={() => setUnlinkTarget(a.vtaDid)}
                        accessibilityRole="button"
                        accessibilityLabel={t('VtaLink.UnlinkTitle', {
                          agent: agentDisplayName(withAgentName(a, state.agentNames), t),
                          interpolation: { escapeValue: false },
                        })}
                        hitSlop={8}
                        testID={testIdWithKey(`AgentSwitcherUnlink_${i}`)}
                      >
                        <ThemedText style={styles.link}>{t('VtaLink.UnlinkConfirm')}</ThemedText>
                      </Pressable>
                    )}
                  </Pressable>
                )
              })}
              <Pressable
                style={styles.row}
                onPress={() => {
                  setSwitcherOpen(false)
                  void vtaAgent.startAddingAgent().then(() => go(Screens.VtaLink))
                }}
                accessibilityRole="button"
                testID={testIdWithKey('AgentSwitcherAdd')}
              >
                <Icon name="plus" size={22} color={ColorPalette.brand.link} />
                <ThemedText style={[styles.link, { flex: 1 }]}>{t('VtaLink.SwitcherAdd')}</ThemedText>
              </Pressable>
            </View>
          ) : null}
          {unlinkTarget ? (
            <View style={{ gap: 8 }} testID={testIdWithKey('AgentUnlinkOtherCard')}>
              <ThemedText variant="labelTitle" accessibilityRole="header">
                {t('VtaLink.UnlinkTitle', { agent: nameOf(unlinkTarget), interpolation: { escapeValue: false } })}
              </ThemedText>
              <ThemedText>
                {t('VtaLink.UnlinkOtherBody', { agent: nameOf(unlinkTarget), interpolation: { escapeValue: false } })}
              </ThemedText>
              <Button
                title={t('VtaLink.UnlinkConfirm')}
                buttonType={ButtonType.Critical}
                onPress={() => {
                  const target = unlinkTarget
                  setUnlinkTarget(undefined)
                  if (agent && target) void vtaAgent.unlinkAgent(agent, target)
                }}
                testID={testIdWithKey('AgentUnlinkOtherConfirm')}
              />
              <Button
                title={t('Global.Cancel')}
                buttonType={ButtonType.Secondary}
                onPress={() => setUnlinkTarget(undefined)}
                testID={testIdWithKey('AgentUnlinkOtherCancel')}
              />
            </View>
          ) : null}
          <VtaStatusLine connection={link.connection} now={now} />
          <OtherAgentsRequests shape="line" />
          {link.connection.kind === 'gone' ? (
            // Gone for good (agentGone.ts): said plainly, with the way on — a new agent.
            // Unlinking is still confirmed, in Manage, with words for an agent that is gone.
            <View style={{ gap: 8 }} testID={testIdWithKey('AgentGone')}>
              <ThemedText variant="bold" style={{ color: ColorPalette.semantic.error }}>
                {t('VtaLink.AgentGoneTitle')}
              </ThemedText>
              <ThemedText testID={testIdWithKey('AgentGoneWhy')}>
                {t(link.connection.why === 'notFound' ? 'VtaLink.AgentGoneNotFound' : 'VtaLink.AgentGoneUnreachable')}
              </ThemedText>
              <Button
                title={t('VtaLink.AgentGoneLinkNew')}
                buttonType={ButtonType.Primary}
                onPress={() => {
                  chooseSegment('manage')
                  setUnlinkOpen(true)
                }}
                testID={testIdWithKey('AgentGoneLinkNew')}
              />
              <Button
                title={t('VtaLink.TryAgainNow')}
                buttonType={ButtonType.Secondary}
                onPress={() => {
                  if (agent) void vtaAgent.tryAgainNow(agent)
                }}
                testID={testIdWithKey('AgentGoneTryAgain')}
              />
            </View>
          ) : state.reconnectGaveUp ? (
            // Reconnecting stopped after its tries: said, with the way on, never a silent loop.
            <View style={{ gap: 8 }} testID={testIdWithKey('AgentGaveUp')}>
              <ThemedText style={{ color: ColorPalette.semantic.error }}>{t('VtaLink.AgentDidNotAnswer')}</ThemedText>
              <Button
                title={t('VtaLink.TryAgainNow')}
                buttonType={ButtonType.Primary}
                onPress={() => {
                  if (agent) void vtaAgent.tryAgainNow(agent)
                }}
                testID={testIdWithKey('AgentTryAgain')}
              />
            </View>
          ) : null}
          {/* What this phone is here, in one line and one place.
              A reader used to infer the seat from which cards were on screen,
              which is how `run-vetter-grant-lifecycle` ended up waiting for an
              id that never existed. A seat is a fact the screen knows, so the
              screen says it: member, vetter, applicant, or none of those yet. */}
          {/* Only once what the agent holds has been read: before that every
              phone would briefly read "not joined yet", and a reader that sees
              this line can trust the cards below it have settled too. */}
          {holdings ? (
            <ThemedText style={styles.muted} testID={testIdWithKey('AgentSeat')}>
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
              first membership. After that a status line says where this agent
              stands, and the next-step card below says what, if anything, needs
              the person now (233). */}
          {holdings && everMemberOf.size > 0 ? (
            isMember ? (
              // The id the vetting e2e has always read as "this phone is a member".
              <ThemedText variant="bold" testID={testIdWithKey('AgentJourneyJoined')}>
                {memberOf.length === 1
                  ? t('VtaLink.StatusMemberOf', {
                      community: communityHeadingOf(memberOf[0], t, { claim: 'plain' }),
                      interpolation: { escapeValue: false },
                    })
                  : t('VtaLink.StatusMemberOfMany', { count: memberOf.length })}
              </ThemedText>
            ) : null
          ) : (
            <View testID={testIdWithKey('AgentJourney')} accessibilityRole="summary">
              <View style={styles.strip} testID={testIdWithKey('AgentJourneyRow')}>
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
            testID={testIdWithKey('WhatIsMyAgent')}
          >
            <ThemedText style={styles.link}>{t('VtaLink.WhatIsMyAgent')}</ThemedText>
          </Pressable>
        </View>
        {/* An agent was just added: it is current now; keep it, or go back. */}
        {state.addedAgent && state.addedAgent.added === link.vtaDid ? (
          <View style={[styles.card, styles.tip]} testID={testIdWithKey('AgentAddedCard')}>
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
              testID={testIdWithKey('AgentAddedUse')}
            />
            <Button
              title={t('VtaLink.AddedKeep', {
                agent: nameOf(state.addedAgent.from),
                interpolation: { escapeValue: false },
              })}
              buttonType={ButtonType.Secondary}
              onPress={() => agent && state.addedAgent && void vtaAgent.useAgent(agent, state.addedAgent.from)}
              testID={testIdWithKey('AgentAddedKeep')}
            />
          </View>
        ) : null}
        {/* Something waits on the person: said on every segment, and one tap
            from where it is decided (IN-20c). */}
        {pendingApprovals > 0 ? (
          <Pressable
            style={[styles.card, styles.row]}
            onPress={() => go(Screens.VtaRequests)}
            accessibilityRole="button"
            testID={testIdWithKey('AgentApprovalBanner')}
          >
            <Icon name="bell-ring-outline" size={22} color={ColorPalette.brand.primary} />
            <ThemedText variant="bold" style={{ flex: 1 }}>
              {t('VtaLink.ApprovalsWaiting', { count: pendingApprovals })}
            </ThemedText>
            <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
          </Pressable>
        ) : null}
        {/* One next step, only when there is one: an invitation waiting, else
            a vetting to continue. A request to decide has the banner above. */}
        {nextStep ? (
          <View style={[styles.card, styles.tip]} testID={testIdWithKey('AgentNextStep')}>
            <ThemedText variant="labelTitle" style={styles.muted}>
              {t('VtaLink.NextStep')}
            </ThemedText>
            <ThemedText variant="bold" testID={testIdWithKey('AgentNextStepText')}>
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
              testID={testIdWithKey(nextStep.kind === 'invitation' ? 'AgentNextInvitation' : 'AgentContinueVetting')}
            />
          </View>
        ) : null}
        <DevicesCard onPress={() => go(Screens.VtaDevices)} />
        {/* Three places, always the same three (IN-20c). Devices stay above
            them, in reach from every one. */}
        <View
          style={[styles.segments, segmentsStacked ? styles.segmentsStacked : undefined]}
          accessibilityRole="tablist"
          testID={testIdWithKey('AgentSegments')}
        >
          {(['communities', 'manage', 'status'] as const).map((key) => (
            <Pressable
              key={key}
              style={[
                styles.segment,
                segmentsStacked ? styles.segmentInStack : undefined,
                segment === key ? styles.segmentOn : undefined,
              ]}
              onPress={() => chooseSegment(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: segment === key }}
              testID={testIdWithKey(`AgentSegment_${key}`)}
            >
              <ThemedText
                variant="bold"
                style={segment === key ? styles.segmentOnText : styles.muted}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={SEGMENT_MIN_SCALE}
                testID={testIdWithKey(`AgentSegmentLabel_${key}`)}
              >
                {t(SEGMENT_LABEL[key])}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        {segment === 'communities' ? (
          <>
            {/* The vetter role is news, not a step: it shows when an admin grants
                it. The desk opens from the community's card below — one button,
                not the same one twice on a vetter's page. */}
            {holdings?.vetterFor.map((communityDid) => (
              <View key={communityDid} style={[styles.card, styles.tip]} testID={testIdWithKey('AgentVetterCard')}>
                <ThemedText variant="bold">
                  {t('VtaLink.YouCanVet', {
                    community: communityHeadingOf(communityDid, t),
                    interpolation: { escapeValue: false },
                  })}
                </ThemedText>
                <ThemedText style={styles.muted}>{t('VtaLink.YouCanVetBody')}</ThemedText>
              </View>
            ))}
            {!isVetter && lapsed.length > 0 ? (
              <View style={styles.card}>
                {lapsed.map(({ communityDid, grant }) => (
                  <ThemedText key={communityDid} style={styles.muted} testID={testIdWithKey('AgentVetterLapsed')}>
                    {lapsedText(communityDid, grant)}
                  </ThemedText>
                ))}
              </View>
            ) : null}

            {/* Start from what the person wants: two doors, one marked as next. */}
            <View style={styles.card} testID={testIdWithKey('AgentDoors')}>
              {/* Each community opens from its row in "what your agent holds"; a
              member meets only the doors here. */}
              {!isMember ? (
                <ThemedText variant="headingFour" accessibilityRole="header">
                  {t('VtaLink.WhatBringsYou')}
                </ThemedText>
              ) : null}
              <Pressable
                style={[styles.door, isMember ? undefined : styles.doorNext]}
                onPress={() => go(Screens.VtiInvited)}
                accessibilityRole="button"
                testID={testIdWithKey('AgentInvited')}
              >
                <Icon name="email-open-outline" size={24} color={ColorPalette.brand.primary} />
                <View style={{ flex: 1 }}>
                  <ThemedText variant="bold">{t('VtaLink.IWasInvited')}</ThemedText>
                  {/* An invitation that has already arrived says so here, named,
                  rather than being listed on a separate screen — the door
                  behind this is what knows how to accept one. */}
                  {holdings?.invited?.length ? (
                    <ThemedText testID={testIdWithKey('AgentInvitationWaiting')}>
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
                style={[styles.door, isMember ? undefined : styles.doorNext]}
                onPress={() => {
                  // From the beginning: which community, not the last one a link opened.
                  communityTarget.clearViewing()
                  go(Screens.VtiJoin)
                }}
                accessibilityRole="button"
                testID={testIdWithKey('AgentJoinCommunity')}
              >
                <Icon name="account-group-outline" size={24} color={ColorPalette.brand.primary} />
                <View style={{ flex: 1 }}>
                  <ThemedText variant="bold">
                    {isMember ? t('VtaLink.JoinAnother') : t('VtaLink.WantToJoin')}
                  </ThemedText>
                  <ThemedText style={styles.muted}>{t('VtaLink.WantToJoinHint')}</ThemedText>
                </View>
                <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
              </Pressable>
            </View>

            <View style={styles.card} testID={testIdWithKey('AgentHolds')}>
              <ThemedText variant="labelTitle">{t('VtaLink.Holds')}</ThemedText>
              {!holdings ? (
                <ActivityIndicator color={ColorPalette.brand.primary} />
              ) : communitiesHeld(holdings).length === 0 ? (
                <ThemedText style={styles.muted}>{t('VtaLink.HoldsNothing')}</ThemedText>
              ) : (
                // One card per community, with what the agent holds for it under
                // it and at most one next step (IN-20c).
                communitiesHeld(holdings).map((communityDid) => (
                  <CommunityCard
                    key={communityDid}
                    agent={agent}
                    communityDid={communityDid}
                    persona={holdings.personas.find((p) => p.communityDid === communityDid)}
                    membership={holdings.memberships.find((m) => m.communityDid === communityDid)}
                    invited={holdings.invited.includes(communityDid)}
                    vetter={holdings.vetterFor.includes(communityDid)}
                    linkedAt={link.linkedAt}
                    onOpen={goToCommunity}
                    onNextStep={onCardStep}
                    onPrimary={(action, did) => {
                      // The vetting and invitation screens work on the chosen community.
                      communityTarget.choose(did)
                      go(action === 'acceptInvitation' ? Screens.VtiInvited : Screens.VtiVetting)
                    }}
                  />
                ))
              )}
              {holdingsError ? (
                <ThemedText style={styles.muted} testID={testIdWithKey('AgentHoldsStale')}>
                  {t('VtaLink.HoldsStale')}
                </ThemedText>
              ) : null}
            </View>
          </>
        ) : null}
        {segment === 'manage' ? (
          <>
            {/* What waits for the person's decision has its own screen (Requests);
            this row is the way to it from here, and is always there, so a
            person learns where requests are before one arrives. */}
            <Pressable
              style={[styles.card, styles.row]}
              onPress={() => go(Screens.VtaRequests)}
              accessibilityRole="button"
              testID={testIdWithKey('AgentRequestsRow')}
            >
              <View style={{ flex: 1 }}>
                <ThemedText variant="bold">{t('Requests.Row')}</ThemedText>
                <ThemedText style={styles.muted} testID={testIdWithKey('AgentRequestsRowCount')}>
                  {pendingApprovals > 0 ? t('Requests.RowWaiting', { count: pendingApprovals }) : t('Requests.RowNone')}
                </ThemedText>
              </View>
              <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
            </Pressable>
            {/* Requests arrive only for what the agent has a rule on. */}
            <Pressable
              style={[styles.card, styles.row]}
              onPress={() => go(Screens.VtaAskMe)}
              accessibilityRole="button"
              testID={testIdWithKey('AgentAskMeRow')}
            >
              <View style={{ flex: 1 }}>
                <ThemedText variant="bold">{t('Requests.AskMeRow')}</ThemedText>
                <ThemedText style={styles.muted}>{t('Requests.AskMeRowHint')}</ThemedText>
              </View>
              <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
            </Pressable>
            {/* A task of this phone's that waits on someone else's consent:
            not a decision for this person, so it stays here. */}
            {state.awaitingConsentFor ? (
              <View style={[styles.card, styles.row]}>
                <ActivityIndicator color={ColorPalette.brand.primary} />
                <ThemedText style={{ flex: 1 }} testID={testIdWithKey('AgentAwaitingConsent')}>
                  {t('MyAgent.AwaitingConsent', {
                    task: shortTask(state.awaitingConsentFor),
                    interpolation: { escapeValue: false },
                  })}
                </ThemedText>
              </View>
            ) : null}

            {/* The cards the agent keeps, back on this phone (226). */}
            {agent && holdings ? <GetCardsFromAgent agent={agent} personas={holdings.personas} /> : null}

            <Button
              title={t('VtaLink.Unlink')}
              buttonType={ButtonType.Tertiary}
              onPress={() => setUnlinkOpen(true)}
              testID={testIdWithKey('AgentUnlink')}
            />
            {unlinkOpen ? (
              <View style={styles.card} testID={testIdWithKey('AgentUnlinkCard')}>
                <ThemedText variant="labelTitle" accessibilityRole="header" testID={testIdWithKey('AgentUnlinkTitle')}>
                  {t('VtaLink.UnlinkTitle', {
                    agent: agentDisplayName(withAgentName(link, state.agentNames), t),
                    interpolation: { escapeValue: false },
                  })}
                </ThemedText>
                <ThemedText testID={testIdWithKey('AgentUnlinkBody')}>
                  {t(link.connection.kind === 'gone' ? 'VtaLink.UnlinkBodyGone' : 'VtaLink.UnlinkBody')}
                </ThemedText>
                {otherAgents.length > 0 ? (
                  <ThemedText testID={testIdWithKey('AgentUnlinkNext')}>
                    {t('VtaLink.UnlinkNext', {
                      agent: nameOf(otherAgents[0].vtaDid),
                      interpolation: { escapeValue: false },
                    })}
                  </ThemedText>
                ) : null}
                <Button
                  title={t('VtaLink.UnlinkConfirm')}
                  buttonType={ButtonType.Critical}
                  onPress={unlink}
                  testID={testIdWithKey('AgentUnlinkConfirm')}
                />
                <Button
                  title={t('Global.Cancel')}
                  buttonType={ButtonType.Secondary}
                  onPress={() => setUnlinkOpen(false)}
                  testID={testIdWithKey('AgentUnlinkCancel')}
                />
              </View>
            ) : null}
          </>
        ) : null}
        {segment === 'status' ? (
          <>
            <View style={styles.card} testID={testIdWithKey('AgentActivity')}>
              <ThemedText variant="labelTitle">{t('VtaLink.Did')}</ThemedText>
              {state.activity.length === 0 ? (
                <ThemedText style={styles.muted}>{t('VtaLink.DidNothing')}</ThemedText>
              ) : (
                state.activity.slice(0, 6).map((a) => (
                  <ThemedText key={`${a.at}-${a.kind}`}>
                    {new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {activityText(a)}
                  </ThemedText>
                ))
              )}
            </View>

            <View style={styles.card}>
              <Pressable
                style={styles.row}
                onPress={() => setDetailsOpen(!detailsOpen)}
                accessibilityRole="button"
                accessibilityState={{ expanded: detailsOpen }}
                testID={testIdWithKey('AgentDetailsToggle')}
              >
                <Icon name={detailsOpen ? 'chevron-down' : 'chevron-right'} size={20} color={TextTheme.normal.color} />
                <ThemedText variant="labelTitle">{t('VtaLink.Details')}</ThemedText>
              </Pressable>
              {detailsOpen ? (
                <View testID={testIdWithKey('AgentDetails')}>
                  <ThemedText style={styles.muted}>{t('VtaLink.DetailsAgent')}</ThemedText>
                  <ThemedText style={styles.mono} selectable>
                    {link.vtaDid}
                  </ThemedText>
                  <ThemedText style={styles.muted}>{t('VtaLink.DetailsPhoneKey')}</ThemedText>
                  <ThemedText style={styles.mono} selectable>
                    {state.managerDid ?? '—'}
                  </ThemedText>
                  <ThemedText style={styles.muted}>{t('VtaLink.DetailsLinkedAt')}</ThemedText>
                  <ThemedText>{new Date(link.linkedAt).toLocaleString()}</ThemedText>
                </View>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

export default VtaAgentHome
