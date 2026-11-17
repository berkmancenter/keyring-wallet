/**
 * The badges on another member's card (docs/plans/member-badges-plan.md, What we build 2): what `wall/show` returns for
 * this viewer, pinned ones first, each opening the badge. A wall the community doesn't show this member ('hidden'), a
 * community that doesn't serve badges, an empty wall, or a release that killed badges shows no row at all.
 *
 * `wall/show` takes the member's directory entry, so the row needs one: the card opened from the members list has it.
 * A card opened by DID (a room author's sheet) passes none and gets no row; the app never looks an entry up by DID,
 * which upstream keeps to administrators and the directory refuses as a membership oracle.
 *
 * @module badges/components/MemberBadgesRow
 */
import { useNavigation } from '@react-navigation/native'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { isMemberBadgesOn } from '../badgesSwitch'
import type { WallBadge } from '../types'
import { useMemberWall } from '../useBadges'

import { BadgeImage } from './BadgeImage'
import { BadgesIds } from './Badges.ids'
import type { BadgeDetailParams } from './CommunityBadgesSection'

/** Pinned first, then the order the community gave. */
export const wallOrder = (wall: WallBadge[]): WallBadge[] => [
  ...wall.filter((b) => b.pinned),
  ...wall.filter((b) => !b.pinned),
]

export const MemberBadgesRow: React.FC<{ communityDid: string; entryId?: string }> = ({ communityDid, entryId }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { wall, state } = useMemberWall(communityDid, entryId)
  const go = useNavigation() as unknown as { navigate: (name: string, params: object) => void }

  if (!isMemberBadgesOn() || !entryId || state !== 'shown' || !wall?.length) return null

  return (
    <View style={{ gap: 8 }} testID={testIdWithKey(BadgesIds.memberRow)}>
      <ThemedText
        variant="label"
        accessibilityRole="header"
        style={{ color: ColorPalette.grayscale.mediumGrey, textTransform: 'uppercase', letterSpacing: 0.8 }}
      >
        {t('Badges.Badges')}
      </ThemedText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {wallOrder(wall).map((b) => {
          const times = b.count && b.count > 1 ? b.count : undefined
          return (
            <Pressable
              key={b.badgeId}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingVertical: 6,
                paddingLeft: 6,
                paddingRight: 12,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: ColorPalette.grayscale.lightGrey,
              }}
              accessibilityRole="button"
              accessibilityLabel={times ? `${b.name}, ×${times}` : b.name}
              onPress={() =>
                go.navigate(Screens.BadgeDetail, {
                  communityDid,
                  badgeId: b.badgeId,
                  name: b.name,
                  whose: 'theirs',
                  count: b.count,
                  since: b.since,
                  latestAt: b.latestAt,
                } satisfies BadgeDetailParams)
              }
              testID={testIdWithKey(BadgesIds.memberChip)}
            >
              <BadgeImage badge={b} size={28} />
              <ThemedText>{times ? `${b.name} ×${times}` : b.name}</ThemedText>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

export default MemberBadgesRow
