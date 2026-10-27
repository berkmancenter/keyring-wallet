/**
 * One room in a list: its name, tier, and one line on where the member stands. A name that is only the
 * room's ID reads as an ID ("Room 3f9a7c21", in a fixed-width face), never as if the community chose it.
 * A room known only from the agent's keys says "Details not loaded" and shows no tier or expiry.
 *
 * A row opens its room only when given `onPress`; without it, it is not a button.
 *
 * @module rooms/components/RoomRow
 */
import type { TFunction } from 'i18next'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { localDate } from '../../trust-tasks/screens/localTime'
import { testIdWithKey } from '../../../utils/testable'
import type { RoomSummary } from '../types'

import TierBadge from './TierBadge'

/** A short, stable handle for a room's test IDs: the last characters of its ID that are letters or digits. */
export const roomHandle = (roomId: string): string => roomId.replace(/[^A-Za-z0-9]/g, '').slice(-10)

/** The room's name as shown: a room ID reads as an ID. */
export const roomTitle = (t: TFunction, room: Pick<RoomSummary, 'name' | 'nameFrom'>): string =>
  room.nameFrom === 'roomId'
    ? (t('Rooms.RoomById', { id: room.name, interpolation: { escapeValue: false } }) as string)
    : room.name

/** Where the member stands in the room, in one line. */
export const roomLine = (t: TFunction, room: RoomSummary, withCommunity: boolean): string => {
  const parts: string[] = []
  if (withCommunity && room.communityName) parts.push(room.communityName)
  if (room.source === 'custody') parts.push(t('Rooms.DetailsNotLoaded') as string)
  else if (room.standing === 'lapsed') parts.push(t('Rooms.StandingLapsed') as string)
  else if (room.standing === 'removed') parts.push(t('Rooms.StandingRemoved') as string)
  else if (room.validUntil) parts.push(t('Rooms.Until', { date: localDate(room.validUntil) }) as string)
  return parts.join(' · ')
}

export interface RoomRowProps {
  room: RoomSummary
  /** Name the room's community on the row (a list across communities). */
  withCommunity?: boolean
  onPress?: (room: RoomSummary) => void
}

export const RoomRow: React.FC<RoomRowProps> = ({ room, withCommunity = false, onPress }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingVertical: 6 },
    name: room.nameFrom === 'roomId' ? { fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }) } : {},
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  const title = roomTitle(t, room)
  const line = roomLine(t, room, withCommunity)
  const content = (
    <>
      <Icon name="door" size={22} color={ColorPalette.brand.primary} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <ThemedText variant="bold" style={styles.name} testID={testIdWithKey(`RoomName_${roomHandle(room.roomId)}`)}>
            {title}
          </ThemedText>
          <TierBadge tier={room.tier} />
        </View>
        {line ? (
          <ThemedText variant="caption" style={styles.muted}>
            {line}
          </ThemedText>
        ) : null}
      </View>
    </>
  )
  const testID = testIdWithKey(`RoomRow_${roomHandle(room.roomId)}`)
  if (!onPress)
    return (
      <View style={styles.row} accessible accessibilityLabel={line ? `${title}, ${line}` : title} testID={testID}>
        {content}
      </View>
    )
  return (
    <Pressable
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={line ? `${title}, ${line}` : title}
      onPress={() => onPress(room)}
      testID={testID}
    >
      {content}
      <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
    </Pressable>
  )
}

export default RoomRow
