/**
 * Community — S5 and the first half of S7 in `community_vetting_subtask.md`
 * §7.1: what this community asks of an applicant, and applying.
 *
 * The criteria are the community's own words, fetched from its manifest rather
 * than written into the app, because a community can change what it asks.
 *
 * @module trust-tasks/screens/VtiCommunity
 */

import type { RouteProp } from '@react-navigation/native'
import { useAgent } from '@bifold/react-hooks'
import { useNavigation, useRoute } from '@react-navigation/native'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Toast from 'react-native-toast-message'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ToastType } from '../../../components/toast/BaseToast'

import { useTheme } from '../../../contexts/theme'
import { Screens, type MyAgentStackParams } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { GenericRecordsCommunityStore } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore } from '../module/VtiIdentityStore'
import { selfRemoveRefusal, vtiAgent, type VtiManifest } from '../module/vtiAgent'
import { leaveCommunity } from '../module/vtiJoin'
import { GenericRecordsVettingStore } from '../module/vtiVetting'

import { communityTarget } from '../module/vtiCommunityLink'
import { useCommunityJourney } from '../module/communityJourney'

import { communityLabelAnsweredOf, communityLabelOf, communityLabelStartOf } from './communityName'
import { HeldByAnotherAgent } from './HeldByAnotherAgent'
import { useAgentsHoldingIdentity } from './agentsHoldingIdentity'
import { plainError } from './plainError'
import { useCommunityCalled } from './useCommunity'
import { localDate } from './localTime'
import { useToastAboveTabBar, useRoomAboveTabBar } from './aboveTabBar'

/** The raw text behind a plain line, for Details: a framework code, else the message. */
const detailOf = (err: unknown): string => {
  const code = (err as { code?: unknown } | undefined)?.code
  return typeof code === 'string' && code ? code : err instanceof Error ? err.message : String(err)
}

const VtiCommunity: React.FC = () => {
  // The tab bar draws over the page: the last line scrolls clear of it.
  const roomAboveTabBar = useRoomAboveTabBar()
  const { t } = useTranslation()
  // Bottom toasts sit clear of the tab bar (aboveTabBar).
  const toastBottomOffset = useToastAboveTabBar()
  const { ColorPalette, TextTheme } = useTheme()
  const { params } = useRoute<RouteProp<MyAgentStackParams, Screens.VtiCommunity>>()
  const communityDid = params.communityDid
  const called = useCommunityCalled(communityDid)

  const [manifest, setManifest] = useState<VtiManifest>()
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()
  // A refusal's framework code belongs behind Details, not in the sentence.
  const [refusalCode, setRefusalCode] = useState<string>()
  const [showDetails, setShowDetails] = useState(false)
  const { agent } = useAgent()
  const navigation = useNavigation()
  // Where this phone stands with the community: a member is not asked to apply.
  const { journey } = useCommunityJourney(agent, communityDid)
  // What the phone knows here may be another agent's: its identity, its
  // membership. Then this agent is not a member and cannot leave (10-06).
  const holding = useAgentsHoldingIdentity(communityDid)
  const heldElsewhere = holding.onlyOthers ? holding.holders.find(Boolean) : undefined
  const membership = !heldElsewhere && journey?.join.kind === 'member' ? journey.join.membership : undefined
  const vetsHere = !heldElsewhere && journey?.vetterGrant.state === 'active'
  // Leaving cannot be undone from the phone, so it asks once, in place, with
  // buttons that say what each does (plan §4.3).
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const [leaving, setLeaving] = useState(false)
  // The last leave went unanswered: the way on is to try again.
  const [leaveUnanswered, setLeaveUnanswered] = useState(false)
  // What the community keeps: erased, or a note with no personal details.
  // Erasing is the default — the one that keeps least about the person.
  const [keep, setKeep] = useState<'purge' | 'tombstone'>('purge')
  // Leave is offered only where the phone holds something — an identity, a
  // membership: a community only looked at through a link has nothing to leave.
  const [holds, setHolds] = useState(false)
  useEffect(() => {
    if (!agent) return
    let live = true
    void Promise.all([
      new GenericRecordsIdentityStore(agent).getPersona(communityDid),
      new GenericRecordsCommunityStore(agent).getMembership(communityDid),
    ])
      .then(([p, m]) => live && setHolds(Boolean(p || m)))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [agent, communityDid])

  // Leaving tells the community (members/self-remove, keyring-bifold#102), then
  // the phone forgets the identity, card and vetting. It used to forget them
  // only on the phone, while the community still counted a member (220).
  const onLeave = useCallback(async () => {
    if (!agent) return
    setLeaving(true)
    setError(undefined)
    setRefusalCode(undefined)
    setLeaveUnanswered(false)
    // The community in words, never its code; capitalised where it starts the sentence.
    const words = (key: string, start = false) =>
      t(key, {
        community: start ? communityLabelStartOf(communityDid, t) : communityLabelOf(communityDid, t),
        interpolation: { escapeValue: false },
      }) as string
    try {
      const left = await leaveCommunity(
        {
          agent,
          identityStore: new GenericRecordsIdentityStore(agent),
          communityStore: new GenericRecordsCommunityStore(agent),
          vettingStore: new GenericRecordsVettingStore(agent),
        },
        communityDid,
        { disposition: keep }
      )
      // The community answered, so it is named plainly here: its published
      // name, else the link's name without "(not confirmed …)", which after
      // "You left" read as if the leave itself was unconfirmed.
      const answered = (key: string, start = false) => {
        const name = communityLabelAnsweredOf(communityDid, t)
        return t(key, {
          community: start ? name.charAt(0).toUpperCase() + name.slice(1) : name,
          interpolation: { escapeValue: false },
        }) as string
      }
      Toast.show({
        type: ToastType.Success,
        text1: answered(
          left.alreadyGone
            ? 'Community.LeftAlreadyGone'
            : left.disposition === 'tombstone'
              ? 'Community.LeftTombstone'
              : left.disposition === 'historical'
                ? 'Community.LeftHistorical'
                : 'Community.LeftPurge'
        ),
        visibilityTime: 6000,
        position: 'bottom',
        // It is read on the screen this goes back to, over the tabs.
        bottomOffset: toastBottomOffset,
      })
      navigation.goBack()
    } catch (err) {
      // Asked twice and still no answer: say so, and offer to try again. The
      // phone is still a member as far as it knows, and keeps what it holds.
      const unanswered = err instanceof Error && err.name === 'VtiSentNoAnswer'
      setError(
        selfRemoveRefusal(err) === 'lastAdmin'
          ? words('Community.LeaveLastAdmin')
          : unanswered
            ? words('Community.LeaveNoAnswer')
            : t(plainError(err).line)
      )
      setRefusalCode(detailOf(err))
      setLeaveUnanswered(unanswered)
      setLeaving(false)
      setConfirmingLeave(false)
    }
  }, [agent, communityDid, navigation, keep, t, toastBottomOffset])

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 24, paddingBottom: 24 + roomAboveTabBar, gap: 20 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 12, padding: 20, gap: 12 },
    label: { ...TextTheme.labelSubtitle, color: ColorPalette.grayscale.mediumGrey },
    value: { ...TextTheme.normal, color: TextTheme.normal.color },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    button: { backgroundColor: ColorPalette.brand.primary, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
    buttonText: { ...TextTheme.bold, color: '#FFFFFF' },
    error: { ...TextTheme.normal, color: ColorPalette.semantic.error },
  })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        // With this screen's agent: a phone with no session yet has none to lend.
        const result = await vtiAgent.fetchManifest(communityDid, agent)
        if (!cancelled) setManifest(result)
      } catch (err) {
        if (!cancelled) {
          setError(t(plainError(err).line))
          setRefusalCode(detailOf(err))
        }
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [communityDid, agent, t])

  // Joining is chosen, never sent from here: this screen's "Apply to join"
  // sent a plain request at once, and the vetting that followed could not be
  // added to it (IN-127, 10-06: four refusals after the statement). Join shows
  // the community's ways in — ask to join, or join through vetting — and the
  // person picks one, with one identity whichever they pick.
  const onApply = useCallback(() => {
    communityTarget.set({ communityDid })
    ;(navigation as unknown as { navigate: (name: string) => void }).navigate(Screens.VtiJoin)
  }, [communityDid, navigation])

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} testID={testIdWithKey('CommunityScroll')}>
        {/* What it is called, not what it is keyed by. The DID was the
            headline here; it is the only checkable thing on the screen, so it
            stays — one tap away, in the same place as every other detail. */}
        <View style={styles.card}>
          <Text style={styles.label}>{t('MyAgent.Community')}</Text>
          <Text style={styles.value} testID={testIdWithKey('CommunityName')}>
            {called.name ?? t('Join.Unnamed')}
          </Text>
          {called.name && called.claimed ? (
            <Text style={styles.label} testID={testIdWithKey('CommunityNameClaimed')}>
              {t('Join.NameFromLink')}
            </Text>
          ) : null}
          <Pressable
            onPress={() => setShowDetails(!showDetails)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showDetails }}
            testID={testIdWithKey('CommunityDetailsToggle')}
          >
            <Text style={[styles.label, { textDecorationLine: 'underline' }]}>{t('VtaLink.Details')}</Text>
          </Pressable>
          {showDetails ? (
            <Text style={styles.value} selectable testID={testIdWithKey('CommunityDid')}>
              {communityDid}
            </Text>
          ) : null}
        </View>

        {heldElsewhere ? (
          <HeldByAnotherAgent
            communityDid={communityDid}
            community={communityLabelOf(communityDid, t)}
            holderVtaDid={heldElsewhere}
          />
        ) : null}
        {membership ? (
          <View style={styles.card} testID={testIdWithKey('CommunityMember')}>
            <View style={styles.row}>
              <Icon name="check-circle" size={24} color={ColorPalette.semantic.success} />
              <Text style={[styles.value, { flex: 1 }]}>
                {t('Join.StandingMember', {
                  community: communityLabelOf(communityDid, t),
                  interpolation: { escapeValue: false },
                })}
              </Text>
            </View>
            <Text style={styles.label} testID={testIdWithKey('CommunityMemberSince')}>
              {t('MyAgent.MemberSince', { date: localDate(membership.grantedAt) })}
            </Text>
            {vetsHere ? (
              <Pressable
                style={styles.button}
                testID={testIdWithKey('CommunityOpenDesk')}
                accessibilityRole="button"
                onPress={() => {
                  communityTarget.choose(communityDid)
                  ;(navigation as unknown as { navigate: (name: string) => void }).navigate(Screens.VtiVetting)
                }}
              >
                <Text style={styles.buttonText}>{t('Vetting.OpenDesk')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {membership || heldElsewhere ? null : (
          <Text style={{ ...TextTheme.headingFour, color: TextTheme.normal.color }}>{t('MyAgent.WhatIsAsked')}</Text>
        )}
        {busy && !manifest && !membership ? <ActivityIndicator color={ColorPalette.brand.primary} /> : null}
        {manifest && !membership ? (
          <View style={styles.card} testID={testIdWithKey('CommunityCriteria')}>
            {manifest.criteria.map((criterion, index) => (
              <View style={styles.row} key={criterion.id ?? String(index)}>
                <Icon name="circle-medium" size={20} color={ColorPalette.brand.primary} />
                <Text style={[styles.value, { flex: 1 }]}>{criterion.description ?? criterion.id}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {error ? (
          <View style={styles.card}>
            <Text style={styles.error} testID={testIdWithKey('CommunityError')}>
              {error}
            </Text>
            {refusalCode ? (
              <Pressable
                accessibilityRole="button"
                testID={testIdWithKey('CommunityRefusalDetails')}
                onPress={() => setShowDetails((shown) => !shown)}
              >
                <Text style={{ ...TextTheme.normal, color: ColorPalette.brand.link }}>{t('MyAgent.Details')}</Text>
              </Pressable>
            ) : null}
            {showDetails && refusalCode ? (
              <Text style={styles.label} testID={testIdWithKey('CommunityRefusalCode')}>
                {refusalCode}
              </Text>
            ) : null}
          </View>
        ) : null}

        {manifest && !membership && !heldElsewhere ? (
          <Pressable
            style={styles.button}
            testID={testIdWithKey('ApplyToCommunityButton')}
            accessibilityRole="button"
            onPress={onApply}
          >
            <Text style={styles.buttonText}>{t('Community.HowToJoin')}</Text>
          </Pressable>
        ) : null}

        {!holds || heldElsewhere ? null : confirmingLeave ? (
          <View style={styles.card} testID={testIdWithKey('LeaveCommunityConfirmCard')}>
            <Text style={styles.value}>
              {t('Community.LeaveExplains', {
                community: communityLabelOf(communityDid, t),
                interpolation: { escapeValue: false },
              })}
            </Text>
            <Text style={styles.label}>
              {t('Community.LeaveKeepWhat', {
                community: communityLabelOf(communityDid, t),
                interpolation: { escapeValue: false },
              })}
            </Text>
            {(['purge', 'tombstone'] as const).map((choice) => (
              <Pressable
                key={choice}
                style={styles.row}
                testID={testIdWithKey(choice === 'purge' ? 'LeaveCommunityPurge' : 'LeaveCommunityTombstone')}
                accessibilityRole="radio"
                accessibilityState={{ selected: keep === choice }}
                disabled={leaving}
                onPress={() => setKeep(choice)}
              >
                <Icon
                  name={keep === choice ? 'radiobox-marked' : 'radiobox-blank'}
                  size={22}
                  color={ColorPalette.brand.primary}
                />
                <Text style={[styles.value, { flex: 1 }]}>
                  {t(choice === 'purge' ? 'Community.LeavePurge' : 'Community.LeaveTombstone')}
                </Text>
              </Pressable>
            ))}
            <Pressable
              style={[styles.button, { backgroundColor: ColorPalette.semantic.error }]}
              testID={testIdWithKey('LeaveCommunityConfirm')}
              accessibilityRole="button"
              disabled={leaving}
              onPress={() => void onLeave()}
            >
              {leaving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonText}>{t('Community.LeaveConfirm')}</Text>
              )}
            </Pressable>
            <Pressable
              style={[styles.button, { backgroundColor: ColorPalette.grayscale.mediumGrey }]}
              testID={testIdWithKey('LeaveCommunityStay')}
              accessibilityRole="button"
              disabled={leaving}
              onPress={() => setConfirmingLeave(false)}
            >
              <Text style={styles.buttonText}>{t('Community.Stay')}</Text>
            </Pressable>
          </View>
        ) : leaveUnanswered ? (
          // Already confirmed once: trying again sends the same request, with
          // the same choice of what the community keeps.
          <Pressable
            style={[
              styles.button,
              { backgroundColor: 'transparent', borderWidth: 1, borderColor: ColorPalette.semantic.error },
            ]}
            testID={testIdWithKey('LeaveCommunityRetry')}
            accessibilityRole="button"
            disabled={leaving}
            onPress={() => void onLeave()}
          >
            {leaving ? (
              <ActivityIndicator color={ColorPalette.semantic.error} />
            ) : (
              <Text style={[styles.buttonText, { color: ColorPalette.semantic.error }]}>
                {t('Community.LeaveTryAgain')}
              </Text>
            )}
          </Pressable>
        ) : (
          <Pressable
            style={[
              styles.button,
              { backgroundColor: 'transparent', borderWidth: 1, borderColor: ColorPalette.semantic.error },
            ]}
            testID={testIdWithKey('LeaveCommunityButton')}
            accessibilityRole="button"
            onPress={() => setConfirmingLeave(true)}
          >
            <Text style={[styles.buttonText, { color: ColorPalette.semantic.error }]}>{t('Community.Leave')}</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

export default VtiCommunity
