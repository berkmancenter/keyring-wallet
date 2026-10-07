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
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native'
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { GenericRecordsCommunityStore, isCurrentMembership, type VtiMembership } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from '../module/VtiIdentityStore'
import { vtaAgent } from '../module/vtaAgent'
import { ownVetterGrantState, type VetterGrantState } from '../module/vtiGrantState'
import { useCommunityChanged } from '../module/communityChanged'
import { communityTarget } from '../module/vtiCommunityLink'

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
import type { CommunityCardPrimary } from './communityCardModel'
import { communityHeadingOf, communityLabelOf } from './communityName'
import { communityCardKey as communityKeyOf } from './CommunityCard'
import { useVtaLinkWithClock, VtaStatusLine } from './VtaStatus'
import { useRoomAboveTabBar } from './aboveTabBar'

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
/** How long a community just joined stays picked out on its card. */
export const HIGHLIGHT_MS = 4000
/** The page's padding, and the first card's: the agent chips run out past both to the screen's edges. */
const PAGE_PADDING = 20
const CARD_PADDING = 16

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
}

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
  const [introPanel, setIntroPanel] = useState(0)
  const otherWaiting = useOtherAgentsWaiting()
  const [cardSteps, setCardSteps] = useState<Record<string, CommunityCardPrimary | undefined>>({})
  const onCardStep = useCallback((communityDid: string, primary: CommunityCardPrimary | undefined) => {
    setCardSteps((prev) => (prev[communityDid] === primary ? prev : { ...prev, [communityDid]: primary }))
  }, [])

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
  // "Add" on the chips leaves the current agent, then opens the link screen:
  // in between this page is unlinked, and for an instant it drew "Link your
  // agent" (238, iPhone). Nothing is drawn while it goes; back here, as ever.
  const [leavingToAdd, setLeavingToAdd] = useState(false)
  useEffect(() => {
    if (isFocused) setLeavingToAdd(false)
  }, [isFocused])
  // Back on this page with an "Add" still open and nothing under way (it
  // failed, or the person left by a way that did not close it): the add is
  // given up and the agent before comes back, rather than "Link your agent"
  // until a restart (IN-138). Only on arriving here: pressing Add on this
  // page does not count.
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
      headerRight: () => <AgentSettingsButton onPress={() => go(Screens.VtaAgentSettings)} />,
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

  if (link.kind !== 'linked' && leavingToAdd) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']} testID={testIdWithKey('AgentHomeLeaving')} />
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
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        {/* The words and their buttons, centred together between the header
            and the tab bar. The tab bar sits below the screen, not over it,
            so no room is kept for it here; with that room the panel sat
            high (238, iPhone). */}
        <View style={{ flex: 1, justifyContent: 'center', padding: 20, gap: 16 }} testID={testIdWithKey('AgentIntro')}>
          <ThemedText variant="headingTwo" accessibilityRole="header">
            {t(`VtaLink.${INTRO_PANELS[introPanel]}Title`)}
          </ThemedText>
          <ThemedText>{t(`VtaLink.${INTRO_PANELS[introPanel]}Body`)}</ThemedText>
          <ThemedText style={styles.muted}>
            {t('VtaLink.IntroStep', { n: introPanel + 1, of: INTRO_PANELS.length })}
          </ThemedText>
          <View style={{ gap: 16, marginTop: 8 }} testID={testIdWithKey('AgentIntroButtons')}>
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

  const doorsCard = (
    <View style={styles.card} testID={testIdWithKey('AgentDoors')}>
      {/* Before joining, the two ways in lead the page; after, they are the
          header's Join menu. */}
      <ThemedText variant="labelTitle" accessibilityRole="header">
        {t('VtaLink.WhatBringsYou')}
      </ThemedText>
      <Pressable
        style={[styles.door, styles.doorNext]}
        onPress={() => go(Screens.VtiInvited)}
        accessibilityRole="button"
        testID={testIdWithKey('AgentInvited')}
      >
        <Icon name="email-open-outline" size={24} color={ColorPalette.brand.primary} />
        <View style={{ flex: 1 }}>
          <ThemedText variant="bold">{t('VtaLink.IWasInvited')}</ThemedText>
          {/* An invitation that has already arrived says so here, named. */}
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
        style={[styles.door, styles.doorNext]}
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
        testID={testIdWithKey('AgentHome')}
      >
        <View style={styles.card}>
          {/* The header says "Your agent"; this card says which, and switches. */}
          <ThemedText
            variant="labelTitle"
            style={styles.muted}
            accessibilityRole="header"
            testID={testIdWithKey('AgentHomeTitle')}
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
              setLeavingToAdd(true)
              void vtaAgent.startAddingAgent().then(() => go(Screens.VtaLink))
            }}
          />
          <VtaStatusLine connection={link.connection} now={now} />
          {/* Replies have stopped reaching this phone (VtaClient's breaker): it is
              catching up, and asks wait a few minutes rather than fail one by one. */}
          {state.repliesStalled && link.connection.kind !== 'gone' ? (
            <ThemedText style={styles.muted} testID={testIdWithKey('AgentCatchingUp')}>
              {t('VtaLink.CatchingUp')}
            </ThemedText>
          ) : null}
          {link.connection.kind === 'gone' ? (
            // Gone for good (agentGone.ts): said plainly, with the way on — a new agent.
            // Unlinking is still confirmed, in Agent settings, with words for an agent that is gone.
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
                onPress={() =>
                  (navigation as unknown as { navigate: (name: string, params: object) => void }).navigate(
                    Screens.VtaAgentSettings,
                    { unlink: true }
                  )
                }
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
          {/* What this phone is here, in one line and one place: member,
              vetter, applicant, or none of those yet. Only once what the agent
              holds has been read, so a reader can trust the cards below. */}
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
              first membership; after that a status line says where this agent
              stands (233). */}
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

        {/* A vetter's desk, at the top, one tap away: it sat in a community's
            card further down, under a scroll (Alberto, 10-06). */}
        {holdings?.vetterFor.map((communityDid) => (
          <View key={communityDid} style={[styles.card, styles.tip]} testID={testIdWithKey('AgentVetterCard')}>
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
                holdings.vetterFor.length > 1 ? `AgentOpenDesk_${communityKeyOf(communityDid)}` : 'AgentOpenDesk'
              )}
            />
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

        {/* One next step, only when there is one: an invitation waiting, else
            a vetting to continue. */}
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

        {/* Before joining, the two ways in lead; after, one row at the page's end. */}
        {!isMember ? (
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
        <View style={styles.card} testID={testIdWithKey('AgentHolds')}>
          <ThemedText variant="labelTitle" accessibilityRole="header">
            {t('VtaLink.Holds')}
          </ThemedText>
          {!holdings ? (
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
                testID={communityDid === highlighted ? testIdWithKey('AgentCommunityHighlighted') : undefined}
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
                  onNextStep={onCardStep}
                  onPrimary={(action, did) => {
                    // The vetting and invitation screens work on the chosen community.
                    communityTarget.choose(did)
                    go(action === 'acceptInvitation' ? Screens.VtiInvited : Screens.VtiVetting)
                  }}
                />
              </View>
            ))
          )}
          {holdingsError ? (
            <ThemedText style={styles.muted} testID={testIdWithKey('AgentHoldsStale')}>
              {t('VtaLink.HoldsStale')}
            </ThemedText>
          ) : null}
        </View>

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
              testID={testIdWithKey('AgentJoinAnother')}
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
