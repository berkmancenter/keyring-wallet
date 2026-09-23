/**
 * My Agent — S1, S3 and S4 of `community_vetting_subtask.md` §7.1, which are
 * one screen read at three moments: before an agent is connected, while it is
 * connecting, and once it is.
 *
 * A community is reached through an agent, so this is where that relationship
 * is made and shown. The primary action, *Connect my agent*, does the three
 * things a phone needs before it can do anything with a community: sign in
 * to its own VTA, get (or mint) its identity for the configured community,
 * and open the community session as that identity. Until the agent is
 * connected the screen shows only what is needed to get there — the manager
 * identity to enrol, and the button; everything the agent holds (identity,
 * approvals, invitations, communities, vetting) appears once it is.
 *
 * Vetting is the star of the connected screen: one prominent entry that says
 * which seat this phone holds — the vetter's desk, or the applicant's — before
 * the person opens it.
 *
 * @module trust-tasks/screens/MyAgent
 */

import { useNavigation } from '@react-navigation/native'
import type { StackNavigationProp } from '@react-navigation/stack'
import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { useTheme } from '../../../contexts/theme'
import { Screens, type MyAgentStackParams } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { GenericRecordsCommunityStore, type VtiInvitation, type VtiMembership } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from '../module/VtiIdentityStore'
import { vtaAgent } from '../module/vtaAgent'
import { vtiAgent } from '../module/vtiAgent'
import { ownVetterGrantState } from '../module/vtiGrantState'
import { useVtiPersonaDeliveries } from '../module/vtiPersonaInbox'
import { ensurePersonaFor, joinCommunity, type VtiJoinStep } from '../module/vtiJoin'
import { GenericRecordsTspPeerRevisionStore } from '../module/vtiTsp'

import { openScanner } from './openScanner'
import { useChosenCommunityDid } from './useCommunity'
import { useVtaDid } from './VtaStatus'

/** Which seat this phone would take at a vetting: decided by what it holds. */
type VettingSeat = 'vetter' | 'applicant'

/** The DID is long and the host is what a person recognises, so lead with it. */
const shortDid = (did?: string) => (did && did.length > 32 ? `${did.slice(0, 22)}…${did.slice(-8)}` : did)

export interface MyAgentProps {
  /** The mediator a VTI agent advertises, the community to offer, and the phone's own VTA. */
  config?: { mediatorDid?: string; communityDid?: string; vtaDid?: string }
}

const MyAgent: React.FC<MyAgentProps> = ({ config }) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const { agent } = useAgent()
  const navigation = useNavigation<StackNavigationProp<MyAgentStackParams>>()
  const state = useSyncExternalStore(vtiAgent.subscribe, vtiAgent.getState)
  const vta = useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)

  const mediatorDid = config?.mediatorDid
  // The phone's community — not one a link is only showing.
  const communityDid = useChosenCommunityDid(config?.communityDid)
  // The agent the person linked by QR (plan §5.1) wins over the one a build
  // bakes in; the baked one stays for builds and runners that predate linking.
  const vtaDid = useVtaDid(config?.vtaDid)

  // What the wallet holds towards communities (§2.4 B): the persona its VTA
  // minted for this community, the invitations it was handed, the memberships
  // it earned. Read from the stores; refreshed after anything that writes.
  const [persona, setPersona] = useState<VtiPersona>()
  const [invitations, setInvitations] = useState<VtiInvitation[]>([])
  const [memberships, setMemberships] = useState<VtiMembership[]>([])
  const [seat, setSeat] = useState<VettingSeat>('applicant')
  const grantCheck = useRef<{ key: string; at: number; vetter: boolean } | undefined>(undefined)
  const [busy, setBusy] = useState<'identity' | 'join'>()
  const [activity, setActivity] = useState<string[]>([])
  const [holdingError, setHoldingError] = useState<string>()
  // The primary action: sign in to the VTA, ensure the persona, open the
  // community session. Each step is named while it runs (S3).
  const [connecting, setConnecting] = useState<{ step: string } | undefined>()
  const [connectError, setConnectError] = useState<string>()
  const [managerDid, setManagerDid] = useState<string>()

  const refresh = useCallback(async () => {
    if (!agent) return
    const identities = new GenericRecordsIdentityStore(agent)
    const communities = new GenericRecordsCommunityStore(agent)
    const [p, i, m, grants] = await Promise.all([
      communityDid ? identities.getPersona(communityDid) : Promise.resolve(undefined),
      communities.listInvitations(),
      communities.listMemberships(),
      communityDid ? communities.listHeldCredentials('vetter-grant', communityDid) : Promise.resolve([]),
    ])
    setPersona(p)
    setInvitations(i.filter((x) => x.status === 'pending'))
    setMemberships(m)
    // A vetter grant that still stands makes this phone the desk — a revoked or
    // expired one does not. The status list is a network read, so it is asked
    // again only when the grants change or once a minute, not on every refresh.
    const own = p ? grants.filter((g) => g.subjectDid === p.did) : []
    const key = own.map((g) => g.receivedAt).join(',')
    const cached = grantCheck.current
    if (!cached || cached.key !== key || Date.now() - cached.at > 60_000) {
      const standing = await ownVetterGrantState(agent, own, { allowInsecureLocal: __DEV__ })
      grantCheck.current = { key, at: Date.now(), vetter: standing.state === 'active' }
    }
    setSeat(grantCheck.current?.vetter ? 'vetter' : 'applicant')
  }, [agent, communityDid])

  useEffect(() => {
    void refresh()
    // Invitations arrive by deep link while this screen may be open.
    const timer = setInterval(() => void refresh(), 4000)
    return () => clearInterval(timer)
  }, [refresh])
  // A grant or a membership stored by the persona inbox shows without waiting for the timer.
  useVtiPersonaDeliveries(refresh)

  // Be reachable by the VTA as soon as this phone has a manager identity for
  // it: a consent request can arrive at any time, and only an open session
  // receives it.
  useEffect(() => {
    if (!agent || !vtaDid) return
    void (async () => {
      const manager = await new GenericRecordsIdentityStore(agent).getManager(vtaDid)
      if (manager) {
        setManagerDid(manager.did)
        await vtaAgent.connect(agent, vtaDid).catch(() => undefined)
      } else {
        // Mint it so the person has something to enrol; connecting comes after.
        const did = await vtaAgent
          .client(agent, vtaDid)
          .ensureManagerIdentity()
          .catch(() => undefined)
        if (did) setManagerDid(did)
      }
    })()
  }, [agent, vtaDid])

  const [deciding, setDeciding] = useState<string>()
  const onDecide = useCallback(async (id: string, decision: 'approve' | 'deny') => {
    setDeciding(id)
    try {
      await vtaAgent.decide(id, decision)
    } catch {
      // the failure is on the approval itself, from the controller's state
    } finally {
      setDeciding(undefined)
    }
  }, [])
  const shortTask = (uri: string) => uri.replace('https://trusttasks.org/spec/', '')

  const onCreateIdentity = useCallback(async () => {
    if (!agent || !vtaDid || !communityDid) return
    setBusy('identity')
    setHoldingError(undefined)
    try {
      await ensurePersonaFor({ agent, identityStore: new GenericRecordsIdentityStore(agent), vtaDid, communityDid })
      await refresh()
    } catch (error) {
      setHoldingError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(undefined)
    }
  }, [agent, vtaDid, communityDid, refresh])

  const stepText = useCallback(
    (step: VtiJoinStep, detail?: string) => {
      switch (step) {
        case 'persona':
          return t('MyAgent.StepPersona')
        case 'connecting':
          return t('MyAgent.StepConnecting', { did: shortDid(detail) })
        case 'manifest':
          return t('MyAgent.StepManifest')
        case 'submitting':
          return t('MyAgent.StepSubmitting')
        case 'verdict':
          return t('MyAgent.StepVerdict', { effect: detail })
        case 'stored':
          return t('MyAgent.StepStored')
      }
    },
    [t]
  )

  const onJoin = useCallback(
    async (invitation: VtiInvitation) => {
      if (!agent || !vtaDid) return
      setBusy('join')
      setHoldingError(undefined)
      setActivity([])
      try {
        const result = await joinCommunity(
          {
            agent,
            identityStore: new GenericRecordsIdentityStore(agent),
            communityStore: new GenericRecordsCommunityStore(agent),
            vtaDid,
            mediatorDid,
            communityDid: invitation.communityDid,
            onStep: (step, detail) => setActivity((prev) => [...prev, stepText(step, detail)]),
          },
          invitation
        )
        if (result.membership) setActivity((prev) => [...prev, t('MyAgent.AddedToWallet')])
        await refresh()
      } catch (error) {
        setHoldingError(error instanceof Error ? error.message : String(error))
      } finally {
        setBusy(undefined)
      }
    },
    [agent, vtaDid, mediatorDid, refresh, stepText, t]
  )

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 24, gap: 24 },
    card: {
      backgroundColor: ColorPalette.brand.secondaryBackground,
      borderRadius: 12,
      padding: 20,
      gap: 8,
    },
    label: { ...TextTheme.labelSubtitle, color: ColorPalette.grayscale.mediumGrey },
    value: { ...TextTheme.normal, color: TextTheme.normal.color },
    button: {
      backgroundColor: ColorPalette.brand.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
    },
    buttonText: { ...TextTheme.bold, color: '#FFFFFF' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    error: { ...TextTheme.normal, color: ColorPalette.semantic.error },
    hero: {
      backgroundColor: ColorPalette.brand.primary,
      borderRadius: 16,
      padding: 20,
      gap: 10,
    },
    heroTitle: { ...TextTheme.headingThree, color: '#FFFFFF' },
    heroText: { ...TextTheme.normal, color: '#FFFFFF' },
    badge: {
      alignSelf: 'flex-start',
      borderRadius: 999,
      paddingVertical: 4,
      paddingHorizontal: 12,
      backgroundColor: '#FFFFFF',
    },
    badgeText: { ...TextTheme.labelSubtitle, color: ColorPalette.brand.primary, fontWeight: '700' },
    heroButton: {
      backgroundColor: '#FFFFFF',
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
      marginTop: 4,
    },
    heroButtonText: { ...TextTheme.bold, color: ColorPalette.brand.primary },
    mono: { fontFamily: 'Courier', fontSize: 12, color: TextTheme.normal.color },
  })

  const onConnect = useCallback(async () => {
    if (!agent) return
    setConnectError(undefined)
    try {
      if (vtaDid) {
        setConnecting({ step: t('MyAgent.StepSigningIn') })
        await vtaAgent.connect(agent, vtaDid)
        if (communityDid) {
          setConnecting({ step: t('MyAgent.StepPersona') })
          const p = await ensurePersonaFor({
            agent,
            identityStore: new GenericRecordsIdentityStore(agent),
            vtaDid,
            communityDid,
          })
          setConnecting({ step: t('MyAgent.StepConnecting', { did: shortDid(p.did) }) })
          await vtiAgent.connect(agent, mediatorDid, {
            persona: p,
            peerRevisionStore: new GenericRecordsTspPeerRevisionStore(agent),
          })
        }
      }
      // No agent, no connect: a phone reaches a community through its agent.
      // (A build-named mediator once let a phone mint its own did:peer here; a
      // store build names none, and that path could only fail.)
      await refresh()
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : String(error))
    } finally {
      setConnecting(undefined)
    }
  }, [agent, mediatorDid, vtaDid, communityDid, refresh, t])

  // The agent is "connected" when the phone's own VTA session is up; a build
  // with no VTA falls back to the community session being up.
  const agentConnected = vtaDid ? vta.status === 'connected' : state.status === 'connected'

  const viaText = (via: VtiMembership['via']) =>
    via === 'invitation'
      ? t('MyAgent.ViaInvitation')
      : via === 'vetting'
        ? t('MyAgent.ViaVetting')
        : t('MyAgent.ViaApproval')

  // The star of the connected screen: one entry, and the seat named before it
  // is opened. A vetter grant makes this phone the desk; otherwise it is the
  // applicant's side — being vetted is what most people come here to do.
  const vettingHero =
    vtaDid && communityDid ? (
      <Pressable
        style={styles.hero}
        testID={testIdWithKey('MyAgentVettingRow')}
        accessibilityRole="button"
        accessibilityLabel={`${t('Vetting.Title')}. ${seat === 'vetter' ? t('Vetting.SeatVetter') : t('Vetting.SeatApplicant')}`}
        onPress={() => navigation.navigate(Screens.VtiVetting)}
      >
        <View style={styles.row}>
          <Icon name={seat === 'vetter' ? 'account-check' : 'account-search'} size={28} color="#FFFFFF" />
          <Text style={styles.heroTitle}>{t('Vetting.Title')}</Text>
        </View>
        <View style={styles.badge} testID={testIdWithKey('MyAgentVettingSeat')}>
          <Text style={styles.badgeText}>
            {seat === 'vetter' ? t('Vetting.SeatVetter') : t('Vetting.SeatApplicant')}
          </Text>
        </View>
        <Text style={styles.heroText}>{seat === 'vetter' ? t('Vetting.HeroVetter') : t('Vetting.HeroApplicant')}</Text>
        <View style={styles.heroButton} testID={testIdWithKey('MyAgentVettingOpen')}>
          <Text style={styles.heroButtonText}>
            {seat === 'vetter' ? t('Vetting.OpenDesk') : t('Vetting.GetVetted')}
          </Text>
          <Icon name="chevron-right" size={20} color={ColorPalette.brand.primary} />
        </View>
      </Pressable>
    ) : null

  const holdings = (
    <>
      {vettingHero}

      {vtaDid && communityDid ? (
        <>
          <Text style={{ ...TextTheme.headingFour, color: TextTheme.normal.color }}>{t('MyAgent.Identity')}</Text>
          <View style={styles.card} testID={testIdWithKey('MyAgentIdentityCard')}>
            {persona ? (
              <>
                <Text style={styles.value} testID={testIdWithKey('MyAgentPersonaDid')}>
                  {persona.did}
                </Text>
                <Text style={styles.label}>{t('MyAgent.ShareIdentity')}</Text>
                {/* The community screen — and Leave community on it — whether or
                    not this phone is a member yet: an applicant holds a persona
                    and vetting state to leave too. */}
                <Pressable
                  testID={testIdWithKey('MyAgentOpenCommunity')}
                  accessibilityRole="link"
                  onPress={() => navigation.navigate(Screens.VtiCommunity, { communityDid })}
                >
                  <Text style={[styles.label, { textDecorationLine: 'underline' }]}>{t('Community.Open')}</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.value}>{t('MyAgent.NoIdentity')}</Text>
                <Pressable
                  style={styles.button}
                  testID={testIdWithKey('CreateIdentityButton')}
                  accessibilityRole="button"
                  disabled={busy !== undefined}
                  onPress={onCreateIdentity}
                >
                  {busy === 'identity' ? <ActivityIndicator color="#FFFFFF" /> : null}
                  <Text style={styles.buttonText}>
                    {busy === 'identity' ? t('MyAgent.CreatingIdentity') : t('MyAgent.CreateIdentity')}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </>
      ) : null}

      {vtaDid ? (
        <>
          <Text style={{ ...TextTheme.headingFour, color: TextTheme.normal.color }}>{t('MyAgent.Approvals')}</Text>
          {vta.awaitingConsentFor ? (
            <View style={styles.row}>
              <ActivityIndicator color={ColorPalette.brand.primary} />
              <Text style={styles.value} testID={testIdWithKey('MyAgentAwaitingConsent')}>
                {t('MyAgent.AwaitingConsent', {
                  task: shortTask(vta.awaitingConsentFor),
                  interpolation: { escapeValue: false },
                })}
              </Text>
            </View>
          ) : null}
          {vta.approvals.length === 0 ? (
            <Text style={styles.value} testID={testIdWithKey('MyAgentNoApprovals')}>
              {vta.status === 'connected'
                ? `${t('MyAgent.NoApprovals')} ${t('MyAgent.AgentListening')}`
                : t('MyAgent.NoApprovals')}
            </Text>
          ) : (
            vta.approvals.map((approval) => (
              <View key={approval.id} style={styles.card} testID={testIdWithKey('MyAgentApprovalCard')}>
                <Text style={styles.value}>
                  {t('MyAgent.ApprovalAsks', {
                    requester: shortDid(approval.requester),
                    task: shortTask(approval.taskType),
                    interpolation: { escapeValue: false },
                  })}
                </Text>
                <Text style={styles.label}>
                  {t('MyAgent.ApprovalExpires', { when: approval.expiresAt.replace('T', ' ').slice(0, 16) })}
                </Text>
                {approval.status === 'pending' ? (
                  <View style={styles.row}>
                    <Pressable
                      style={[styles.button, { flex: 1 }]}
                      testID={testIdWithKey('ApproveConsentButton')}
                      accessibilityRole="button"
                      disabled={deciding !== undefined}
                      onPress={() => onDecide(approval.id, 'approve')}
                    >
                      <Text style={styles.buttonText}>{t('MyAgent.Approve')}</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.button, { flex: 1, backgroundColor: ColorPalette.grayscale.mediumGrey }]}
                      testID={testIdWithKey('DenyConsentButton')}
                      accessibilityRole="button"
                      disabled={deciding !== undefined}
                      onPress={() => onDecide(approval.id, 'deny')}
                    >
                      <Text style={styles.buttonText}>{t('MyAgent.Deny')}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text
                    style={approval.status === 'failed' ? styles.error : styles.value}
                    testID={testIdWithKey('MyAgentApprovalDecided')}
                  >
                    {approval.status === 'approved'
                      ? t('MyAgent.Approved')
                      : approval.status === 'denied'
                        ? t('MyAgent.Denied')
                        : (approval.error ?? approval.status)}
                  </Text>
                )}
              </View>
            ))
          )}
        </>
      ) : null}

      <Text style={{ ...TextTheme.headingFour, color: TextTheme.normal.color }}>{t('MyAgent.Invitations')}</Text>
      {invitations.length === 0 ? (
        <Text style={styles.value} testID={testIdWithKey('MyAgentNoInvitations')}>
          {t('MyAgent.NoInvitations')}
        </Text>
      ) : (
        invitations.map((invitation) => (
          <View key={invitation.id} style={styles.card} testID={testIdWithKey('MyAgentInvitationCard')}>
            <Text style={styles.value}>{shortDid(invitation.communityDid)}</Text>
            <Text style={styles.label}>{t('MyAgent.InvitedAs', { role: invitation.role })}</Text>
            {persona && invitation.subjectDid !== persona.did ? (
              <Text style={styles.error}>{t('MyAgent.InvitationNotForYou')}</Text>
            ) : (
              <Pressable
                style={styles.button}
                testID={testIdWithKey('JoinCommunityButton')}
                accessibilityRole="button"
                disabled={busy !== undefined}
                onPress={() => onJoin(invitation)}
              >
                {busy === 'join' ? <ActivityIndicator color="#FFFFFF" /> : null}
                <Text style={styles.buttonText}>{busy === 'join' ? t('MyAgent.Joining') : t('MyAgent.Join')}</Text>
              </Pressable>
            )}
          </View>
        ))
      )}

      <Text style={{ ...TextTheme.headingFour, color: TextTheme.normal.color }}>{t('MyAgent.Communities')}</Text>
      {memberships.map((m) => (
        <Pressable
          key={m.communityDid}
          style={styles.card}
          testID={testIdWithKey('MyAgentMembershipCard')}
          accessibilityRole="button"
          onPress={() => navigation.navigate(Screens.VtiCommunity, { communityDid: m.communityDid })}
        >
          <View style={styles.row}>
            <Icon name="card-account-details" size={18} color={ColorPalette.semantic.success} />
            <Text style={styles.value}>{t('MyAgent.Member')}</Text>
          </View>
          <Text style={styles.value}>{shortDid(m.communityDid)}</Text>
          <Text style={styles.label} testID={testIdWithKey('MyAgentMembershipRole')}>
            {m.role} · {viaText(m.via)}
          </Text>
          <Text style={styles.label}>{t('MyAgent.MemberSince', { date: m.grantedAt.slice(0, 10) })}</Text>
        </Pressable>
      ))}
      {communityDid && !memberships.some((m) => m.communityDid === communityDid) ? (
        <Pressable
          style={styles.card}
          testID={testIdWithKey('MyAgentCommunityRow')}
          accessibilityRole="button"
          onPress={() => navigation.navigate(Screens.VtiCommunity, { communityDid })}
        >
          <Text style={styles.value}>{shortDid(communityDid)}</Text>
          <Text style={styles.label}>{t('MyAgent.NotAMember')}</Text>
        </Pressable>
      ) : null}
      {!communityDid && memberships.length === 0 ? (
        <Text style={styles.value}>{t('MyAgent.NoCommunities')}</Text>
      ) : null}

      {activity.length > 0 || holdingError ? (
        <>
          <Text style={{ ...TextTheme.headingFour, color: TextTheme.normal.color }}>{t('MyAgent.Activity')}</Text>
          <View style={styles.card} testID={testIdWithKey('MyAgentActivity')}>
            {activity.map((line, i) => (
              <Text key={i} style={styles.value}>
                {line}
              </Text>
            ))}
            {holdingError ? (
              <Text style={styles.error} testID={testIdWithKey('MyAgentHoldingError')}>
                {holdingError}
              </Text>
            ) : null}
          </View>
        </>
      ) : null}
    </>
  )

  // A build that names nothing (a store build: testers bring their own agent
  // and community) falls through to "Link your agent" below. It used to stop
  // here at "No agent is configured for this build", with the link doors
  // behind it, so a fresh tester could not link at all.

  // S3 — connecting. Each step is named, because "please wait" tells a person
  // nothing about which leg is slow when one is.
  const connectingStep =
    connecting?.step ??
    (vta.status === 'connecting'
      ? t('MyAgent.StepSigningIn')
      : state.status === 'resolving'
        ? t('MyAgent.Resolving')
        : state.status === 'authenticating'
          ? t('MyAgent.Authenticating')
          : undefined)
  if (connectingStep) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.content}>
          <Text style={{ ...TextTheme.headingThree, color: TextTheme.normal.color }}>{t('MyAgent.Title')}</Text>
          <View style={styles.row}>
            <ActivityIndicator color={ColorPalette.brand.primary} />
            <Text style={styles.value} testID={testIdWithKey('MyAgentConnecting')}>
              {connectingStep}
            </Text>
          </View>
          {vta.awaitingConsentFor ? (
            <Text style={styles.label} testID={testIdWithKey('MyAgentAwaitingConsent')}>
              {t('MyAgent.AwaitingConsent', {
                task: shortTask(vta.awaitingConsentFor),
                interpolation: { escapeValue: false },
              })}
            </Text>
          ) : null}
        </View>
      </SafeAreaView>
    )
  }

  // S4 — connected: the agent card, then everything it holds.
  if (agentConnected) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <ScrollView contentContainerStyle={styles.content}>
          {vta.link.kind === 'linked' ? (
            <Button
              title={t('VtaLink.OpenYourAgent')}
              buttonType={ButtonType.Secondary}
              onPress={() => navigation.navigate(Screens.VtaAgent)}
              testID={testIdWithKey('OpenYourAgentButton')}
            />
          ) : null}
          <View style={styles.card} testID={testIdWithKey('MyAgentCard')}>
            <View style={styles.row}>
              <Icon name="check-circle" size={18} color={ColorPalette.semantic.success} />
              <Text style={styles.value}>{t('MyAgent.Connected')}</Text>
            </View>
            <Text style={styles.label}>{t('MyAgent.Host')}</Text>
            <Text style={styles.value} testID={testIdWithKey('MyAgentHost')}>
              {state.host ?? vta.vtaDid ?? ''}
            </Text>
            {vta.managerDid ? (
              <>
                <Text style={styles.label}>{t('MyAgent.ManagerIdentity')}</Text>
                <Text style={styles.value} testID={testIdWithKey('MyAgentManagerDid')}>
                  {shortDid(vta.managerDid)}
                </Text>
              </>
            ) : null}
            <Text style={styles.label}>{t('MyAgent.YourIdentity')}</Text>
            <Text style={styles.value} testID={testIdWithKey('MyAgentDid')}>
              {state.did ? shortDid(state.did) : t('MyAgent.NoCommunitySession')}
            </Text>
            {state.status === 'connected' && state.peerLeg ? (
              <Text style={styles.label} testID={testIdWithKey('MyAgentPeerLeg')}>
                {state.peerLeg === 'tsp' ? t('MyAgent.PeerLegTsp') : t('MyAgent.PeerLegDidComm')}
              </Text>
            ) : null}
            {!state.did && communityDid ? (
              <Pressable
                style={styles.button}
                testID={testIdWithKey('ConnectCommunityButton')}
                accessibilityRole="button"
                onPress={onConnect}
              >
                <Text style={styles.buttonText}>{t('MyAgent.ConnectCommunity')}</Text>
              </Pressable>
            ) : null}
            {connectError ? (
              <Text style={styles.error} testID={testIdWithKey('MyAgentError')}>
                {connectError}
              </Text>
            ) : null}
          </View>

          {holdings}
        </ScrollView>
      </SafeAreaView>
    )
  }

  const onLinkAgent = () => {
    // An attempt already under way is resumed where it is, not restarted.
    if (vta.link.kind !== 'notLinked' && vta.link.kind !== 'linked') {
      navigation.navigate(Screens.VtaLink)
      return
    }
    openScanner(navigation)
  }

  // S1 — not connected (and the failed state, which says why and offers a retry).
  const failure = connectError ?? (vtaDid ? vta.error : state.error)
  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={{ ...TextTheme.headingThree, color: TextTheme.normal.color }}>{t('MyAgent.Title')}</Text>
        <Text style={styles.value}>{t('MyAgent.WhatItIs')}</Text>
        {vta.link.kind !== 'linked' ? (
          <View style={styles.card} testID={testIdWithKey('MyAgentLinkCard')}>
            <Text style={styles.value}>{t('VtaLink.LinkYourAgentHint')}</Text>
            {/* A tester with no agent page at hand should learn where a code
                comes from, not meet a camera with nothing to scan. */}
            <Text style={styles.label} testID={testIdWithKey('LinkYourAgentHelp')}>
              {t('VtaLink.LinkYourAgentHelp')}
            </Text>
            <Button
              title={t('VtaLink.LinkYourAgent')}
              buttonType={ButtonType.Primary}
              onPress={onLinkAgent}
              testID={testIdWithKey('LinkYourAgentButton')}
            />
            <Button
              title={t('VtaLink.WithoutQr')}
              buttonType={ButtonType.Tertiary}
              onPress={() => navigation.navigate(Screens.VtaLink, { withoutQr: true })}
              testID={testIdWithKey('LinkWithoutQrButton')}
            />
          </View>
        ) : null}
        {vtaDid ? (
          <View style={styles.card} testID={testIdWithKey('MyAgentEnrolCard')}>
            <Text style={styles.label}>{t('MyAgent.ManagerIdentity')}</Text>
            <Text style={styles.mono} testID={testIdWithKey('MyAgentManagerDid')} selectable>
              {managerDid ?? '…'}
            </Text>
            <Text style={styles.label}>{t('MyAgent.EnrolHint')}</Text>
          </View>
        ) : null}
        {failure ? (
          <Text style={styles.error} testID={testIdWithKey('MyAgentError')}>
            {failure}
          </Text>
        ) : null}
        {/* Only when there is an agent to connect to — a linked one or one the
            build names. With neither, "Link your agent" above is the way in,
            and this could only fail. */}
        {vtaDid ? (
          <>
            <Pressable
              style={styles.button}
              testID={testIdWithKey('ConnectMyAgentButton')}
              accessibilityRole="button"
              onPress={onConnect}
            >
              <Text style={styles.buttonText}>{failure ? t('MyAgent.TryAgain') : t('MyAgent.Connect')}</Text>
            </Pressable>
            <Text style={styles.label}>{t('MyAgent.ConnectExplains')}</Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

export default MyAgent
