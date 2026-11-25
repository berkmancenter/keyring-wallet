/**
 * The Badges section on a community's screen, for a member (docs/plans/member-badges-plan.md, What we build 2): the
 * badges this community offers them, each with Accept and Decline, then the badges they hold, then the kudos other
 * members gave them, which are read only. A row opens the badge.
 *
 * It shows only when there is something to show. A community that doesn't serve badges, one that has them switched off
 * (it answers with nothing, VTI-BDG-004, so an empty answer reads the same), and a release that killed them
 * (`badgesSwitch`) all show no section at all, as polls does.
 *
 * The words: a badge is a badge, from the community, never "verified" or "checked". An offer's note is the giver's to
 * this member, and shows on the offer only. Nothing here is shared outside the community.
 *
 * @module badges/components/CommunityBadgesSection
 */
import { useNavigation } from '@react-navigation/native'
import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import {
  CommunityGroup,
  CommunityGroupDivider,
  CommunitySectionLabel,
} from '../../trust-tasks/screens/CommunitySection'
import { communityLabelOf } from '../../trust-tasks/screens/communityName'
import { localDate } from '../../trust-tasks/screens/localTime'
import { isMemberBadgesOn } from '../badgesSwitch'
import type { BadgeOffer, HeldBadge } from '../types'
import { useBadgeService, useMyBadges } from '../useBadges'

import { BadgeImage } from './BadgeImage'
import { BadgesIds } from './Badges.ids'

const readable = (iso?: string): string | undefined => (iso && Number.isFinite(Date.parse(iso)) ? iso : undefined)

/** "Earned 10 Nov 2026", or "Earned 3 times, last on 15 Nov 2026" for a badge given more than once. */
export function earnedLine(
  t: (key: string, o?: Record<string, unknown>) => string,
  given: { count?: number; since?: string; latestAt?: string }
): string | undefined {
  const times = given.count ?? 1
  const last = readable(given.latestAt) ?? readable(given.since)
  if (!last) return times > 1 ? t('Badges.GivenTimes', { count: times }) : undefined
  return times > 1
    ? t('Badges.EarnedTimes', { count: times, date: localDate(last) })
    : t('Badges.Earned', { date: localDate(readable(given.since) ?? last) })
}

export interface BadgeDetailParams {
  communityDid: string
  badgeId: string
  /** What the row knew, shown while the badge is read. */
  name: string
  /** Whose badge this is: the member's own, or another member's on their card. */
  whose: 'mine' | 'theirs'
  count?: number
  since?: string
  latestAt?: string
}

type Answer = 'accept' | 'decline'

export const CommunityBadgesSection: React.FC<{ communityDid: string }> = ({ communityDid }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const service = useBadgeService()
  const { badges, served, refresh } = useMyBadges(communityDid)
  const go = useNavigation() as unknown as { navigate: (name: string, params: object) => void }
  const [answering, setAnswering] = useState<{ awardId: string; answer: Answer }>()
  const [failed, setFailed] = useState<string>()
  // One answer at a time, and each at most once: a second tap while one is on its way does nothing.
  const inFlight = useRef(false)

  // Checked here as well as in the hooks: the kill hides the section even if a service is somehow in hand.
  if (!isMemberBadgesOn() || !served || !badges) return null

  const community = communityLabelOf(communityDid, t)
  const muted = { color: ColorPalette.grayscale.mediumGrey }
  const held = badges.held.filter((b) => b.kind !== 'kudos')
  const kudos = badges.held.filter((b) => b.kind === 'kudos')
  const kudosTotal = badges.kudosTotal ?? kudos.reduce((n, k) => n + (k.count ?? 1), 0)
  // Nothing to show is shown as nothing: a community with badges off answers this way too (VTI-BDG-004).
  if (held.length === 0 && badges.offers.length === 0 && kudos.length === 0 && !badges.kudosTotal) return null

  const open = (b: HeldBadge) =>
    go.navigate(Screens.BadgeDetail, {
      communityDid,
      badgeId: b.badgeId,
      name: b.name,
      whose: 'mine',
      count: b.count,
      since: b.since,
      latestAt: b.latestAt,
    } satisfies BadgeDetailParams)

  const answer = async (offer: BadgeOffer, which: Answer) => {
    if (!service || inFlight.current) return
    inFlight.current = true
    setFailed(undefined)
    setAnswering({ awardId: offer.awardId, answer: which })
    try {
      if (which === 'accept') await service.accept(communityDid, offer.awardId)
      else await service.decline(communityDid, offer.awardId)
      refresh()
    } catch {
      setFailed(offer.awardId)
    } finally {
      inFlight.current = false
      setAnswering(undefined)
    }
  }

  return (
    <View style={{ gap: 8 }} testID={testIdWithKey(BadgesIds.section)}>
      <CommunitySectionLabel title={t('Badges.Badges')} count={held.length || undefined} />
      {badges.visibility === 'nobody' ? (
        <ThemedText variant="caption" style={muted} testID={testIdWithKey(BadgesIds.onlyYou)}>
          {t('Badges.OnlyYouSee', { community, interpolation: { escapeValue: false } })}
        </ThemedText>
      ) : null}

      {badges.offers.map((offer) => {
        const busy = answering?.awardId === offer.awardId
        return (
          <View
            key={offer.awardId}
            style={{
              gap: 10,
              padding: 16,
              borderRadius: 14,
              borderWidth: 2,
              borderColor: ColorPalette.brand.primary,
              backgroundColor: ColorPalette.brand.secondaryBackground,
            }}
            testID={testIdWithKey(BadgesIds.offer)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <BadgeImage badge={offer} size={52} />
              <View style={{ flex: 1, gap: 2 }}>
                <ThemedText variant="labelSubtitle" style={muted}>
                  {t('Badges.OfferedToYou')}
                </ThemedText>
                <ThemedText variant="bold">{offer.name}</ThemedText>
                <ThemedText style={muted}>
                  {offer.givenBy
                    ? t('Badges.FromCommunityBy', {
                        community,
                        name: offer.givenBy,
                        interpolation: { escapeValue: false },
                      })
                    : t('Badges.FromCommunity', { community, interpolation: { escapeValue: false } })}
                </ThemedText>
              </View>
            </View>
            {offer.description ? <ThemedText>{offer.description}</ThemedText> : null}
            {offer.note ? (
              <View style={{ gap: 2 }} testID={testIdWithKey(BadgesIds.offerNote)}>
                <ThemedText variant="caption" style={muted}>
                  {t('Badges.NoteToYou')}
                </ThemedText>
                <ThemedText>{`“${offer.note}”`}</ThemedText>
              </View>
            ) : null}
            {offer.expiresAt && Number.isFinite(Date.parse(offer.expiresAt)) ? (
              <ThemedText variant="caption" style={muted} testID={testIdWithKey(BadgesIds.offerExpires)}>
                {t('Badges.AnswerBy', { date: localDate(offer.expiresAt) })}
              </ThemedText>
            ) : null}
            <ThemedText variant="caption" style={muted}>
              {t('Badges.WhatAnswersDo', { community, interpolation: { escapeValue: false } })}
            </ThemedText>
            {failed === offer.awardId ? (
              <ThemedText
                style={{ color: ColorPalette.semantic.error }}
                testID={testIdWithKey(BadgesIds.offerFailed)}
                accessibilityLiveRegion="polite"
              >
                {t('Badges.AnswerFailed')}
              </ThemedText>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  title={busy && answering?.answer === 'accept' ? t('Badges.Accepting') : t('Badges.Accept')}
                  accessibilityLabel={`${t('Badges.Accept')}, ${offer.name}`}
                  buttonType={ButtonType.Primary}
                  disabled={!!answering}
                  onPress={() => void answer(offer, 'accept')}
                  testID={testIdWithKey(BadgesIds.accept)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title={busy && answering?.answer === 'decline' ? t('Badges.Declining') : t('Badges.Decline')}
                  accessibilityLabel={`${t('Badges.Decline')}, ${offer.name}`}
                  buttonType={ButtonType.Secondary}
                  disabled={!!answering}
                  onPress={() => void answer(offer, 'decline')}
                  testID={testIdWithKey(BadgesIds.decline)}
                />
              </View>
            </View>
          </View>
        )
      })}

      {held.length ? (
        <CommunityGroup style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
          {held.map((b, i) => {
            const line = earnedLine(t, b)
            const times = b.count ?? 1
            return (
              <View key={b.badgeId}>
                {i > 0 ? <CommunityGroupDivider /> : null}
                <Pressable
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={[b.name, line, b.hidden ? t('Badges.HiddenFromWall') : undefined]
                    .filter(Boolean)
                    .join(', ')}
                  onPress={() => open(b)}
                  testID={testIdWithKey(BadgesIds.held)}
                >
                  <BadgeImage badge={b} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText variant="bold">{b.name}</ThemedText>
                    {line ? <ThemedText style={muted}>{line}</ThemedText> : null}
                    {b.hidden ? (
                      <ThemedText variant="caption" style={muted}>
                        {t('Badges.HiddenFromWall')}
                      </ThemedText>
                    ) : null}
                  </View>
                  {times > 1 ? (
                    <ThemedText variant="bold" style={muted} testID={testIdWithKey(BadgesIds.heldCount)}>
                      {`×${times}`}
                    </ThemedText>
                  ) : null}
                  <Icon name="chevron-right" size={24} color={ColorPalette.grayscale.mediumGrey} />
                </Pressable>
              </View>
            )
          })}
        </CommunityGroup>
      ) : null}

      {kudos.length || kudosTotal ? (
        <View style={{ gap: 6 }} testID={testIdWithKey(BadgesIds.kudos)}>
          <ThemedText variant="labelSubtitle" style={muted} testID={testIdWithKey(BadgesIds.kudosTotal)}>
            {t('Badges.KudosTotal', { count: kudosTotal })}
          </ThemedText>
          {kudos.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {kudos.map((k) => (
                <View
                  key={k.badgeId}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  accessible
                  accessibilityLabel={t('Badges.KudosOne', { name: k.name, count: k.count ?? 1 })}
                >
                  <BadgeImage badge={k} size={28} />
                  <ThemedText>{`${k.name} ×${k.count ?? 1}`}</ThemedText>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

export default CommunityBadgesSection
