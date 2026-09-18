/**
 * My Agent — S1, S3 and S4 of `community_vetting_subtask.md` §7.1, which are
 * one screen read at three moments: before an agent is connected, while it is
 * connecting, and once it is.
 *
 * A community is reached through an agent, so this is where that relationship
 * is made and shown: the agent's host and the DID this wallet presents as its
 * member identity, then the communities it can talk to.
 *
 * @module trust-tasks/screens/MyAgent
 */

import { useNavigation } from '@react-navigation/native'
import type { StackNavigationProp } from '@react-navigation/stack'
import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { useTheme } from '../../../contexts/theme'
import { Screens, type MyAgentStackParams } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { GenericRecordsCommunityStore, type VtiInvitation, type VtiMembership } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from '../module/VtiIdentityStore'
import { vtaAgent } from '../module/vtaAgent'
import { vtiAgent } from '../module/vtiAgent'
import { ensurePersonaFor, joinCommunity, type VtiJoinStep } from '../module/vtiJoin'

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
  const communityDid = config?.communityDid
  const vtaDid = config?.vtaDid

  // What the wallet holds towards communities (§2.4 B): the persona its VTA
  // minted for this community, the invitations it was handed, the memberships
  // it earned. Read from the stores; refreshed after anything that writes.
  const [persona, setPersona] = useState<VtiPersona>()
  const [invitations, setInvitations] = useState<VtiInvitation[]>([])
  const [memberships, setMemberships] = useState<VtiMembership[]>([])
  const [busy, setBusy] = useState<'identity' | 'join'>()
  const [activity, setActivity] = useState<string[]>([])
  const [holdingError, setHoldingError] = useState<string>()

  const refresh = useCallback(async () => {
    if (!agent) return
    const identities = new GenericRecordsIdentityStore(agent)
    const communities = new GenericRecordsCommunityStore(agent)
    const [p, i, m] = await Promise.all([
      communityDid ? identities.getPersona(communityDid) : Promise.resolve(undefined),
      communities.listInvitations(),
      communities.listMemberships(),
    ])
    setPersona(p)
    setInvitations(i.filter((x) => x.status === 'pending'))
    setMemberships(m)
  }, [agent, communityDid])

  useEffect(() => {
    void refresh()
    // Invitations arrive by deep link while this screen may be open.
    const timer = setInterval(() => void refresh(), 4000)
    return () => clearInterval(timer)
  }, [refresh])

  // Be reachable by the VTA as soon as this phone has a manager identity for
  // it: a consent request can arrive at any time, and only an open session
  // receives it.
  useEffect(() => {
    if (!agent || !vtaDid) return
    void (async () => {
      const manager = await new GenericRecordsIdentityStore(agent).getManager(vtaDid)
      if (manager) await vtaAgent.connect(agent, vtaDid).catch(() => undefined)
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
      if (!agent || !vtaDid || !mediatorDid) return
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
  })

  const onConnect = useCallback(async () => {
    if (!agent || !mediatorDid) return
    try {
      await vtiAgent.connect(agent, mediatorDid)
    } catch {
      // the failure is already on screen, from the controller's state
    }
  }, [agent, mediatorDid])

  const viaText = (via: VtiMembership['via']) =>
    via === 'invitation' ? t('MyAgent.ViaInvitation') : via === 'vetting' ? t('MyAgent.ViaVetting') : t('MyAgent.ViaApproval')

  const holdings = (
    <>
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
                {t('MyAgent.AwaitingConsent', { task: shortTask(vta.awaitingConsentFor), interpolation: { escapeValue: false } })}
              </Text>
            </View>
          ) : null}
          {vta.approvals.length === 0 ? (
            <Text style={styles.value} testID={testIdWithKey('MyAgentNoApprovals')}>
              {vta.status === 'connected' ? `${t('MyAgent.NoApprovals')} ${t('MyAgent.AgentListening')}` : t('MyAgent.NoApprovals')}
            </Text>
          ) : (
            vta.approvals.map((approval) => (
              <View key={approval.id} style={styles.card} testID={testIdWithKey('MyAgentApprovalCard')}>
                <Text style={styles.value}>
                  {t('MyAgent.ApprovalAsks', { requester: shortDid(approval.requester), task: shortTask(approval.taskType), interpolation: { escapeValue: false } })}
                </Text>
                <Text style={styles.label}>{t('MyAgent.ApprovalExpires', { when: approval.expiresAt.replace('T', ' ').slice(0, 16) })}</Text>
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
                    {approval.status === 'approved' ? t('MyAgent.Approved') : approval.status === 'denied' ? t('MyAgent.Denied') : approval.error ?? approval.status}
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
        <View key={m.communityDid} style={styles.card} testID={testIdWithKey('MyAgentMembershipCard')}>
          <View style={styles.row}>
            <Icon name="card-account-details" size={18} color={ColorPalette.semantic.success} />
            <Text style={styles.value}>{t('MyAgent.Member')}</Text>
          </View>
          <Text style={styles.value}>{shortDid(m.communityDid)}</Text>
          <Text style={styles.label} testID={testIdWithKey('MyAgentMembershipRole')}>
            {m.role} · {viaText(m.via)}
          </Text>
          <Text style={styles.label}>{t('MyAgent.MemberSince', { date: m.grantedAt.slice(0, 10) })}</Text>
        </View>
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
      {!communityDid && memberships.length === 0 ? <Text style={styles.value}>{t('MyAgent.NoCommunities')}</Text> : null}

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


  if (!mediatorDid) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.content}>
          <Text style={styles.value} testID={testIdWithKey('MyAgentNotConfigured')}>
            {t('MyAgent.NotConfigured')}
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  // S3 — connecting. Each step is named, because "please wait" tells a person
  // nothing about which leg is slow when one is.
  if (state.status === 'resolving' || state.status === 'authenticating') {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.content}>
          <View style={styles.row}>
            <ActivityIndicator color={ColorPalette.brand.primary} />
            <Text style={styles.value} testID={testIdWithKey('MyAgentConnecting')}>
              {state.status === 'resolving' ? t('MyAgent.Resolving') : t('MyAgent.Authenticating')}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  // S4 — connected.
  if (state.status === 'connected') {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card} testID={testIdWithKey('MyAgentCard')}>
            <Text style={styles.label}>{t('MyAgent.Host')}</Text>
            <Text style={styles.value} testID={testIdWithKey('MyAgentHost')}>
              {state.host}
            </Text>
            <Text style={styles.label}>{t('MyAgent.YourIdentity')}</Text>
            <Text style={styles.value} testID={testIdWithKey('MyAgentDid')}>
              {shortDid(state.did)}
            </Text>
            <View style={styles.row}>
              <Icon name="check-circle" size={18} color={ColorPalette.semantic.success} />
              <Text style={styles.value}>{t('MyAgent.Connected')}</Text>
            </View>
          </View>

          {holdings}
        </ScrollView>
      </SafeAreaView>
    )
  }

  // S1 — not connected (and the failed state, which says why and offers a retry).
  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={{ ...TextTheme.headingThree, color: TextTheme.normal.color }}>{t('MyAgent.Title')}</Text>
        <Text style={styles.value}>{t('MyAgent.WhatItIs')}</Text>
        {state.error ? (
          <Text style={styles.error} testID={testIdWithKey('MyAgentError')}>
            {state.error}
          </Text>
        ) : null}
        {holdings}
        <Pressable
          style={styles.button}
          testID={testIdWithKey('ConnectMyAgentButton')}
          accessibilityRole="button"
          onPress={onConnect}
        >
          <Text style={styles.buttonText}>
            {state.status === 'failed' ? t('MyAgent.TryAgain') : t('MyAgent.Connect')}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

export default MyAgent
