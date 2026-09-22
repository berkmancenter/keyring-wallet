/**
 * "I was invited" — the person hands the community's admin who to invite, then
 * waits for the invitation and joins (UI/UX plan, TestFlight report #3).
 *
 * An invitation is issued to a subject DID, and there is no invitation by
 * reference yet (VTI-32), so the admin needs this phone's identity for the
 * community before they can invite. The identity is made as part of this
 * flow — confirmed once with the person's face or fingerprint — rather than
 * as a separate chore; the person only sees "send this to the admin". The
 * DID travels inside what they send, so nobody has to read one on screen.
 *
 * One step per screen, like vetting: tell the admin → send it → wait, join.
 *
 * @module trust-tasks/screens/VtiInvited
 */

import { useAgent } from '@bifold/react-hooks'
import Clipboard from '@react-native-clipboard/clipboard'
import { useNavigation } from '@react-navigation/native'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import QRRenderer from '../../../components/misc/QRRenderer'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { requestBiometricConfirmationWithUI } from '../../vrc/vrc-biometric'
import { GenericRecordsCommunityStore, type VtiInvitation } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from '../module/VtiIdentityStore'
import { ensurePersonaFor, joinCommunity } from '../module/vtiJoin'
import { joinSeed } from '../module/vtiJoinSeed'

import { didName, identityShareText, shareIdentity } from './identityShare'
import { JoinAs, useJoinAsChoice } from './JoinAs'
import { openScanner } from './openScanner'
import { useCommunityDid } from './useCommunity'
import { useVtaDid } from './VtaStatus'

type Step = 'intro' | 'share' | 'waiting' | 'joined'

export interface VtiInvitedProps {
  config?: { mediatorDid?: string; communityDid?: string; vtaDid?: string }
}

const VtiInvited: React.FC<VtiInvitedProps> = ({ config }) => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const navigation = useNavigation()
  const { ColorPalette, TextTheme } = useTheme()
  const { width } = useWindowDimensions()
  const communityDid = useCommunityDid(config?.communityDid)
  const mediatorDid = config?.mediatorDid
  const vtaDid = useVtaDid(config?.vtaDid)

  const [persona, setPersona] = useState<VtiPersona>()
  const [invitation, setInvitation] = useState<VtiInvitation>()
  const [loaded, setLoaded] = useState(false)
  const [step, setStep] = useState<Step>('intro')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const joinAs = useJoinAsChoice(navigation)

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { flexGrow: 1, padding: 20, gap: 16 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    actions: { padding: 20, gap: 12 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    error: { color: ColorPalette.semantic.error },
    mono: { ...TextTheme.normal, fontFamily: 'Menlo', fontSize: 12 },
  })

  // What the phone already holds decides where the person picks up: an
  // identity made earlier goes straight to sending it, an invitation that
  // already arrived straight to joining.
  const load = useCallback(async () => {
    if (!agent || !communityDid) return
    const [p, invitations] = await Promise.all([
      new GenericRecordsIdentityStore(agent).getPersona(communityDid),
      new GenericRecordsCommunityStore(agent).listInvitations(),
    ])
    setPersona(p)
    setInvitation(
      p
        ? invitations.find((i) => i.status === 'pending' && i.communityDid === communityDid && i.subjectDid === p.did)
        : undefined
    )
    return p
  }, [agent, communityDid])

  useEffect(() => {
    load()
      .then((p) => {
        if (p) setStep((s) => (s === 'intro' ? 'share' : s))
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoaded(true))
  }, [load])

  // While waiting, look for the invitation: it arrives by deep link or paste
  // while this screen may be open.
  useEffect(() => {
    if (step !== 'waiting') return
    const timer = setInterval(() => void load(), 3000)
    return () => clearInterval(timer)
  }, [step, load])

  const onContinue = useCallback(async () => {
    if (!agent || !vtaDid || !communityDid) return
    setError(undefined)
    const confirmed = await requestBiometricConfirmationWithUI(agent, didName(communityDid), 'invited', {
      title: t('Invited.ConfirmTitle'),
      description: t('Invited.ConfirmBody', { community: didName(communityDid), interpolation: { escapeValue: false } }),
    })
    if (!confirmed.success) return
    setBusy(true)
    try {
      await ensurePersonaFor({ agent, identityStore: new GenericRecordsIdentityStore(agent), vtaDid, communityDid })
      // Seed by copy: the chosen profile fills the identity's name in once.
      if (joinAs.selected) joinSeed.set(communityDid, joinAs.selected.seed)
      await load()
      setStep('share')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [agent, vtaDid, communityDid, load, t, joinAs.selected])

  const onJoin = useCallback(async () => {
    if (!agent || !vtaDid || !invitation) return
    setError(undefined)
    setBusy(true)
    try {
      await joinCommunity(
        {
          agent,
          identityStore: new GenericRecordsIdentityStore(agent),
          communityStore: new GenericRecordsCommunityStore(agent),
          vtaDid,
          mediatorDid,
          communityDid: invitation.communityDid,
        },
        invitation
      )
      setStep('joined')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [agent, vtaDid, mediatorDid, invitation])

  const scan = () => openScanner(navigation)

  if (!communityDid || !vtaDid) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.content}>
          <ThemedText testID={testIdWithKey('InvitedNotConfigured')}>{t('MyAgent.NotConfigured')}</ThemedText>
        </View>
      </SafeAreaView>
    )
  }
  if (!loaded) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={[styles.content, { justifyContent: 'center' }]}>
          <ActivityIndicator color={ColorPalette.brand.primary} />
        </View>
      </SafeAreaView>
    )
  }

  const community = didName(communityDid)
  const header = (n: number, title: string) => (
    <View style={{ gap: 4 }}>
      <ThemedText style={styles.muted} testID={testIdWithKey('InvitedStepIndicator')}>
        {t('Vetting.StepOf', { n, of: 3 })}
      </ThemedText>
      <ThemedText variant="headingThree" accessibilityRole="header">
        {title}
      </ThemedText>
    </View>
  )
  const errorLine = error ? (
    <ThemedText style={styles.error} testID={testIdWithKey('InvitedError')}>
      {error}
    </ThemedText>
  ) : null

  let body: React.ReactNode
  let actions: React.ReactNode

  // An invitation for this identity is the next thing to act on, whatever step
  // the person left the screen at.
  const current: Step = step === 'joined' ? 'joined' : invitation ? 'waiting' : step

  switch (current) {
    case 'intro':
      body = (
        <>
          {header(1, t('Invited.IntroTitle'))}
          <ThemedText>{t('Invited.IntroBody', { community, interpolation: { escapeValue: false } })}</ThemedText>
          <ThemedText variant="bold">{t('Join.AsTitle')}</ThemedText>
          <JoinAs
            community={community}
            options={joinAs.options}
            selectedId={joinAs.selectedId}
            onSelect={joinAs.setSelectedId}
            onCreate={joinAs.createProfile}
          />
          {errorLine}
        </>
      )
      actions = (
        <Button
          title={busy ? t('Invited.Preparing') : t('Invited.Continue')}
          buttonType={ButtonType.Primary}
          onPress={() => void onContinue()}
          disabled={busy}
          testID={testIdWithKey('InvitedContinue')}
        >
          {busy ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
        </Button>
      )
      break

    case 'share':
      body = (
        <>
          {header(2, t('Invited.ShareStepTitle'))}
          <ThemedText>{t('Invited.ShareStepBody', { community, interpolation: { escapeValue: false } })}</ThemedText>
          <View style={styles.card} testID={testIdWithKey('InvitedIdentityCard')}>
            <View style={styles.row}>
              <Icon name="account-circle-outline" size={24} color={TextTheme.normal.color} />
              <ThemedText>
                {t('VtaLink.IdentityFor', { community, interpolation: { escapeValue: false } })}
              </ThemedText>
            </View>
            {showQr && persona ? (
              <View style={{ alignItems: 'center', paddingVertical: 8 }} testID={testIdWithKey('InvitedQr')}>
                <QRRenderer value={persona.did} size={Math.min(240, width - 80)} />
              </View>
            ) : null}
            <Pressable
              style={styles.row}
              onPress={() => setDetailsOpen(!detailsOpen)}
              accessibilityRole="button"
              accessibilityState={{ expanded: detailsOpen }}
              testID={testIdWithKey('InvitedDetailsToggle')}
            >
              <Icon name={detailsOpen ? 'chevron-down' : 'chevron-right'} size={20} color={TextTheme.normal.color} />
              <ThemedText style={styles.muted}>{t('VtaLink.Details')}</ThemedText>
            </Pressable>
            {detailsOpen && persona ? (
              <ThemedText style={styles.mono} selectable testID={testIdWithKey('InvitedPersonaDid')}>
                {persona.did}
              </ThemedText>
            ) : null}
          </View>
          {errorLine}
        </>
      )
      actions = persona ? (
        <>
          <Button
            title={t('Invited.Share')}
            buttonType={ButtonType.Primary}
            onPress={() => void shareIdentity(t, communityDid, persona.did)}
            testID={testIdWithKey('InvitedShare')}
          />
          <Button
            title={copied ? t('Invited.Copied') : t('Invited.Copy')}
            buttonType={ButtonType.Secondary}
            onPress={() => {
              Clipboard.setString(identityShareText(t, communityDid, persona.did))
              setCopied(true)
            }}
            testID={testIdWithKey('InvitedCopy')}
          />
          <Button
            title={showQr ? t('Invited.HideQr') : t('Invited.ShowQr')}
            buttonType={ButtonType.Tertiary}
            onPress={() => setShowQr(!showQr)}
            testID={testIdWithKey('InvitedShowQr')}
          />
          <Button
            title={t('Invited.Sent')}
            buttonType={ButtonType.Tertiary}
            onPress={() => setStep('waiting')}
            testID={testIdWithKey('InvitedSent')}
          />
        </>
      ) : null
      break

    case 'waiting':
      body = invitation ? (
        <>
          {header(3, t('Invited.ArrivedTitle'))}
          <View style={styles.card} testID={testIdWithKey('InvitedInvitationCard')}>
            <View style={styles.row}>
              <Icon name="email-check-outline" size={24} color={ColorPalette.semantic.success} />
              <ThemedText>{t('Invited.ArrivedBody', { community, interpolation: { escapeValue: false } })}</ThemedText>
            </View>
          </View>
          {errorLine}
        </>
      ) : (
        <>
          {header(3, t('Invited.WaitingTitle'))}
          <ThemedText>{t('Invited.WaitingBody', { community, interpolation: { escapeValue: false } })}</ThemedText>
          <View style={styles.row} testID={testIdWithKey('InvitedWaiting')}>
            <ActivityIndicator color={ColorPalette.brand.primary} />
            <ThemedText style={styles.muted}>{t('Invited.Checking')}</ThemedText>
          </View>
          {errorLine}
        </>
      )
      actions = invitation ? (
        <Button
          title={busy ? t('MyAgent.Joining') : t('MyAgent.Join')}
          buttonType={ButtonType.Primary}
          onPress={() => void onJoin()}
          disabled={busy}
          testID={testIdWithKey('InvitedJoin')}
        >
          {busy ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
        </Button>
      ) : (
        <>
          <Button
            title={t('Invited.Paste')}
            buttonType={ButtonType.Secondary}
            onPress={scan}
            testID={testIdWithKey('InvitedPaste')}
          />
          <Button
            title={t('Invited.SendAgain')}
            buttonType={ButtonType.Tertiary}
            onPress={() => setStep('share')}
            testID={testIdWithKey('InvitedSendAgain')}
          />
        </>
      )
      break

    case 'joined':
      body = (
        <View style={styles.card} testID={testIdWithKey('InvitedJoined')}>
          <View style={styles.row}>
            <Icon name="check-circle" size={24} color={ColorPalette.semantic.success} />
            <ThemedText variant="headingThree" accessibilityRole="header">
              {t('Invited.JoinedTitle', { community, interpolation: { escapeValue: false } })}
            </ThemedText>
          </View>
          <ThemedText>{t('Invited.JoinedBody')}</ThemedText>
        </View>
      )
      actions = (
        <Button
          title={t('VtaLink.Continue')}
          buttonType={ButtonType.Primary}
          onPress={() =>
            (navigation as unknown as { navigate: (name: string, params?: object) => void }).navigate(
              Screens.VtiCommunity,
              { communityDid }
            )
          }
          testID={testIdWithKey('InvitedDone')}
        />
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

export default VtiInvited
