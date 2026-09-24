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
import { useNavigation } from '@react-navigation/native'
import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
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
import { GenericRecordsIdentityStore } from '../module/VtiIdentityStore'
import { vtiAgent, type VtiManifest } from '../module/vtiAgent'
import { communityTarget } from '../module/vtiCommunityLink'
import { ensurePersonaFor } from '../module/vtiJoin'
import { joinSeed } from '../module/vtiJoinSeed'

import { communityName } from './communityName'
import { openScanner } from './openScanner'
import { plainError, type PlainError } from './plainError'
import { JoinAs, useJoinAsChoice } from './JoinAs'
import { useCommunity } from './useCommunity'
import { useVtaDid } from './VtaStatus'

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
}

const INVITATION = /invit/i

export function asksFrom(manifest: VtiManifest): Asks {
  const criteria = manifest.criteria
  const vetting = criteria.map((c) => c.vetting).find(Boolean)
  if (vetting) {
    return {
      kind: 'vetting',
      statements: vetting.minStatements ?? 1,
      claims: vetting.requiredClaims ?? [],
      descriptions: [],
      invitationOnly: false,
    }
  }
  if (criteria.length === 0) return { kind: 'open', claims: [], descriptions: [], invitationOnly: false }
  // Invitation-only only when every criterion is about an invitation; any
  // other criterion is something the person may be able to present.
  if (criteria.every((c) => INVITATION.test(`${c.id ?? ''} ${c.description ?? ''}`))) {
    return { kind: 'invitation', claims: [], descriptions: [], invitationOnly: true }
  }
  const descriptions = criteria
    .filter((c) => !INVITATION.test(`${c.id ?? ''} ${c.description ?? ''}`))
    .map((c) => c.description ?? c.id ?? '')
    .filter(Boolean)
  return { kind: 'other', claims: [], descriptions, invitationOnly: false }
}

export interface VtiJoinProps {
  config?: { mediatorDid?: string; communityDid?: string; vtaDid?: string }
}

const VtiJoin: React.FC<VtiJoinProps> = ({ config }) => {
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
  const name = called.name ?? called.technical

  // A community named by a link goes straight to what it asks; the build's
  // suggestion is offered first, beside "a different community".
  const [step, setStep] = useState<Step>(chosenByLink ? 'asks' : 'which')
  const [asks, setAsks] = useState<Asks>()
  // Which community's manifest has been read (or failed to be): until then a
  // missing name means "not known yet", not "none published".
  const [nameRead, setNameRead] = useState<string>()
  // Which community could not be read at all — for one the phone remembers, worth saying.
  const [unreachable, setUnreachable] = useState<string>()
  const [busy, setBusy] = useState(false)
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
    // No session needed: a community answers the join manifest over REST, which
    // is how an applicant reads what is asked of them before any channel
    // exists. Guarding this on `connected` is why a community's published name
    // never reached this screen while the community screen had it (report #16).
    vtiAgent
      // With this screen's agent: a fresh phone has no session to lend one.
      .fetchManifest(communityDid, agent)
      // Reading the manifest also teaches the app what the community calls
      // itself; vtiAgent does that for every fetch, so nothing is needed here.
      .then((m) => live && setAsks(asksFrom(m)))
      .catch(() => {
        if (live) setUnreachable(communityDid)
      })
      .finally(() => live && setNameRead(communityDid))
    return () => {
      live = false
    }
  }, [communityDid, agent])

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { flexGrow: 1, padding: 20, gap: 16 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    actions: { padding: 20, gap: 12 },
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
      await ensurePersonaFor({ agent, identityStore: new GenericRecordsIdentityStore(agent), vtaDid, communityDid })
      // Making the identity is what makes this the phone's community.
      communityTarget.choose(communityDid)
      // Seed by copy: the chosen profile fills the identity's name in once.
      if (joinAs.selected) joinSeed.set(communityDid, joinAs.selected.seed)
      const stack = navigation as unknown as { navigate: (name: string) => void }
      stack.navigate(Screens.VtiVetting)
    } catch (e) {
      setError(plainError(e))
    } finally {
      setBusy(false)
    }
  }, [agent, vtaDid, communityDid, name, navigation, t, joinAs.selected])

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
        <ThemedText style={styles.muted} selectable testID={testIdWithKey('JoinErrorDetail')}>
          {error.detail}
        </ThemedText>
      ) : null}
    </View>
  ) : null

  // What the community asks, as one sentence: the card's accessibility label.
  const asksSentence = (() => {
    if (asks?.invitationOnly) return t('Join.AsksInvitationOnly')
    if (asks?.kind === 'open') return t('Join.AsksNothing')
    if (asks?.kind === 'other') return [t('Join.AsksOther'), ...asks.descriptions].join(' ')
    const claims = (asks ? asks.claims : ['name.legal']).map((c) => (c === 'name.legal' ? t('Join.AsksLegalName') : c))
    return [t('Join.AsksStatements', { count: asks?.statements ?? 1 }), ...claims].join('. ')
  })()

  let body: React.ReactNode
  let actions: React.ReactNode
  const current: Step = !communityDid ? 'which' : step

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
              DID's host stands as the identifier, not as a name. */}
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
              <ThemedText style={styles.muted} testID={testIdWithKey('JoinSuggestedSource')}>
                {remembered ? t('Join.Remembered') : t('Join.Suggested')}
              </ThemedText>
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

    case 'asks':
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
                    {c === 'name.legal' ? t('Join.AsksLegalName') : c}
                  </ThemedText>
                ))}
              </>
            )}
          </View>
          {!asks || asks.kind === 'vetting' ? <ThemedText style={styles.muted}>{t('Join.AsksNext')}</ThemedText> : null}
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
          <Button
            title={t('Join.Different')}
            buttonType={ButtonType.Tertiary}
            onPress={() => openScanner(navigation)}
            testID={testIdWithKey('JoinScanCommunity')}
          />
        </>
      )
      break

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
          {errorLine}
        </>
      )
      actions = (
        <Button
          title={busy ? t('Invited.Preparing') : t('Invited.Continue')}
          buttonType={ButtonType.Primary}
          onPress={() => void onJoinAs()}
          disabled={busy}
          testID={testIdWithKey('JoinAsContinue')}
        >
          {busy ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
        </Button>
      )
      break
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>{body}</ScrollView>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </SafeAreaView>
  )
}

export default VtiJoin
