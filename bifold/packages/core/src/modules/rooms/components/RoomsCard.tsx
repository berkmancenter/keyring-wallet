/**
 * The way into rooms: one card on the My Agent home (rooms member sprint), shown only while the rooms flag is
 * on (no service, no card). It counts the member's rooms and carries a badge for offers waiting on them; the
 * badge's count comes from the offers poll, so it moves without the home being reopened.
 *
 * @module rooms/components/RoomsCard
 */
import type { TFunction } from 'i18next'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { RoomsService } from '../types'
import type { MyRooms } from '../useMyRooms'

import { roomsReadFailedText, roomsStatusText } from './roomsStatusText'
import { SampleDataBanner } from './SampleDataBanner'

/** "2 rooms · 1 offer", leaving out offers when there are none. */
export const roomsCount = (t: TFunction, rooms: number, offers: number): string =>
  [
    t('Rooms.RoomCount', { count: rooms }) as string,
    ...(offers > 0 ? [t('Rooms.OfferCount', { count: offers }) as string] : []),
  ].join(' · ')

export interface RoomsCardProps {
  service?: RoomsService
  myRooms: MyRooms
  /** Offers waiting, from the poll; undefined until it first answers (the home's own read is used meanwhile). */
  offersCount?: number
  onOpen: () => void
}

/** Opens Rooms when rooms can be listed; otherwise says why, disabled. */
export const RoomsCard: React.FC<RoomsCardProps> = ({ service, myRooms, offersCount, onOpen }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  if (!service) return null
  const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    badge: {
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: ColorPalette.brand.primary,
    },
    badgeText: { color: ColorPalette.grayscale.white, fontSize: 12, fontWeight: '700' },
  })
  const offers = offersCount ?? myRooms.offers?.length ?? 0
  const status = myRooms.capabilities?.listMyRooms
  const unavailable = status ? roomsStatusText(t, status, 'listMyRooms') : undefined
  // While the rooms are read, the app's spinner stands in for the line; the words stay in the card's label.
  const reading = !myRooms.failed && !unavailable && !myRooms.rooms
  const detail = myRooms.failed
    ? roomsReadFailedText(t, myRooms.failure)
    : (unavailable ?? (myRooms.rooms ? roomsCount(t, myRooms.rooms.length, offers) : (t('Rooms.Reading') as string)))
  const enabled = !!status && !unavailable
  return (
    <View style={{ gap: 8, paddingHorizontal: 16 }}>
      <SampleDataBanner service={service} />
      <Pressable
        style={[styles.row, { opacity: enabled ? 1 : 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={`${t('Rooms.Rooms')}, ${detail}`}
        accessibilityState={{ disabled: !enabled }}
        disabled={!enabled}
        onPress={enabled ? onOpen : undefined}
        testID={testIdWithKey('RoomsCard')}
      >
        <Icon name="door" size={24} color={ColorPalette.brand.primary} />
        <View style={{ flex: 1 }}>
          <ThemedText variant="bold">{t('Rooms.Rooms')}</ThemedText>
          {reading ? (
            <ActivityIndicator
              size="small"
              color={ColorPalette.brand.primary}
              style={{ alignSelf: 'flex-start' }}
              testID={testIdWithKey('RoomsCardReading')}
            />
          ) : (
            <ThemedText variant="caption" style={styles.muted} testID={testIdWithKey('RoomsCardDetail')}>
              {detail}
            </ThemedText>
          )}
        </View>
        {offers > 0 ? (
          <View style={styles.badge} testID={testIdWithKey('RoomsCardBadge')}>
            <ThemedText style={styles.badgeText} maxFontSizeMultiplier={1.5}>
              {offers > 99 ? '99+' : String(offers)}
            </ThemedText>
          </View>
        ) : null}
        {enabled ? <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} /> : null}
      </Pressable>
    </View>
  )
}

export default RoomsCard
