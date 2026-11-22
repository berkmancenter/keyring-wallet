/**
 * A badge in the Wallet (docs/plans/member-badges-plan.md, Wallet): an Open Badges credential the member's community
 * gave them, drawn as a badge, not a pass. It is round-pictured and light, so it never reads as the community's
 * membership, role or state pass (CommunityPass, coloured by the community). Its face: the picture (or the card's own
 * mark), "Badge", the badge's name, the community as its giver, and when it was earned. Pressed, its details open over
 * the Wallet (./BadgeCardDetails).
 *
 * Gated at render: with badges off (`badgesSwitch`) it draws nothing. The Wallet then lists the credential as an
 * ordinary card (ListCredentials).
 *
 * @module badges/wallet/BadgeCardPass
 */
import React, { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { BadgeCardView } from '../../trust-tasks/module/badgeCredentials'
import { communityTarget } from '../../trust-tasks/module/vtiCommunityLink'
import { isMemberBadgesOn } from '../badgesSwitch'

import BadgeCardDetails from './BadgeCardDetails'
import { BadgePicture } from './BadgePicture'
import { badgeCardFace } from './badgeCardFace'
import { useBadgePicture } from './useBadgePicture'

/** The name the community has published to this phone, if any. */
export function usePublishedCommunityName(communityDid: string): string | undefined {
  return useSyncExternalStore(communityTarget.subscribe, () => communityTarget.publishedNameOf(communityDid))
}

export interface BadgeCardPassProps {
  view: BadgeCardView
}

export const BadgeCardPass: React.FC<BadgeCardPassProps> = ({ view }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const [open, setOpen] = useState(false)
  const published = usePublishedCommunityName(view.communityDid)
  const picture = useBadgePicture(view)
  if (!isMemberBadgesOn()) return null
  const face = badgeCardFace(view, t, published)

  const styles = StyleSheet.create({
    slot: { marginHorizontal: 15, marginTop: 15 },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: 14,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: ColorPalette.grayscale.lightGrey,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    words: { flex: 1, gap: 2 },
    kind: { fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: ColorPalette.grayscale.mediumGrey },
    name: { fontSize: 17, fontWeight: '600' },
    line: { fontSize: 14, color: ColorPalette.grayscale.mediumGrey },
  })

  return (
    <View style={styles.slot} testID={testIdWithKey('BadgeCard')}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={face.accessibilityLabel}
        onPress={() => setOpen(true)}
        style={styles.card}
        testID={testIdWithKey('BadgeCardOpen')}
      >
        <BadgePicture uri={picture} size={56} testID={testIdWithKey('BadgeCardPicture')} />
        <View style={styles.words}>
          <ThemedText style={styles.kind}>{t('BadgeCard.Kind')}</ThemedText>
          <ThemedText style={styles.name} numberOfLines={2} testID={testIdWithKey('BadgeCardName')}>
            {face.name}
          </ThemedText>
          <ThemedText style={styles.line} numberOfLines={1} testID={testIdWithKey('BadgeCardFrom')}>
            {face.from}
          </ThemedText>
          {face.earned ? (
            <ThemedText style={styles.line} testID={testIdWithKey('BadgeCardEarned')}>
              {face.earned}
            </ThemedText>
          ) : null}
        </View>
        <Icon name="chevron-right" size={24} color={ColorPalette.grayscale.mediumGrey} />
      </Pressable>
      <SafeAreaModal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <BadgeCardDetails view={view} picture={picture} published={published} onClose={() => setOpen(false)} />
      </SafeAreaModal>
    </View>
  )
}

export default BadgeCardPass
