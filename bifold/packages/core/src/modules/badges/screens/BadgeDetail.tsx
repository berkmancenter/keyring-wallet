/**
 * One badge (docs/plans/member-badges-plan.md, What we build 2): its picture, its name, the community that gives it,
 * what it is and how it is earned, as the community describes it (`show`), and when it was earned. Opened from the
 * member's own badges on the community screen, or from a badge on another member's card.
 *
 * It is read when the screen opens. While it is read the row's own name shows; a read that failed says so, with Try
 * again, and what the row knew stays. A badge is a badge from the community: never "verified" or "checked", whatever
 * its name or criteria say, and nothing on this screen shares it outside the community.
 *
 * @module badges/screens/BadgeDetail
 */
import { useRoute } from '@react-navigation/native'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { communityLabelOf } from '../../trust-tasks/screens/communityName'
import { isMemberBadgesOn } from '../badgesSwitch'
import { BadgeImage } from '../components/BadgeImage'
import { BadgesIds } from '../components/Badges.ids'
import { earnedLine, type BadgeDetailParams } from '../components/CommunityBadgesSection'
import type { BadgeSummary } from '../types'
import { useBadgeService } from '../useBadges'

const BadgeDetail: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const params = (useRoute()?.params ?? {}) as Partial<BadgeDetailParams>
  const communityDid = params.communityDid ?? ''
  const badgeId = params.badgeId ?? ''
  const service = useBadgeService()
  const [badge, setBadge] = useState<BadgeSummary>()
  const [state, setState] = useState<'reading' | 'shown' | 'failed' | 'gone'>('reading')
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!service || !communityDid || !badgeId) {
      setState('gone')
      return
    }
    let live = true
    setState('reading')
    service
      .show(communityDid, badgeId)
      .then((got) => {
        if (!live) return
        if (got === 'notServed') setState('gone')
        else {
          setBadge(got)
          setState('shown')
        }
      })
      .catch(() => {
        if (live) setState('failed')
      })
    return () => {
      live = false
    }
  }, [service, communityDid, badgeId, generation])

  const again = useCallback(() => setGeneration((g) => g + 1), [])

  if (!isMemberBadgesOn()) return null

  const community = communityLabelOf(communityDid, t)
  const muted = { color: ColorPalette.grayscale.mediumGrey }
  const name = badge?.name ?? params.name ?? t('Badges.ABadge')
  const shown = badge ?? { badgeId, communityDid, name, kind: 'community' as const }
  const earned = earnedLine(t, params)

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: ColorPalette.brand.primaryBackground }}
      edges={['left', 'right', 'bottom']}
    >
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 24, gap: 16, alignItems: 'stretch' }}
        testID={testIdWithKey(BadgesIds.screen)}
      >
        <View style={{ alignItems: 'center', gap: 12 }}>
          <BadgeImage badge={shown} size={112} />
          <ThemedText
            style={{ ...TextTheme.headingFour, fontSize: 22, textAlign: 'center' }}
            accessibilityRole="header"
            testID={testIdWithKey(BadgesIds.detailName)}
          >
            {name}
          </ThemedText>
          <ThemedText style={[muted, { textAlign: 'center' }]} testID={testIdWithKey(BadgesIds.detailGiver)}>
            {shown.kind === 'kudos'
              ? t('Badges.KudosIn', { community, interpolation: { escapeValue: false } })
              : t('Badges.FromCommunity', { community, interpolation: { escapeValue: false } })}
          </ThemedText>
          {earned ? (
            <ThemedText style={[muted, { textAlign: 'center' }]} testID={testIdWithKey(BadgesIds.detailEarned)}>
              {params.whose === 'theirs' ? t('Badges.TheyEarned', { line: earned }) : earned}
            </ThemedText>
          ) : null}
        </View>

        {state === 'reading' ? (
          <View style={{ alignItems: 'center', gap: 8 }} testID={testIdWithKey(BadgesIds.detailReading)}>
            <ActivityIndicator color={ColorPalette.brand.primary} />
            <ThemedText style={muted}>{t('Badges.Reading')}</ThemedText>
          </View>
        ) : null}
        {state === 'failed' ? (
          <View style={{ gap: 8 }} testID={testIdWithKey(BadgesIds.detailReadFailed)}>
            <ThemedText>{t('Badges.ReadFailed')}</ThemedText>
            <Button
              title={t('Badges.TryAgain')}
              buttonType={ButtonType.Secondary}
              onPress={again}
              testID={testIdWithKey(BadgesIds.detailTryAgain)}
            />
          </View>
        ) : null}
        {badge?.description ? (
          <View style={{ gap: 4 }} testID={testIdWithKey(BadgesIds.detailDescription)}>
            <ThemedText variant="caption" style={muted}>
              {t('Badges.WhatItIs')}
            </ThemedText>
            <ThemedText selectable>{badge.description}</ThemedText>
          </View>
        ) : null}
        {badge?.criteria ? (
          <View style={{ gap: 4 }}>
            <ThemedText variant="caption" style={muted}>
              {t('Badges.HowEarned')}
            </ThemedText>
            <ThemedText selectable>{badge.criteria}</ThemedText>
          </View>
        ) : null}
        <ThemedText variant="caption" style={muted}>
          {t('Badges.StaysInCommunity', { community, interpolation: { escapeValue: false } })}
        </ThemedText>
      </ScrollView>
    </SafeAreaView>
  )
}

export default BadgeDetail
