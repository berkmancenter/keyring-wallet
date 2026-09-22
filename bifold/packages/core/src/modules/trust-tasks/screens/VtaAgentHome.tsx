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
import { useNavigation } from '@react-navigation/native'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { GenericRecordsCommunityStore, type VtiMembership } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from '../module/VtiIdentityStore'
import { vtaAgent, type VtaActivity } from '../module/vtaAgent'
import { ownVetterGrantState, type VetterGrantState } from '../module/vtiGrantState'

import { didName, shareIdentity } from './identityShare'
import { openScanner } from './openScanner'
import { useVtaLinkWithClock, VtaStatusLine } from './VtaStatus'

interface Holdings {
  personas: VtiPersona[]
  memberships: VtiMembership[]
  vetterFor: string[]
  /** Communities where this phone was a vetter and is not now: why, for the person. */
  lapsed: { communityDid: string; grant: Exclude<VetterGrantState, { state: 'active' } | { state: 'none' }> }[]
}


const INTRO_PANELS = ['IntroKeeps', 'IntroAnswers', 'IntroApprove'] as const

const VtaAgentHome: React.FC = () => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const navigation = useNavigation()
  const { ColorPalette, TextTheme } = useTheme()
  const { state } = useVtaLinkWithClock()
  const { link } = state
  const [holdings, setHoldings] = useState<Holdings>()
  const [holdingsError, setHoldingsError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [introPanel, setIntroPanel] = useState(0)

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 20, gap: 16 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    mono: { ...TextTheme.normal, fontFamily: 'Menlo', fontSize: 12 },
    locked: { opacity: 0.55 },
    link: { color: ColorPalette.brand.link, textDecorationLine: 'underline' },
  })

  const load = useCallback(async () => {
    if (!agent) return
    try {
      const communities = new GenericRecordsCommunityStore(agent)
      const [personas, memberships] = await Promise.all([
        new GenericRecordsIdentityStore(agent).listPersonas(),
        communities.listMemberships(),
      ])
      // A vetter is one whose grant still stands — in its window and not
      // revoked — not one who was ever granted.
      const grants = await Promise.all(
        personas.map(async (p) => {
          const held = await communities.listHeldCredentials('vetter-grant', p.communityDid)
          const own = held.filter((g) => g.subjectDid === p.did)
          return { communityDid: p.communityDid, grant: await ownVetterGrantState(agent, own, { allowInsecureLocal: __DEV__ }) }
        })
      )
      setHoldings({
        personas,
        memberships,
        vetterFor: grants.filter((g) => g.grant.state === 'active').map((g) => g.communityDid),
        lapsed: grants.flatMap((g) =>
          g.grant.state === 'revoked' || g.grant.state === 'expired' || g.grant.state === 'notYetValid'
            ? [{ communityDid: g.communityDid, grant: g.grant }]
            : []
        ),
      })
      setHoldingsError(false)
    } catch {
      // Keep what was shown; say it could not be refreshed.
      setHoldingsError(true)
    }
  }, [agent])

  useEffect(() => {
    void load()
  }, [load])

  const onRefresh = useCallback(async () => {
    if (!agent) return
    setRefreshing(true)
    await vtaAgent.ensureOnline(agent)
    await load()
    setRefreshing(false)
  }, [agent, load])

  const go = (screen: Screens) => (navigation as unknown as { navigate: (name: string) => void }).navigate(screen)
  const scan = () => openScanner(navigation)

  if (link.kind !== 'linked') {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.content}>
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
  const isVetter = (holdings?.vetterFor.length ?? 0) > 0
  const isMember = (holdings?.memberships.length ?? 0) > 0
  const lapsed = holdings?.lapsed ?? []
  const day = (iso: string) => new Date(iso).toLocaleDateString()
  const lapsedText = (communityDid: string, grant: Holdings['lapsed'][number]['grant']) => {
    const community = didName(communityDid)
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
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
        testID={testIdWithKey('AgentHome')}
      >
        <View style={styles.card}>
          <ThemedText variant="headingThree" accessibilityRole="header">
            {link.label}
          </ThemedText>
          <VtaStatusLine connection={link.connection} />
          <Pressable
            onPress={() => vtaAgent.showIntro()}
            accessibilityRole="link"
            testID={testIdWithKey('WhatIsMyAgent')}
          >
            <ThemedText style={styles.link}>{t('VtaLink.WhatIsMyAgent')}</ThemedText>
          </Pressable>
        </View>

        <View style={styles.card} testID={testIdWithKey('AgentHolds')}>
          <ThemedText variant="labelTitle">{t('VtaLink.Holds')}</ThemedText>
          {!holdings ? (
            <ActivityIndicator color={ColorPalette.brand.primary} />
          ) : holdings.personas.length === 0 && holdings.memberships.length === 0 ? (
            <ThemedText style={styles.muted}>{t('VtaLink.HoldsNothing')}</ThemedText>
          ) : (
            <>
              {holdings.personas.map((p) => (
                <View key={p.did} style={styles.row}>
                  <Icon name="account-circle-outline" size={20} color={TextTheme.normal.color} />
                  <ThemedText style={{ flex: 1 }}>
                    {t('VtaLink.IdentityFor', {
                      community: didName(p.communityDid),
                      interpolation: { escapeValue: false },
                    })}
                  </ThemedText>
                  {/* The admin needs this identity to invite it (TestFlight report #3). */}
                  <Pressable
                    onPress={() => void shareIdentity(t, p.communityDid, p.did)}
                    accessibilityRole="button"
                    accessibilityLabel={t('VtaLink.ShareIdentity', {
                      community: didName(p.communityDid),
                      interpolation: { escapeValue: false },
                    })}
                    hitSlop={12}
                    testID={testIdWithKey('AgentShareIdentity')}
                  >
                    <Icon name="share-variant" size={22} color={ColorPalette.brand.link} />
                  </Pressable>
                </View>
              ))}
              {holdings.memberships.map((m) => (
                <View key={m.communityDid} style={styles.row}>
                  <Icon name="card-account-details-outline" size={20} color={TextTheme.normal.color} />
                  <ThemedText>
                    {t('VtaLink.MemberOf', {
                      community: didName(m.communityDid),
                      interpolation: { escapeValue: false },
                    })}
                  </ThemedText>
                </View>
              ))}
            </>
          )}
          {holdingsError ? <ThemedText style={styles.muted}>{t('VtaLink.HoldsStale')}</ThemedText> : null}
        </View>

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

        <View style={styles.card} testID={testIdWithKey('AgentCanDo')}>
          <ThemedText variant="labelTitle">{t('VtaLink.CanDo')}</ThemedText>
          <Button
            title={t('VtaLink.JoinCommunity')}
            buttonType={ButtonType.Secondary}
            onPress={scan}
            testID={testIdWithKey('AgentJoinCommunity')}
          />
          <Button
            title={t('VtaLink.IWasInvited')}
            buttonType={ButtonType.Secondary}
            onPress={() => go(Screens.VtiInvited)}
            testID={testIdWithKey('AgentInvited')}
          />
          <ThemedText style={styles.muted}>{t('VtaLink.IWasInvitedHint')}</ThemedText>
          <Button
            title={isMember ? t('VtaLink.OpenCommunities') : t('VtaLink.GetVetted')}
            buttonType={ButtonType.Secondary}
            onPress={() => go(isMember ? Screens.MyAgent : Screens.VtiVetting)}
            testID={testIdWithKey('AgentGetVetted')}
          />
          <View style={isVetter ? undefined : styles.locked}>
            <Button
              title={t('VtaLink.VetOthers')}
              buttonType={ButtonType.Secondary}
              onPress={() => go(Screens.VtiVetting)}
              disabled={!isVetter}
              testID={testIdWithKey('AgentVetOthers')}
            />
          </View>
          {!isVetter && lapsed.length > 0
            ? lapsed.map(({ communityDid, grant }) => (
                <ThemedText key={communityDid} style={styles.muted} testID={testIdWithKey('AgentVetterLapsed')}>
                  {lapsedText(communityDid, grant)}
                </ThemedText>
              ))
            : null}
          {!isVetter && lapsed.length === 0 ? (
            <ThemedText style={styles.muted} testID={testIdWithKey('AgentVetOthersLocked')}>
              {t('VtaLink.VetOthersLocked')}
            </ThemedText>
          ) : null}
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
      </ScrollView>
    </SafeAreaView>
  )
}

export default VtaAgentHome
