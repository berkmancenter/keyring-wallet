/**
 * "Waiting for you" at the top of Messages (rooms in Messages, R1): each room offer the member hasn't answered, as a
 * card that opens it. All of them, or one community's under its chip; nothing at all when none wait, so the list can
 * always mount it. The offers come from the one offers poll the tab navigator runs (useRoomOffersCount).
 *
 * @module rooms/components/RoomOfferCard
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, TouchableOpacity, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { offerCommunity, offerRoom } from '../offerCommunity'
import { useRoomOffersWaiting } from '../useRoomOffersCount'

import { ROOM_MARK_FILL } from './RoomHeader'
import { initialsOf } from './RoomIdentitySheet'

/** The card's border: the brand's colour, lighter, as the community tag on a room's row. */
const CARD_BORDER = '#B99BBA'
const asWritten = { interpolation: { escapeValue: false } }

export interface RoomOfferCardProps {
  /** Only this community's offers (its chip); all when absent. */
  communityDid?: string
  onOpen: (offerId: string) => void
}

const RoomOfferCard: React.FC<RoomOfferCardProps> = ({ communityDid, onOpen }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const offers = useRoomOffersWaiting(communityDid)
  if (offers.length === 0) return null

  const styles = StyleSheet.create({
    list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6, gap: 8 },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: CARD_BORDER,
      backgroundColor: ColorPalette.grayscale.white,
    },
    mark: {
      width: 40,
      height: 40,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: ROOM_MARK_FILL,
    },
    letters: { color: ColorPalette.brand.primary, fontSize: 15, fontWeight: '700' },
    words: { flex: 1, minWidth: 0, gap: 1 },
    waiting: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      color: ColorPalette.brand.primary,
    },
    room: { fontSize: 16, lineHeight: 21, fontWeight: '700', color: ColorPalette.brand.text },
    from: { fontSize: 14, lineHeight: 19, color: ColorPalette.grayscale.mediumGrey },
    look: {
      minHeight: 44,
      paddingHorizontal: 14,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: ColorPalette.brand.primary,
    },
    lookText: { fontSize: 15, fontWeight: '700', color: ColorPalette.grayscale.white },
  })

  return (
    <View style={styles.list}>
      {offers.map((offer) => {
        const room = offerRoom(offer, t)
        const from = t('Rooms.OfferFrom', { community: offerCommunity(offer, t), ...asWritten }) as string
        return (
          <View key={offer.offerId} style={styles.card} testID={testIdWithKey('RoomOfferCard')}>
            <View style={styles.mark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <ThemedText style={styles.letters}>{initialsOf(String(offer.roomName))}</ThemedText>
            </View>
            <View style={styles.words}>
              <ThemedText style={styles.waiting}>{t('Rooms.OfferWaiting')}</ThemedText>
              <ThemedText style={styles.room} numberOfLines={1}>
                {room}
              </ThemedText>
              <ThemedText style={styles.from} numberOfLines={1}>
                {from}
              </ThemedText>
            </View>
            <TouchableOpacity
              style={styles.look}
              onPress={() => onOpen(offer.offerId)}
              accessibilityRole="button"
              accessibilityLabel={t('Rooms.OfferLookLabel', { room, ...asWritten }) as string}
              testID={testIdWithKey('RoomOfferCardLook')}
            >
              <ThemedText style={styles.lookText}>{t('Rooms.OfferLook')}</ThemedText>
            </TouchableOpacity>
          </View>
        )
      })}
    </View>
  )
}

export default RoomOfferCard
