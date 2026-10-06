/**
 * "I want to join a community" — Door 2 of the redesigned journey (UI/UX plan,
 * "After You Link"). It starts from what the person wants and hides the
 * technical steps:
 *
 *   Which community (from a scanned or pasted link, else the build's
 *   suggestion) → what it asks for → your identity for it (one Face ID) →
 *   the vetting screen, at the ticket.
 *
 * The same order as the OpenVTC TUI: the community, its requirements, the
 * identity it will know you as, then the application. The identity is made
 * before the ticket because the vetter's desk checks the ticket against it.
 *
 * @module trust-tasks/screens/VtiJoin
 */

import { useAgent } from '@bifold/react-hooks'
import { useIsFocused, useNavigation } from '@react-navigation/native'
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { requestBiometricConfirmationWithUI } from '../../vrc/vrc-biometric'
import { joinAsks, type JoinAsks, type JoinHolds } from '../module/joinManifest'
import { GenericRecordsCommunityStore } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore } from '../module/VtiIdentityStore'
import { isUnsupportedJoinVersion, joinRequestRefusal, vtiAgent, type VtiManifest } from '../module/vtiAgent'
import { communityTarget } from '../module/vtiCommunityLink'
import { useCommunityChanged } from '../module/communityChanged'
import { ensurePersonaFor, joinCommunity, readJoinState, type CommunityJoinState } from '../module/vtiJoin'
import { joinSeed } from '../module/vtiJoinSeed'

import { communityName, didPathName, unnamedCommunityLabel } from './communityName'
import { openScanner } from './openScanner'
import { plainError, type PlainError } from './plainError'
import { claimWords, joinNeedWords } from './claimWords'
import { DidDetails } from './DidDetails'
import { JoinAs, useJoinAsChoice } from './JoinAs'
import { readJoinHolds } from './joinHolds'
import { joinCard } from './joinWays'
import { JoinWaysCard } from './JoinWaysCard'
import { JoinWithAgent, useAgentsHoldingIdentity } from './JoinWithAgent'
import { useCommunity } from './useCommunity'
import { useVtaDid } from './VtaStatus'

/**
 * An identity in a word a person can say out loud: the last word of its DID's
 * path ("…term-benefit"), else its last characters. What an operator matches
 * in the community's join requests.
 */
export const identityWord = (did: string): string => `…${didPathName(did) ?? did.slice(-8)}`
import { useTakingLong } from './useTakingLong'
import { useRoomAboveTabBar } from './aboveTabBar'

type Step = 'which' | 'asks' | 'as'

/** What a community asks for, in words, from its published criteria. */
export interface Asks {
  /**
   * vetting: statements from its vetters. invitation: only an invitation
   * admits. other: credentials the app cannot describe further (their
   * descriptions are shown). open: nothing — a community cannot publish
   * that yet (upstream KR-13), but the screen must not guess otherwise.
   */
  kind: 'vetting' | 'invitation' | 'other' | 'open'
  /** Statements from its vetters the person needs, when it vets. */
  statements?: number
  /** Claims a vetter checks ("name.legal"). */
  claims: string[]
  /** The criteria's own descriptions, for `other`. */
  descriptions: string[]
  /** It admits only by invitation. */
  invitationOnly: boolean
  /**
   * An invitation alone admits: a criterion is about an invitation and NO
   * criterion vets. Upstream, any published vetting criterion makes vetting
   * mandatory for every applicant — "neither an invitation nor a trusted
   * credential bypasses" it (join.rego), and the applicant's digest cannot
   * choose the invitation criterion instead — so a community that vets at all
   * answers an invitation with request_more (keyring-test-vtc, 220). Where
   * that is so, nothing may suggest the invitation is enough.
   */
  invitationAdmits: boolean
}

const INVITATION = /invit/i

/** What a new identity holds towards a community: nothing yet. */
const NOTHING_HELD: JoinHolds = {}

export function asksFrom(manifest: VtiManifest): Asks {
  const criteria = manifest.criteria
  const invitationAdmits =
    !criteria.some((c) => c.vetting) && criteria.some((c) => INVITATION.test(`${c.id ?? ''} ${c.description ?? ''}`))
  const vetting = criteria.map((c) => c.vetting).find(Boolean)
  if (vetting) {
    return {
      kind: 'vetting',
      statements: vetting.minStatements ?? 1,
      claims: vetting.requiredClaims ?? [],
      descriptions: [],
      invitationOnly: false,
      invitationAdmits,
    }
  }
  if (criteria.length === 0)
    return { kind: 'open', claims: [], descriptions: [], invitationOnly: false, invitationAdmits: false }
  // Invitation-only only when every criterion is about an invitation; any
  // other criterion is something the person may be able to present.
  if (criteria.every((c) => INVITATION.test(`${c.id ?? ''} ${c.description ?? ''}`))) {
    return { kind: 'invitation', claims: [], descriptions: [], invitationOnly: true, invitationAdmits: true }
  }
  const descriptions = criteria
    .filter((c) => !INVITATION.test(`${c.id ?? ''} ${c.description ?? ''}`))
    .map((c) => c.description ?? c.id ?? '')
    .filter(Boolean)
  return { kind: 'other', claims: [], descriptions, invitationOnly: false, invitationAdmits }
}

export interface VtiJoinProps {
  config?: { mediatorDid?: string; communityDid?: string; vtaDid?: string }
}

const VtiJoin: React.FC<VtiJoinProps> = ({ config }) => {
  // The tab bar draws over the page: the last line scrolls clear of it.
  const roomAboveTabBar = useRoomAboveTabBar()
  const { t } = useTranslation()
  const { agent } = useAgent()
  const navigation = useNavigation()
  const { ColorPalette } = useTheme()
  const vtaDid = useVtaDid(config?.vtaDid)
  const community = useCommunity(config?.communityDid)
  const chosenByLink = useSyncExternalStore(communityTarget.subscribe, communityTarget.getViewing)
  const chosenBefore = useSyncExternalStore(communityTarget.subscribe, communityTarget.getChosen)
  const communityDid = community?.communityDid
  // What to call it, and how much to claim for that name (see communityName).
  const called = communityName(communityDid ?? '', community)
  // The phone remembers a community it joined; the build merely suggests one.
  const remembered = Boolean(communityDid && chosenBefore?.communityDid === communityDid)
  // In a sentence, an unnamed community is said to be one — never its host,
  // which communities share (communityName).
  const name = called.name ?? unnamedCommunityLabel(communityDid ?? '', t)

  // A community named by a link goes straight to what it asks; the build's
  // suggestion is offered first, beside "a different community".
  const [step, setStep] = useState<Step>(chosenByLink ? 'asks' : 'which')
  const [asks, setAsks] = useState<Asks>()
  // From manifest 0.3 the community states its ways in and what follows each
  // (joinWays.ts); at 0.2 this reads as `legacy` and `asks` above is shown.
  const [manifest, setManifest] = useState<VtiManifest>()
  const [holds, setHolds] = useState<JoinHolds>({})
  // The community answers no join version this app speaks.
  const [unsupported, setUnsupported] = useState<string>()
  // A request was refused because the community changed what it asks meanwhile.
  const [changed, setChanged] = useState(false)
  const [reread, setReread] = useState(0)
  // Where the person already stands with this community (220): what the phone
  // holds, at once, then what the community says while a request is open. It
  // used to say only "You joined this one before", whatever had happened since.
  const [standing, setStanding] = useState<CommunityJoinState>()
  const holding = useAgentsHoldingIdentity(communityDid)
  const [checking, setChecking] = useState(false)
  // "Join again" was chosen: the next identity for this community is a new one.
  const [again, setAgain] = useState(false)
  // Which community's manifest has been read (or failed to be): until then a
  // missing name means "not known yet", not "none published".
  const [nameRead, setNameRead] = useState<string>()
  // Which community could not be read at all — for one the phone remembers, worth saying.
  const [unreachable, setUnreachable] = useState<string>()
  const [busy, setBusy] = useState(false)
  const preparingLong = useTakingLong(busy)
  const [error, setError] = useState<PlainError>()
  const [errorOpen, setErrorOpen] = useState(false)
  const joinAs = useJoinAsChoice(navigation)

  useEffect(() => {
    if (chosenByLink) setStep((s) => (s === 'which' ? 'asks' : s))
  }, [chosenByLink])

  // The community's own words: what it asks, and what it calls itself. Read as
  // soon as there is a community, not only on "what it asks" — the suggestion
  // card comes first, and a fresh phone showed a community that publishes a
  // name as having none, because nothing had read it yet (Farm gate,
  // 2026-09-23; the same shape as report #16).
  useEffect(() => {
    if (!communityDid) return
    let live = true
    setAsks(undefined)
    setManifest(undefined)
    setUnsupported(undefined)
    // No session needed: a community answers the join manifest over REST, which
    // is how an applicant reads what is asked of them before any channel
    // exists. Guarding this on `connected` is why a community's published name
    // never reached this screen while the community screen had it (report #16).
    vtiAgent
      // With this screen's agent: a fresh phone has no session to lend one.
      .fetchManifest(communityDid, agent)
      // Reading the manifest also teaches the app what the community calls
      // itself; vtiAgent does that for every fetch, so nothing is needed here.
      .then(async (m) => {
        const held = agent ? await readJoinHolds(agent, communityDid).catch(() => ({})) : {}
        if (!live) return
        setAsks(asksFrom(m))
        setHolds(held)
        setManifest(m)
      })
      .catch((e) => {
        if (!live) return
        // Reached, but it speaks no join version this app does: not "unreachable".
        if (isUnsupportedJoinVersion(e)) setUnsupported(communityDid)
        else setUnreachable(communityDid)
      })
      .finally(() => live && setNameRead(communityDid))
    return () => {
      live = false
    }
  }, [communityDid, agent, reread])

  // A different community starts from nothing; the same one keeps what it showed.
  useEffect(() => {
    setStanding(undefined)
    setAgain(false)
    setChanged(false)
    setPlainRequest(false)
  }, [communityDid])

  // What the card shows at 0.3: each way, the one this phone meets, the button.
  // After "Join again" the request goes out under a new identity, which holds
  // nothing yet: what the earlier one gathered (statements, an invitation to
  // it) does not meet a way for it. Read as held, a removed member was offered
  // "Join", admitted straight away, for a request that carried nothing (IN-104).
  const heldNow = again ? NOTHING_HELD : holds
  const offer = useMemo<JoinAsks | undefined>(
    () => (manifest ? joinAsks(manifest, heldNow) : undefined),
    [manifest, heldNow]
  )
  const card = offer ? joinCard(offer, heldNow) : undefined
  const ways = card?.mode === 'ways' ? card : undefined
  // A request this screen sends itself: a way the phone meets that needs no
  // invitation (those go through "I was invited"). Chosen by the button the
  // person pressed, since a card can offer vetting and asking side by side.
  const [plainRequest, setPlainRequest] = useState(false)

  // Read each time the screen comes into view, not only when it first mounts:
  // a join finished elsewhere (the invited screen, the vetting) shows here.
  const focused = useIsFocused()
  useEffect(() => {
    if (!agent || !communityDid || !focused) return
    let live = true
    void (async () => {
      const held = await readJoinState(agent, communityDid, { poll: false })
      if (live) setStanding(held)
      if (held.kind === 'sent' || held.kind === 'pending' || held.kind === 'deferred') {
        const asked = await readJoinState(agent, communityDid, { mediatorDid: config?.mediatorDid })
        if (live) setStanding(asked)
      }
    })()
    return () => {
      live = false
    }
  }, [agent, communityDid, config?.mediatorDid, focused])

  // And whenever this phone stores something about the community, at once.
  const rereadHeld = useCallback(() => {
    if (!agent || !communityDid) return
    void readJoinState(agent, communityDid, { poll: false })
      .then(setStanding)
      .catch(() => undefined)
  }, [agent, communityDid])
  useCommunityChanged(rereadHeld, communityDid)

  const onCheckAgain = useCallback(async () => {
    if (!agent || !communityDid) return
    setChecking(true)
    try {
      setStanding(await readJoinState(agent, communityDid, { mediatorDid: config?.mediatorDid }))
    } finally {
      setChecking(false)
    }
  }, [agent, communityDid, config?.mediatorDid])

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { flexGrow: 1, padding: 20, gap: 16 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    actions: { padding: 20, gap: 12 },
    errorDetail: { maxHeight: 160 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    error: { color: ColorPalette.semantic.error },
  })

  const onJoinAs = useCallback(async () => {
    if (!agent || !vtaDid || !communityDid) return
    setError(undefined)
    setErrorOpen(false)
    const confirmed = await requestBiometricConfirmationWithUI(agent, name, 'join', {
      title: t('Join.ConfirmTitle'),
      description: t('Join.ConfirmBody', { community: name, interpolation: { escapeValue: false } }),
    })
    if (!confirmed.success) return
    setBusy(true)
    try {
      if (plainRequest) {
        // The way the phone meets asks for nothing more: make the identity and
        // send the request. What the community answers shows as where the
        // person stands — admitted, or waiting for an administrator.
        communityTarget.choose(communityDid)
        if (joinAs.selected) joinSeed.set(communityDid, joinAs.selected.seed)
        await joinCommunity(
          {
            agent,
            identityStore: new GenericRecordsIdentityStore(agent),
            communityStore: new GenericRecordsCommunityStore(agent),
            vtaDid,
            mediatorDid: config?.mediatorDid,
            communityDid,
          },
          undefined,
          { freshPersona: again }
        )
        setAgain(false)
        setStanding(await readJoinState(agent, communityDid, { poll: false }))
        setStep('asks')
        return
      }
      await ensurePersonaFor(
        { agent, identityStore: new GenericRecordsIdentityStore(agent), vtaDid, communityDid },
        { fresh: again }
      )
      // Making the identity is what makes this the phone's community.
      communityTarget.choose(communityDid)
      // Seed by copy: the chosen profile fills the identity's name in once.
      if (joinAs.selected) joinSeed.set(communityDid, joinAs.selected.seed)
      const stack = navigation as unknown as { navigate: (name: string) => void }
      stack.navigate(Screens.VtiVetting)
    } catch (e) {
      if (joinRequestRefusal(e) === 'criterionUnknown') {
        // The community changed what it asks while the request went: read it
        // again and show it, rather than leave the person on a dead step.
        setChanged(true)
        setReread((n) => n + 1)
        setStep('asks')
      } else if (plainRequest && e instanceof Error && e.name === 'VtiSentNoAnswer') {
        // The request went; its answer did not come in time. Not a failure to
        // fix with Continue: show where the request stands, asking the
        // community now (its status task finds the request from the identity),
        // and a late answer, if it comes, shows there too (7b's R5, 10-06:
        // the screen sat on "hasn't answered yet" for four minutes).
        setAgain(false)
        setStanding(await readJoinState(agent, communityDid, { mediatorDid: config?.mediatorDid }))
        setStep('asks')
      } else {
        setError(plainError(e))
      }
    } finally {
      setBusy(false)
    }
  }, [agent, vtaDid, communityDid, name, navigation, t, joinAs.selected, again, plainRequest, config?.mediatorDid])

  if (!vtaDid) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.content}>
          <ThemedText testID={testIdWithKey('JoinNeedsAgent')}>{t('Join.NeedsAgent')}</ThemedText>
          {/* The way to it, as "I was invited" offers: a community's code can
              arrive before any agent is linked (the phone's camera, a link).
              The community stays chosen for when the person comes back. */}
          <Button
            title={t('VtaLink.LinkYourAgent')}
            buttonType={ButtonType.Primary}
            onPress={() => (navigation as unknown as { navigate: (name: string) => void }).navigate(Screens.VtaLink)}
            testID={testIdWithKey('JoinLinkAgent')}
          />
        </View>
      </SafeAreaView>
    )
  }

  // A failure says what happened and what to do; the original text — module
  // prefixes, task URIs and all — stays under Details, where it is worth
  // something to whoever reads the report (report #17).
  // It sits in the actions, above the button that failed, so it cannot fall
  // below the fold (221).
  const errorLine = error ? (
    <View style={styles.card} testID={testIdWithKey('JoinErrorCard')}>
      <ThemedText style={styles.error} testID={testIdWithKey('JoinError')}>
        {t(error.line)}
      </ThemedText>
      <Pressable
        onPress={() => setErrorOpen((open) => !open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: errorOpen }}
        testID={testIdWithKey('JoinErrorDetailsToggle')}
      >
        <ThemedText style={styles.muted}>{t('Errors.ShowDetails')}</ThemedText>
      </Pressable>
      {errorOpen ? (
        <ScrollView style={styles.errorDetail}>
          <ThemedText style={styles.muted} selectable testID={testIdWithKey('JoinErrorDetail')}>
            {error.detail}
          </ThemedText>
        </ScrollView>
      ) : null}
    </View>
  ) : null

  // What the community asks, as one sentence: the card's accessibility label.
  const asksSentence = (() => {
    if (asks?.invitationOnly) return t('Join.AsksInvitationOnly')
    if (asks?.kind === 'open') return t('Join.AsksNothing')
    if (asks?.kind === 'other') return [t('Join.AsksOther'), ...asks.descriptions].join(' ')
    const claims = (asks ? asks.claims : ['name.legal']).map((c) =>
      c === 'name.legal' ? t('Join.AsksLegalName') : claimWords(c, t)
    )
    return [t('Join.AsksStatements', { count: asks?.statements ?? 1 }), ...claims].join('. ')
  })()

  let body: React.ReactNode
  let actions: React.ReactNode
  // Whether "A different community" is already in the body (the ways card has it).
  let differentInBody = false
  const current: Step = !communityDid ? 'which' : step
  const mayJoinAgain =
    standing?.kind === 'rejected' ||
    standing?.kind === 'withdrawn' ||
    standing?.kind === 'left' ||
    standing?.kind === 'removed'
  // Where the person stands overrides the way in, except once "Join again" is
  // chosen — and except when that standing is another agent's: with several
  // agents, a membership or request held by an identity of another agent is
  // not the current agent's, and Join offers that agent instead (#280 device
  // check: on B it said "You're a member", which only A was).
  const standingShown = Boolean(
    communityDid &&
      standing &&
      standing.kind !== 'none' &&
      current !== 'as' &&
      !(again && mayJoinAgain) &&
      !holding.onlyOthers
  )

  switch (current) {
    case 'which':
      body = (
        <>
          <ThemedText variant="headingThree" accessibilityRole="header">
            {t('Join.WhichTitle')}
          </ThemedText>
          <ThemedText>{t('Join.WhichBody')}</ThemedText>
          {/* The build's suggestion, said to be one. It used to offer "Join
              <hostname>", which read as the community's name when nothing had
              named it at all (tester report #14). A name is shown only when
              something actually gave one; otherwise the card says so and the
              DID's handle stands as the identifier, not as a name; the full DID
              waits behind Details. */}
          {communityDid ? (
            <View style={styles.card} testID={testIdWithKey('JoinSuggested')}>
              <View style={styles.row}>
                <Icon name="account-group-outline" size={24} color={ColorPalette.brand.primary} />
                {called.name || nameRead === communityDid ? (
                  <ThemedText variant="bold" testID={testIdWithKey('JoinSuggestedName')}>
                    {called.name ?? t('Join.Unnamed')}
                  </ThemedText>
                ) : (
                  // Not "unnamed" before the community has been asked: say it is being asked.
                  <ThemedText style={styles.muted} testID={testIdWithKey('JoinSuggestedChecking')}>
                    {t('Join.CheckingName')}
                  </ThemedText>
                )}
              </View>
              {/* Where this community came from, truthfully. It said "Suggested
                  for this app" for a community the person had joined on an
                  earlier build — telling them their software has an opinion it
                  does not have, and sending two of us hunting a configuration
                  leak that did not exist (report #23). */}
              {!standing || standing.kind === 'none' ? (
                <ThemedText style={styles.muted} testID={testIdWithKey('JoinSuggestedSource')}>
                  {remembered ? t('Join.Remembered') : t('Join.Suggested')}
                </ThemedText>
              ) : null}
              {/* A community the phone joined on an earlier build may be gone
                  (a lab that was only ever on someone's Mac). Say so beside
                  "a different community" rather than forget a real choice. */}
              {remembered && unreachable === communityDid ? (
                <ThemedText style={styles.muted} testID={testIdWithKey('JoinRememberedUnreachable')}>
                  {t('Join.RememberedUnreachable')}
                </ThemedText>
              ) : null}
              {called.name && called.claimed ? (
                <ThemedText style={styles.muted} testID={testIdWithKey('JoinNameClaimed')}>
                  {t('Join.NameFromLink')}
                </ThemedText>
              ) : null}
              <ThemedText style={styles.muted} testID={testIdWithKey('JoinSuggestedWhere')}>
                {called.technical}
              </ThemedText>
              <DidDetails did={communityDid} testIdStem="JoinSuggested" />
            </View>
          ) : null}
        </>
      )
      actions = (
        <>
          {communityDid ? (
            <Button
              title={
                called.name
                  ? t('Join.JoinThis', { community: called.name, interpolation: { escapeValue: false } })
                  : t('Join.JoinSuggested')
              }
              buttonType={ButtonType.Primary}
              onPress={() => setStep('asks')}
              testID={testIdWithKey('JoinThisCommunity')}
            />
          ) : null}
          <Button
            title={communityDid ? t('Join.Different') : t('Join.ScanLink')}
            buttonType={communityDid ? ButtonType.Secondary : ButtonType.Primary}
            onPress={() => openScanner(navigation)}
            testID={testIdWithKey('JoinScanCommunity')}
          />
        </>
      )
      break

    case 'asks': {
      const named = { community: name, interpolation: { escapeValue: false } }
      const different = (
        <Button
          title={t('Join.Different')}
          buttonType={ButtonType.Tertiary}
          onPress={() => openScanner(navigation)}
          testID={testIdWithKey('JoinScanCommunity')}
        />
      )
      const toInvited = () =>
        (navigation as unknown as { navigate: (name: string) => void }).navigate(Screens.VtiInvited)
      const waysTitle = (
        <ThemedText variant="headingThree" accessibilityRole="header" testID={testIdWithKey('JoinWaysTitle')}>
          {t('Join.Ways.Title', named)}
        </ThemedText>
      )
      // The community speaks no join version this app does: reached, but unreadable.
      if (communityDid && unsupported === communityDid) {
        body = (
          <>
            {waysTitle}
            <View style={styles.card} testID={testIdWithKey('JoinVersionUnsupported')}>
              <ThemedText>{t('Join.Ways.VersionUnsupported', named)}</ThemedText>
            </View>
          </>
        )
        actions = different
        break
      }
      // It publishes no way in: it accepts no applications at present.
      if (card?.mode === 'notAccepting') {
        body = (
          <>
            {waysTitle}
            <View style={styles.card} testID={testIdWithKey('JoinNotAccepting')}>
              <ThemedText>{t('Join.Ways.NotAccepting', named)}</ThemedText>
            </View>
            {communityDid ? <DidDetails did={communityDid} testIdStem="JoinCommunity" /> : null}
          </>
        )
        actions = different
        break
      }
      // Manifest 0.3: its ways in, and what follows each (joinWays.ts).
      if (ways) {
        const suggestedWay = offer?.suggested
        const mainButton =
          ways.button === 'invited' ? (
            <Button
              title={t('VtaLink.IWasInvited')}
              buttonType={ButtonType.Primary}
              onPress={toInvited}
              testID={testIdWithKey('JoinGoInvited')}
            />
          ) : ways.button !== 'none' ? (
            <Button
              title={
                ways.button === 'join'
                  ? t('Join.Ways.ButtonJoin', named)
                  : ways.button === 'ask'
                    ? t('Join.Ways.ButtonAsk')
                    : // Beside "Ask to join", the button names where it leads.
                      ways.alsoAsk
                      ? t('Join.Ways.ButtonVetting')
                      : t('Join.Start')
              }
              buttonType={ButtonType.Primary}
              onPress={() => {
                if (ways.button === 'start') {
                  setPlainRequest(false)
                  setStep('as')
                } else if (suggestedWay?.requires.invitation) {
                  // An invitation the phone holds is presented from "I was invited", where it is.
                  toInvited()
                } else {
                  setPlainRequest(true)
                  setStep('as')
                }
              }}
              testID={testIdWithKey('JoinStart')}
            />
          ) : null
        // The other door: the review way the phone meets as it stands.
        const askButton = ways.alsoAsk ? (
          <Button
            title={t('Join.Ways.ButtonAsk')}
            buttonType={ButtonType.Secondary}
            onPress={() => {
              setPlainRequest(true)
              setStep('as')
            }}
            testID={testIdWithKey('JoinAsk')}
          />
        ) : null
        // Two things to do: each button sits under the way it acts on, below
        // what follows that way. Both under the list made a fixed area tall
        // enough to cover the last way's lines on a phone — the line that says
        // an administrator decides among them (the Farm run of 2026-10-02).
        const vettingRow = ways.rows.find((row) => row.canStartVetting)?.id
        // One thing to do sits under its way too, so no fixed button covers the
        // last way's lines on a small phone (IN-104): "Start" under the vetting
        // way, "Join" / "Ask to join" under the way the phone meets, "I was
        // invited" under the invitation way. Below the list only when no way
        // is its own (it then stays fixed, as before).
        const mainRow =
          ways.button === 'start'
            ? vettingRow
            : ways.button === 'join' || ways.button === 'ask'
              ? ways.rows.find((row) => row.suggested)?.id
              : ways.button === 'invited'
                ? ways.rows.find((row) => row.needs.some((need) => need.kind === 'invitation'))?.id
                : undefined
        const buttonsInRows = !standingShown && (ways.alsoAsk || mainRow !== undefined)
        // A community whose ways never ask a vetter: said, so nobody looks for
        // vetting that is not there (IN-104).
        const noVetting = !ways.rows.some((row) => row.needs.some((need) => need.kind === 'vetting'))
        body = (
          <>
            {waysTitle}
            {changed ? (
              <ThemedText testID={testIdWithKey('JoinChanged')}>{t('Join.Ways.Changed', named)}</ThemedText>
            ) : null}
            <JoinWaysCard
              card={ways}
              community={name}
              readOnly={standingShown}
              // Under where the person stands (a member, a request open, a
              // removal) the ways are shown, not offered: their buttons sat in
              // the rows, out of reach of the standing card that replaces the
              // buttons below, and a removed member pressed "Meet a vetter"
              // under the old identity without "Join again" (IN-104, path B).
              rowAction={
                buttonsInRows
                  ? (row) =>
                      ways.alsoAsk
                        ? row.id === vettingRow
                          ? mainButton
                          : row.suggested
                            ? askButton
                            : null
                        : row.id === mainRow
                          ? mainButton
                          : null
                  : undefined
              }
            />
            {noVetting ? (
              <ThemedText style={styles.muted} testID={testIdWithKey('JoinNoVetting')}>
                {t('Join.Ways.NoVetting', named)}
              </ThemedText>
            ) : null}
            {ways.button === 'start' ? <ThemedText style={styles.muted}>{t('Join.AsksNext')}</ThemedText> : null}
            {communityDid ? <DidDetails did={communityDid} testIdStem="JoinCommunity" /> : null}
            {/* With the list, not under the buttons, so the fixed area stays short. */}
            {different}
          </>
        )
        actions = buttonsInRows ? (
          errorLine
        ) : (
          <>
            {errorLine}
            {mainButton}
          </>
        )
        differentInBody = true
        break
      }
      body = (
        <>
          <ThemedText variant="headingThree" accessibilityRole="header">
            {t('Join.AsksTitle', { community: name, interpolation: { escapeValue: false } })}
          </ThemedText>
          {/* The lines below are separate nodes, so the card says the whole
              sentence itself — for a screen reader, and for the harness. */}
          <View style={styles.card} testID={testIdWithKey('JoinAsks')} accessible accessibilityLabel={asksSentence}>
            {asks?.invitationOnly ? (
              <ThemedText>{t('Join.AsksInvitationOnly')}</ThemedText>
            ) : asks?.kind === 'open' ? (
              <ThemedText>{t('Join.AsksNothing')}</ThemedText>
            ) : asks?.kind === 'other' ? (
              <>
                <ThemedText>{t('Join.AsksOther')}</ThemedText>
                {asks.descriptions.map((d) => (
                  <ThemedText key={d}>
                    {'• '}
                    {d}
                  </ThemedText>
                ))}
              </>
            ) : (
              <>
                <ThemedText>
                  {'• '}
                  {t('Join.AsksStatements', { count: asks?.statements ?? 1 })}
                </ThemedText>
                {(asks ? asks.claims : ['name.legal']).map((c) => (
                  <ThemedText key={c}>
                    {'• '}
                    {c === 'name.legal' ? t('Join.AsksLegalName') : claimWords(c, t)}
                  </ThemedText>
                ))}
              </>
            )}
          </View>
          {asks?.kind === 'vetting' && !asks.invitationAdmits ? (
            <ThemedText testID={testIdWithKey('JoinNoInvitationBypass')}>
              {t('Join.AsksNoInvitationBypass', { community: name, interpolation: { escapeValue: false } })}
            </ThemedText>
          ) : null}
          {!asks || asks.kind === 'vetting' ? <ThemedText style={styles.muted}>{t('Join.AsksNext')}</ThemedText> : null}
          {communityDid ? <DidDetails did={communityDid} testIdStem="JoinCommunity" /> : null}
        </>
      )
      actions = (
        <>
          {asks?.invitationOnly ? (
            <Button
              title={t('VtaLink.IWasInvited')}
              buttonType={ButtonType.Primary}
              onPress={() =>
                (navigation as unknown as { navigate: (name: string) => void }).navigate(Screens.VtiInvited)
              }
              testID={testIdWithKey('JoinGoInvited')}
            />
          ) : (
            <Button
              title={t('Join.Start')}
              buttonType={ButtonType.Primary}
              onPress={() => setStep('as')}
              testID={testIdWithKey('JoinStart')}
            />
          )}
          {/* A community a link brought stays the one shown, so reopening Join
              lands here, not on "which community?". Without this a person who
              brought the wrong one had no way to another from Join (found on the
              empty-config gate, 2026-09-23: a store build names none). */}
          {different}
        </>
      )
      break
    }

    case 'as':
      body = (
        <>
          <ThemedText variant="headingThree" accessibilityRole="header">
            {t('Join.AsTitle')}
          </ThemedText>
          <View testID={testIdWithKey('JoinMakeIdentity')}>
            <JoinAs
              community={called.name}
              options={joinAs.options}
              selectedId={joinAs.selectedId}
              onSelect={joinAs.setSelectedId}
              onCreate={joinAs.createProfile}
            />
          </View>
        </>
      )
      actions = (
        <>
          {errorLine}
          <Button
            title={busy ? t('Invited.Preparing') : t('Invited.Continue')}
            buttonType={ButtonType.Primary}
            onPress={() => void onJoinAs()}
            disabled={busy}
            testID={testIdWithKey('JoinAsContinue')}
          >
            {busy ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
          </Button>
          {preparingLong ? (
            <ThemedText style={{ textAlign: 'center' }} testID={testIdWithKey('PreparingSlow')}>
              {t('Invited.PreparingSlow')}
            </ThemedText>
          ) : null}
        </>
      )
      break
  }

  const tp = (key: string, values: Record<string, unknown> = {}) =>
    t(key, { community: name, ...values, interpolation: { escapeValue: false } }) as string
  if (standingShown && communityDid && standing) {
    const withInvitation =
      (standing.kind === 'sent' || standing.kind === 'pending') && standing.submission.withInvitation
    const standingCard = (
      <View style={styles.card} testID={testIdWithKey('JoinStanding')}>
        <ThemedText testID={testIdWithKey('JoinStandingText')}>
          {standing.kind === 'member'
            ? tp('Join.StandingMember')
            : standing.kind === 'removed'
              ? tp('Join.StandingRemoved')
              : standing.kind === 'sent'
                ? tp('Join.StandingSent')
                : standing.kind === 'pending'
                  ? // From manifest 0.3 a request left open is one an administrator reviews.
                    offer?.wire === '0.3'
                    ? tp('Join.Ways.SentForReview')
                    : tp('Join.StandingPending')
                  : standing.kind === 'deferred'
                    ? tp('Join.StandingDeferred')
                    : standing.kind === 'rejected'
                      ? tp('Join.StandingRejected')
                      : standing.kind === 'withdrawn'
                        ? tp('Join.StandingWithdrawn')
                        : tp('Join.StandingLeft')}
        </ThemedText>
        {withInvitation ? (
          <ThemedText style={styles.muted} testID={testIdWithKey('JoinStandingInvitation')}>
            {t('Join.StandingWithInvitation')}
          </ThemedText>
        ) : null}
        {standing.kind === 'deferred'
          ? standing.needs.map((need, i) => (
              <ThemedText key={i} testID={testIdWithKey('JoinStandingNeed')}>
                {'• '}
                {joinNeedWords(need, t)}
              </ThemedText>
            ))
          : null}
        {standing.kind === 'rejected' && standing.reason ? (
          <ThemedText style={styles.muted} testID={testIdWithKey('JoinStandingReason')}>
            {tp('Join.StandingReason', { reason: standing.reason })}
          </ThemedText>
        ) : null}
        {/* While the request is open, the identity it was sent as, in a word
            a person can say out loud: the applicant tells the operator "I'm
            term-benefit", and the operator finds it among the join requests.
            The whole DID, with Copy, behind its toggle (as on Your agent, #305). */}
        {(standing.kind === 'sent' || standing.kind === 'pending' || standing.kind === 'deferred') &&
        standing.submission.personaDid ? (
          <View testID={testIdWithKey('JoinStandingIdentity')}>
            <ThemedText variant="bold" testID={testIdWithKey('JoinStandingIdentityName')}>
              {t('Join.IdentityHere', {
                name: identityWord(standing.submission.personaDid),
                interpolation: { escapeValue: false },
              })}
            </ThemedText>
            <DidDetails
              did={standing.submission.personaDid}
              label={t('VtaLink.ShowIdentityCode')}
              hint={tp('VtaLink.ShowIdentityCodeHint')}
              copy
              testIdStem="JoinStandingIdentity"
            />
          </View>
        ) : null}
        {/* No promise of a new identity: asking again makes one, and the
            vetting path was seen to carry on with the earlier one (IN-104).
            A removal already says "You can ask to join again." itself. */}
        {mayJoinAgain && standing.kind !== 'removed' ? (
          <ThemedText style={styles.muted} testID={testIdWithKey('JoinStandingAgain')}>
            {t('Join.StandingAgain')}
          </ThemedText>
        ) : null}
      </View>
    )
    body = (
      <>
        {standingCard}
        {body}
      </>
    )
    // "A different community" is always in reach, from the community a person
    // is already in too: a member's card used to offer only "Open" (IN-102).
    const different =
      current === 'which' || !differentInBody ? (
        <Button
          title={t('Join.Different')}
          buttonType={ButtonType.Secondary}
          onPress={() => openScanner(navigation)}
          testID={testIdWithKey('JoinScanCommunity')}
        />
      ) : null
    const go = (screen: string, params?: object) =>
      (navigation as unknown as { navigate: (screen: string, params?: object) => void }).navigate(screen, params)
    actions = (
      <>
        {standing.kind === 'member' ? (
          <Button
            title={tp('Join.Open')}
            buttonType={ButtonType.Primary}
            onPress={() => go(Screens.VtiCommunity, { communityDid })}
            testID={testIdWithKey('JoinOpenCommunity')}
          />
        ) : standing.kind === 'sent' || standing.kind === 'pending' ? (
          <Button
            title={t('Join.CheckAgain')}
            buttonType={ButtonType.Primary}
            onPress={() => void onCheckAgain()}
            disabled={checking}
            testID={testIdWithKey('JoinCheckAgain')}
          >
            {checking ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
          </Button>
        ) : standing.kind === 'deferred' ? (
          <Button
            title={t('VtaLink.ContinueVetting')}
            buttonType={ButtonType.Primary}
            onPress={() => go(Screens.VtiVetting)}
            testID={testIdWithKey('JoinContinueVetting')}
          />
        ) : (
          <Button
            title={t('Join.JoinAgain')}
            buttonType={ButtonType.Primary}
            onPress={() => {
              setAgain(true)
              setStep('asks')
            }}
            testID={testIdWithKey('JoinAgain')}
          />
        )}
        {different}
      </>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.content, actions ? undefined : { paddingBottom: 20 + roomAboveTabBar }]}
        testID={testIdWithKey('JoinScroll')}
      >
        {/* Several agents: which one joins (step 3); not over where the person already stands. */}
        {communityDid && !standingShown ? <JoinWithAgent communityDid={communityDid} name={name} /> : null}
        {body}
      </ScrollView>
      {actions ? (
        <View style={[styles.actions, { paddingBottom: 20 + roomAboveTabBar }]} testID={testIdWithKey('JoinActions')}>
          {actions}
        </View>
      ) : null}
    </SafeAreaView>
  )
}

export default VtiJoin
