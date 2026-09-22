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
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
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

import { didName } from './identityShare'
import { openScanner } from './openScanner'
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
  const communityDid = community?.communityDid
  const name = community?.name ?? (communityDid ? didName(communityDid) : '')

  // A community named by a link goes straight to what it asks; the build's
  // suggestion is offered first, beside "a different community".
  const [step, setStep] = useState<Step>(chosenByLink ? 'asks' : 'which')
  const [asks, setAsks] = useState<Asks>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const joinAs = useJoinAsChoice(navigation)

  useEffect(() => {
    if (chosenByLink) setStep((s) => (s === 'which' ? 'asks' : s))
  }, [chosenByLink])

  // The community's own words, when a session is already open to read them;
  // otherwise what every vetting community asks.
  useEffect(() => {
    if (step !== 'asks' || !communityDid) return
    let live = true
    setAsks(undefined)
    if (vtiAgent.getState().status !== 'connected') return
    vtiAgent
      .fetchManifest(communityDid)
      .then((m) => live && setAsks(asksFrom(m)))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [step, communityDid])

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
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [agent, vtaDid, communityDid, name, navigation, t, joinAs.selected])

  if (!vtaDid) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.content}>
          <ThemedText testID={testIdWithKey('JoinNeedsAgent')}>{t('Join.NeedsAgent')}</ThemedText>
        </View>
      </SafeAreaView>
    )
  }

  const errorLine = error ? (
    <ThemedText style={styles.error} testID={testIdWithKey('JoinError')}>
      {error}
    </ThemedText>
  ) : null

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
          {communityDid ? (
            <View style={styles.card} testID={testIdWithKey('JoinSuggested')}>
              <View style={styles.row}>
                <Icon name="account-group-outline" size={24} color={ColorPalette.brand.primary} />
                <ThemedText variant="bold">{name}</ThemedText>
              </View>
              <ThemedText style={styles.muted}>{t('Join.Suggested')}</ThemedText>
            </View>
          ) : null}
        </>
      )
      actions = (
        <>
          {communityDid ? (
            <Button
              title={t('Join.JoinThis', { community: name, interpolation: { escapeValue: false } })}
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
          <View style={styles.card} testID={testIdWithKey('JoinAsks')}>
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
      actions = asks?.invitationOnly ? (
        <Button
          title={t('VtaLink.IWasInvited')}
          buttonType={ButtonType.Primary}
          onPress={() => (navigation as unknown as { navigate: (name: string) => void }).navigate(Screens.VtiInvited)}
          testID={testIdWithKey('JoinGoInvited')}
        />
      ) : (
        <Button
          title={t('Join.Start')}
          buttonType={ButtonType.Primary}
          onPress={() => setStep('as')}
          testID={testIdWithKey('JoinStart')}
        />
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
              community={name}
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
