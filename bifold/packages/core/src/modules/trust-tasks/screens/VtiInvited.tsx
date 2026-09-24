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
import { communityTarget } from '../module/vtiCommunityLink'
import { vtiAgent } from '../module/vtiAgent'
import { ensurePersonaFor, joinCommunity } from '../module/vtiJoin'
import { joinSeed } from '../module/vtiJoinSeed'
import { communityLinkReturn } from '../module/vtiLinks'

import { identityShareText, shareIdentity } from './identityShare'
import { communityLabelOf, communityLabelStartOf } from './communityName'
import { needWords } from './claimWords'
import { DidDetails } from './DidDetails'
import { DirectoryConsent } from './DirectoryConsent'
import { JoinAs, useJoinAsChoice } from './JoinAs'
import { openScanner } from './openScanner'
import { plainError, type PlainError } from './plainError'
import { useCommunityDid } from './useCommunity'
import { asksFrom, type Asks } from './VtiJoin'
import { useVtaDid } from './VtaStatus'

type Step = 'intro' | 'share' | 'waiting' | 'joined' | 'deferred' | 'pending'

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
  // Off unless the person turns it on (VTI-Q14).
  const [listMe, setListMe] = useState(false)
  // What the community still needs, when it answered the join "not yet".
  const [needs, setNeeds] = useState<string[]>([])
  // What the community asks, so the screen says truthfully whether the
  // invitation is enough: where every way in is vetted, it is not (join.rego).
  const [asks, setAsks] = useState<Asks>()
  useEffect(() => {
    if (!communityDid) return
    let live = true
    setAsks(undefined)
    vtiAgent
      .fetchManifest(communityDid, agent)
      .then((m) => live && setAsks(asksFrom(m)))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [communityDid, agent])
  const vetsEveryone = asks?.kind === 'vetting' && !asks.invitationAdmits
  const [error, setError] = useState<PlainError>()
  const [errorOpen, setErrorOpen] = useState(false)
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
    errorDetail: { maxHeight: 160 },
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
      .catch((e) => setError(plainError(e)))
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
    const confirmed = await requestBiometricConfirmationWithUI(
      agent,
      communityLabelStartOf(communityDid, t),
      'invited',
      {
        title: t('Invited.ConfirmTitle'),
        description: t('Invited.ConfirmBody', {
          community: communityLabelOf(communityDid, t),
          interpolation: { escapeValue: false },
        }),
      }
    )
    if (!confirmed.success) return
    setBusy(true)
    try {
      await ensurePersonaFor({ agent, identityStore: new GenericRecordsIdentityStore(agent), vtaDid, communityDid })
      // Making the identity is what makes this the phone's community.
      communityTarget.choose(communityDid)
      // Seed by copy: the chosen profile fills the identity's name in once.
      if (joinAs.selected) joinSeed.set(communityDid, joinAs.selected.seed)
      await load()
      setStep('share')
    } catch (e) {
      setError(plainError(e))
    } finally {
      setBusy(false)
    }
  }, [agent, vtaDid, communityDid, load, t, joinAs.selected])

  const onJoin = useCallback(async () => {
    if (!agent || !vtaDid || !invitation) return
    setError(undefined)
    setBusy(true)
    try {
      const result = await joinCommunity(
        {
          agent,
          identityStore: new GenericRecordsIdentityStore(agent),
          communityStore: new GenericRecordsCommunityStore(agent),
          vtaDid,
          mediatorDid,
          communityDid: invitation.communityDid,
          registryConsent: listMe,
        },
        invitation
      )
      // The community's answer, not "it returned": a community that vets
      // everyone answers an invitation with request_more, and this used to
      // say "You're a member" to someone who was not (220).
      const effect = result.verdict?.effect
      if (effect === 'allow' || (!effect && result.membership)) {
        setStep('joined')
      } else if (effect === 'requestMore') {
        communityTarget.choose(invitation.communityDid)
        setNeeds(result.verdict.needs ?? [])
        setStep('deferred')
      } else if (effect === 'refer') {
        setStep('pending')
      } else {
        throw new Error(`the community answered ${effect ?? 'nothing'}`)
      }
    } catch (e) {
      setError(plainError(e))
    } finally {
      setBusy(false)
    }
  }, [agent, vtaDid, mediatorDid, invitation, listMe])

  const scan = () => openScanner(navigation)

  // Nothing is named by the build (a store build): say what is missing, and
  // offer the way to it — never "No agent is configured for this build".
  if (!vtaDid) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.content}>
          <ThemedText testID={testIdWithKey('InvitedNeedsAgent')}>{t('Join.NeedsAgent')}</ThemedText>
          <Button
            title={t('VtaLink.LinkYourAgent')}
            buttonType={ButtonType.Primary}
            onPress={() => (navigation as unknown as { navigate: (name: string) => void }).navigate(Screens.VtaLink)}
            testID={testIdWithKey('InvitedLinkAgent')}
          />
        </View>
      </SafeAreaView>
    )
  }
  // The community first: the admin invites an identity made for it, so it has
  // to be known before any invitation can exist.
  if (!communityDid) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.content} testID={testIdWithKey('InvitedWhichCommunity')}>
          <ThemedText variant="headingThree" accessibilityRole="header">
            {t('Invited.WhichCommunityTitle')}
          </ThemedText>
          <ThemedText>{t('Invited.WhichCommunityBody')}</ThemedText>
          <Button
            title={t('Invited.ScanCommunity')}
            buttonType={ButtonType.Primary}
            onPress={() => {
              communityLinkReturn.toInvited()
              scan()
            }}
            testID={testIdWithKey('InvitedScanCommunity')}
          />
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

  const community = communityLabelOf(communityDid, t)
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
  // What happened and what to do, as Join says it; the original text stays
  // under Details. It showed raw ("[TrustTasks:VtaClient] the agent has no DID
  // host…") when the agent had nowhere to publish (Farm, 2026-09-24).
  // It sits in the actions, above the button that failed: at the end of the
  // body it fell below the fold on Android, and Continue looked like it did
  // nothing (221). Details scroll inside the card, so the buttons stay put.
  const errorLine = error ? (
    <View style={styles.card} testID={testIdWithKey('InvitedErrorCard')}>
      <ThemedText style={styles.error} testID={testIdWithKey('InvitedError')}>
        {t(error.line)}
      </ThemedText>
      <Pressable
        onPress={() => setErrorOpen((open) => !open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: errorOpen }}
        testID={testIdWithKey('InvitedErrorDetailsToggle')}
      >
        <ThemedText style={styles.muted}>{t('Errors.ShowDetails')}</ThemedText>
      </Pressable>
      {errorOpen ? (
        <ScrollView style={styles.errorDetail}>
          <ThemedText style={styles.muted} selectable testID={testIdWithKey('InvitedErrorDetail')}>
            {error.detail}
          </ThemedText>
        </ScrollView>
      ) : null}
    </View>
  ) : null

  let body: React.ReactNode
  let actions: React.ReactNode

  // An invitation for this identity is the next thing to act on, whatever step
  // the person left the screen at.
  const current: Step =
    step === 'joined' || step === 'deferred' || step === 'pending' ? step : invitation ? 'waiting' : step

  switch (current) {
    case 'intro':
      body = (
        <>
          {header(1, t('Invited.IntroTitle'))}
          <ThemedText>{t('Invited.IntroBody', { community, interpolation: { escapeValue: false } })}</ThemedText>
          {vetsEveryone ? (
            <ThemedText testID={testIdWithKey('InvitedVetsNote')}>
              {t('Invited.IntroVets', {
                community: communityLabelStartOf(communityDid, t),
                interpolation: { escapeValue: false },
              })}
            </ThemedText>
          ) : null}
          <ThemedText variant="bold">{t('Join.AsTitle')}</ThemedText>
          <JoinAs
            community={community}
            options={joinAs.options}
            selectedId={joinAs.selectedId}
            onSelect={joinAs.setSelectedId}
            onCreate={joinAs.createProfile}
          />
        </>
      )
      actions = (
        <>
          {errorLine}
          <Button
            title={busy ? t('Invited.Preparing') : t('Invited.Continue')}
            buttonType={ButtonType.Primary}
            onPress={() => void onContinue()}
            disabled={busy}
            testID={testIdWithKey('InvitedContinue')}
          >
            {busy ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
          </Button>
        </>
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
              <ThemedText>{t('VtaLink.IdentityFor', { community, interpolation: { escapeValue: false } })}</ThemedText>
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
        </>
      )
      actions = persona ? (
        <>
          {errorLine}
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
      ) : (
        errorLine
      )
      break

    case 'waiting':
      body = invitation ? (
        <>
          {header(3, t('Invited.ArrivedTitle'))}
          <View style={styles.card} testID={testIdWithKey('InvitedInvitationCard')}>
            <View style={styles.row}>
              <Icon name="email-check-outline" size={24} color={ColorPalette.semantic.success} />
              <ThemedText testID={testIdWithKey('InvitedArrivedBody')}>
                {t(vetsEveryone ? 'Invited.ArrivedBodyVets' : 'Invited.ArrivedBody', {
                  community,
                  interpolation: { escapeValue: false },
                })}
              </ThemedText>
            </View>
            <DidDetails did={invitation.communityDid} testIdStem="InvitedCommunity" />
          </View>
          <DirectoryConsent
            communityDid={invitation.communityDid}
            value={listMe}
            onChange={setListMe}
            disabled={busy}
          />
        </>
      ) : (
        <>
          {header(3, t('Invited.WaitingTitle'))}
          <ThemedText>{t('Invited.WaitingBody', { community, interpolation: { escapeValue: false } })}</ThemedText>
          <View style={styles.row} testID={testIdWithKey('InvitedWaiting')}>
            <ActivityIndicator color={ColorPalette.brand.primary} />
            <ThemedText style={styles.muted}>{t('Invited.Checking')}</ThemedText>
          </View>
        </>
      )
      actions = invitation ? (
        <>
          {errorLine}
          <Button
            title={busy ? t('MyAgent.Joining') : t('MyAgent.Join')}
            buttonType={ButtonType.Primary}
            onPress={() => void onJoin()}
            disabled={busy}
            testID={testIdWithKey('InvitedJoin')}
          >
            {busy ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
          </Button>
        </>
      ) : (
        <>
          {errorLine}
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

    case 'deferred':
      body = (
        <View style={styles.card} testID={testIdWithKey('InvitedDeferred')}>
          <ThemedText variant="headingThree" accessibilityRole="header">
            {t('Invited.DeferredTitle', { community, interpolation: { escapeValue: false } })}
          </ThemedText>
          <ThemedText>{t('Invited.DeferredBody', { community, interpolation: { escapeValue: false } })}</ThemedText>
          {needs.map((need, i) => (
            <ThemedText key={i} testID={testIdWithKey('InvitedDeferredNeed')}>
              {'• '}
              {needWords(need, t)}
            </ThemedText>
          ))}
        </View>
      )
      actions = (
        <Button
          title={t('VtaLink.ContinueVetting')}
          buttonType={ButtonType.Primary}
          onPress={() => (navigation as unknown as { navigate: (name: string) => void }).navigate(Screens.VtiVetting)}
          testID={testIdWithKey('InvitedContinueVetting')}
        />
      )
      break

    case 'pending':
      body = (
        <View style={styles.card} testID={testIdWithKey('InvitedPending')}>
          <ThemedText variant="headingThree" accessibilityRole="header">
            {t('Invited.PendingTitle', { community, interpolation: { escapeValue: false } })}
          </ThemedText>
          <ThemedText>{t('Join.StandingWithInvitation')}</ThemedText>
        </View>
      )
      actions = null
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
