/**
 * The member's offers and rooms, as "Your rooms" and a community's Rooms section list them: offers first
 * (waiting on the member), then rooms, grouped by community when the list spans several. A room known only
 * from the agent's keys goes in its own group, since its community is not known yet.
 *
 * Reading, failure and "not available" each say so: the list is never shown empty for a reason other than
 * having no rooms. A room opens its screen when given `onOpenRoom`, and an offer its consent screen when given
 * `onOpenOffer`.
 *
 * @module rooms/components/RoomsListBody
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { localDate } from '../../trust-tasks/screens/localTime'
import { testIdWithKey } from '../../../utils/testable'
import { offerCommunityAlone, offerRoom } from '../offerCommunity'
import type { RoomOffer, RoomSummary } from '../types'
import type { MyRooms } from '../useMyRooms'

import { roomHandle, RoomRow } from './RoomRow'
import { roomsReadFailedText, roomsStatusText } from './roomsStatusText'
import TierBadge from './TierBadge'

const OfferRow: React.FC<{ offer: RoomOffer; withCommunity: boolean; onPress?: (offer: RoomOffer) => void }> = ({
  offer,
  withCommunity,
  onPress,
}) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const line = [
    withCommunity ? offerCommunityAlone(offer, t) : undefined,
    offer.validUntil ? (t('Rooms.Until', { date: localDate(offer.validUntil) }) as string) : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  const label = `${t('Rooms.OfferOf', { room: offerRoom(offer, t), interpolation: { escapeValue: false } })}${
    line ? `, ${line}` : ''
  }`
  const style = { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 } as const
  const testID = testIdWithKey(`RoomOfferRow_${roomHandle(offer.offerId)}`)
  const content = (
    <>
      <Icon name="email-outline" size={22} color={ColorPalette.brand.primary} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <ThemedText variant="bold">{offerRoom(offer, t)}</ThemedText>
          <TierBadge tier={offer.tier} />
        </View>
        {line ? (
          <ThemedText variant="caption" style={{ color: ColorPalette.grayscale.mediumGrey }}>
            {line}
          </ThemedText>
        ) : null}
      </View>
    </>
  )
  if (!onPress)
    return (
      <View style={style} accessible accessibilityLabel={label} testID={testID}>
        {content}
      </View>
    )
  return (
    <Pressable
      style={style}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onPress(offer)}
      testID={testID}
    >
      {content}
      <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
    </Pressable>
  )
}

/** Rooms by community, in first-seen order; custody-only rooms last, in their own group. */
export const groupRooms = (rooms: RoomSummary[]): { key: string; title?: string; rooms: RoomSummary[] }[] => {
  const groups = new Map<string, { key: string; title?: string; rooms: RoomSummary[] }>()
  for (const room of rooms) {
    const key = room.source === 'custody' || !room.communityDid ? 'custody' : room.communityDid
    if (!groups.has(key)) groups.set(key, { key, title: key === 'custody' ? undefined : room.communityName, rooms: [] })
    groups.get(key)?.rooms.push(room)
  }
  const all = [...groups.values()]
  return [...all.filter((g) => g.key !== 'custody'), ...all.filter((g) => g.key === 'custody')]
}

export interface RoomsListBodyProps {
  myRooms: MyRooms
  /** Group by community and name it on offers (a list across communities). */
  acrossCommunities: boolean
  onOpenRoom?: (room: RoomSummary) => void
  onOpenOffer?: (offer: RoomOffer) => void
  /** What shows while the rooms are read; the app's spinner unless a screen draws its own (a community's rows). */
  whileReading?: React.ReactNode
}

export const RoomsListBody: React.FC<RoomsListBodyProps> = ({
  myRooms,
  acrossCommunities,
  onOpenRoom,
  onOpenOffer,
  whileReading,
}) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const styles = StyleSheet.create({
    section: { gap: 4 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  const { capabilities, rooms, offers, failed } = myRooms

  if (!capabilities && failed)
    return (
      <View style={styles.section}>
        <ThemedText testID={testIdWithKey('RoomsReadFailed')}>{roomsReadFailedText(t, myRooms.failure)}</ThemedText>
        <Button
          title={t('Rooms.TryAgain')}
          buttonType={ButtonType.Secondary}
          onPress={myRooms.reload}
          testID={testIdWithKey('RoomsTryAgain')}
        />
      </View>
    )
  const reading = whileReading ?? (
    <ActivityIndicator color={ColorPalette.brand.primary} testID={testIdWithKey('RoomsReading')} />
  )
  if (!capabilities) return <>{reading}</>

  const unavailable = roomsStatusText(t, capabilities.listMyRooms, 'listMyRooms')
  if (unavailable)
    return (
      <ThemedText style={styles.muted} testID={testIdWithKey('RoomsUnavailable')}>
        {unavailable}
      </ThemedText>
    )
  if (!rooms) return <>{reading}</>

  const waiting = offers ?? []
  const groups = acrossCommunities ? groupRooms(rooms) : [{ key: 'one', title: undefined, rooms }]
  return (
    <View style={{ gap: 16 }}>
      {failed ? (
        <ThemedText style={styles.muted} testID={testIdWithKey('RoomsStale')}>
          {t('Rooms.Stale')}
        </ThemedText>
      ) : null}
      {waiting.length > 0 ? (
        <View style={styles.section} testID={testIdWithKey('RoomOffers')}>
          <ThemedText variant="labelTitle" accessibilityRole="header">
            {t('Rooms.Offers')}
          </ThemedText>
          {waiting.map((offer) => (
            <OfferRow key={offer.offerId} offer={offer} withCommunity={acrossCommunities} onPress={onOpenOffer} />
          ))}
        </View>
      ) : null}
      {rooms.length === 0 ? (
        <ThemedText style={styles.muted} testID={testIdWithKey('RoomsNone')}>
          {t('Rooms.None')}
        </ThemedText>
      ) : (
        groups.map((group) => (
          <View key={group.key} style={styles.section} testID={testIdWithKey(`RoomsGroup_${roomHandle(group.key)}`)}>
            {acrossCommunities ? (
              <ThemedText variant="labelTitle" accessibilityRole="header">
                {group.key === 'custody' ? t('Rooms.CommunityNotKnown') : (group.title ?? t('Rooms.Rooms'))}
              </ThemedText>
            ) : null}
            {group.rooms.map((room) => (
              <RoomRow key={room.roomId} room={room} onPress={onOpenRoom} />
            ))}
          </View>
        ))
      )}
    </View>
  )
}

export default RoomsListBody
