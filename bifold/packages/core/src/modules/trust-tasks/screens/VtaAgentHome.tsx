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
import { useVtiPersonaDeliveries } from '../module/vtiPersonaInbox'

import { shareIdentity } from './identityShare'
import { communityLabelOf } from './communityName'
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
    strip: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 },
    stop: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
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
  // A grant, a card or an invitation that arrives while this screen is open
  // shows without a visit to Vetting: the persona inbox says when it stored one.
  useVtiPersonaDeliveries(() => void load())

  const onRefresh = useCallback(async () => {
    if (!agent) return
    setRefreshing(true)
    await vtaAgent.ensureOnline(agent)
    await load()
    setRefreshing(false)
  }, [agent, load])

  const go = (screen: Screens) => (navigation as unknown as { navigate: (name: string) => void }).navigate(screen)

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
    const community = communityLabelOf(communityDid)
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
          <View style={styles.strip} testID={testIdWithKey('AgentJourney')} accessibilityRole="summary">
            {[
              { key: 'Linked', done: true, now: false },
              { key: 'Join', done: isMember, now: !isMember },
              { key: 'Member', done: isMember, now: false },
            ].map((stop, i) => (
              <React.Fragment key={stop.key}>
                {i > 0 ? <Icon name="chevron-right" size={16} color={ColorPalette.grayscale.mediumGrey} /> : null}
                <View
                  style={[styles.stop, stop.now ? styles.stopNow : undefined]}
                  accessibilityState={{ selected: stop.now }}
                >
                  <ThemedText style={stop.done ? styles.stopDone : stop.now ? styles.stopNowText : styles.muted}>
                    {stop.done ? '✓ ' : ''}
                    {t(`VtaLink.Journey${stop.key}`)}
                  </ThemedText>
                </View>
              </React.Fragment>
            ))}
          </View>
          <Pressable
            onPress={() => vtaAgent.showIntro()}
            accessibilityRole="link"
            testID={testIdWithKey('WhatIsMyAgent')}
          >
            <ThemedText style={styles.link}>{t('VtaLink.WhatIsMyAgent')}</ThemedText>
          </Pressable>
        </View>

        {/* The vetter role is news, not a step: it shows when an admin grants it. */}
        {holdings?.vetterFor.map((communityDid) => (
          <View key={communityDid} style={[styles.card, styles.tip]} testID={testIdWithKey('AgentVetterCard')}>
            <ThemedText variant="bold">
              {t('VtaLink.YouCanVet', { community: communityLabelOf(communityDid), interpolation: { escapeValue: false } })}
            </ThemedText>
            <ThemedText style={styles.muted}>{t('VtaLink.YouCanVetBody')}</ThemedText>
            <Button
              title={t('VtaLink.OpenDesk')}
              buttonType={ButtonType.Secondary}
              onPress={() => go(Screens.VtiVetting)}
              testID={testIdWithKey('AgentVetOthers')}
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

        {/* Start from what the person wants: two doors, one marked as next. */}
        <View style={styles.card} testID={testIdWithKey('AgentDoors')}>
          {isMember ? (
            <>
              <ThemedText variant="labelTitle">{t('VtaLink.YourCommunities')}</ThemedText>
              <Button
                title={t('VtaLink.OpenCommunities')}
                buttonType={ButtonType.Primary}
                onPress={() => go(Screens.MyAgent)}
                testID={testIdWithKey('AgentOpenCommunities')}
              />
            </>
          ) : (
            <ThemedText variant="headingFour" accessibilityRole="header">
              {t('VtaLink.WhatBringsYou')}
            </ThemedText>
          )}
          <Pressable
            style={[styles.door, isMember ? undefined : styles.doorNext]}
            onPress={() => go(Screens.VtiInvited)}
            accessibilityRole="button"
            testID={testIdWithKey('AgentInvited')}
          >
            <Icon name="email-open-outline" size={24} color={ColorPalette.brand.primary} />
            <View style={{ flex: 1 }}>
              <ThemedText variant="bold">{t('VtaLink.IWasInvited')}</ThemedText>
              <ThemedText style={styles.muted}>{t('VtaLink.IWasInvitedHint')}</ThemedText>
            </View>
            <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
          </Pressable>
          <Pressable
            style={[styles.door, isMember ? undefined : styles.doorNext]}
            onPress={() => go(Screens.VtiJoin)}
            accessibilityRole="button"
            testID={testIdWithKey('AgentJoinCommunity')}
          >
            <Icon name="account-group-outline" size={24} color={ColorPalette.brand.primary} />
            <View style={{ flex: 1 }}>
              <ThemedText variant="bold">{isMember ? t('VtaLink.JoinAnother') : t('VtaLink.WantToJoin')}</ThemedText>
              <ThemedText style={styles.muted}>{t('VtaLink.WantToJoinHint')}</ThemedText>
            </View>
            <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
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
                      community: communityLabelOf(p.communityDid),
                      interpolation: { escapeValue: false },
                    })}
                  </ThemedText>
                  {/* The admin needs this identity to invite it (TestFlight report #3). */}
                  <Pressable
                    onPress={() => void shareIdentity(t, p.communityDid, p.did)}
                    accessibilityRole="button"
                    accessibilityLabel={t('VtaLink.ShareIdentity', {
                      community: communityLabelOf(p.communityDid),
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
                      community: communityLabelOf(m.communityDid),
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
