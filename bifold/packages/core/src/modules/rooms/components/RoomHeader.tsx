/**
 * A room's header (data rooms, header B): the room's letters, its name, the community it is in and until when the
 * member's access runs, and its tier. Who the member acts as is said once, in the composer, not here.
 *
 * As mocked (header B): the letters on a lilac tile, the title near-black, the line below smaller and grey, the tier
 * an outlined chip, all centred on one row.
 *
 * Above a room's chat, the header opens the room's details (rooms in Messages, R2: the title opens them, as a group
 * chat's does), with a chevron saying so.
 *
 * @module rooms/components/RoomHeader
 */
import type { TFunction } from 'i18next'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { communityTarget } from '../../trust-tasks/module/vtiCommunityLink'
import { localDate } from '../../trust-tasks/screens/localTime'
import type { RoomSummary } from '../types'

import { initialsOf } from './RoomIdentitySheet'
import { roomTitle } from './RoomRow'
import TierBadge from './TierBadge'

/** The lilac behind a room's letters, as the day markers' (DayPill). */
export const ROOM_MARK_FILL = '#EDE3EE'

/**
 * "in Keyring Lab · until 26 Jan 2027": either part alone when the other is not known. A room whose record names no
 * community is said to be in the community's published name, when this phone knows it.
 */
export const roomWhere = (
  t: TFunction,
  room: Pick<RoomSummary, 'communityName' | 'validUntil'> & { communityDid?: string }
): string | undefined => {
  const date = room.validUntil ? localDate(room.validUntil) : undefined
  const community =
    (room.communityName ? String(room.communityName) : undefined) ??
    (room.communityDid ? communityTarget.publishedNameOf(room.communityDid) : undefined)
  if (community && date)
    return t('Rooms.RoomInUntil', { community, date, interpolation: { escapeValue: false } }) as string
  if (community) return t('Rooms.RoomIn', { community, interpolation: { escapeValue: false } }) as string
  if (date) return t('Rooms.Until', { date }) as string
  return undefined
}

export const RoomHeader: React.FC<{ room: RoomSummary; onPress?: () => void }> = ({ room, onPress }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const where = roomWhere(t, room)
  const byId = room.nameFrom === 'roomId'
  const styles = StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 12,
    },
    mark: {
      width: 48,
      height: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      // Not the screen's own grey (secondaryBackground), on which the tile was not there at all (276.6).
      backgroundColor: ROOM_MARK_FILL,
    },
    letters: { color: ColorPalette.brand.primary, fontSize: 18 },
    words: { flex: 1, minWidth: 0, gap: 2 },
    title: { fontSize: 22, color: ColorPalette.brand.text },
    idName: { fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }) },
    where: { fontSize: 15, color: ColorPalette.grayscale.mediumGrey },
  })
  const header = (
    <View style={styles.header} testID={testIdWithKey('RoomHeader')}>
      <View style={styles.mark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {byId ? (
          <Icon name="door" size={24} color={ColorPalette.brand.primary} />
        ) : (
          <ThemedText variant="bold" style={styles.letters} testID={testIdWithKey('RoomMonogram')}>
            {initialsOf(String(room.name))}
          </ThemedText>
        )}
      </View>
      <View style={styles.words}>
        <ThemedText
          variant="headingFour"
          style={[styles.title, byId ? styles.idName : undefined]}
          accessibilityRole="header"
          testID={testIdWithKey('RoomTitle')}
        >
          {roomTitle(t, room)}
        </ThemedText>
        {where ? (
          <ThemedText style={styles.where} testID={testIdWithKey('RoomWhere')}>
            {where}
          </ThemedText>
        ) : null}
      </View>
      <TierBadge tier={room.tier} />
      {onPress ? <Icon name="chevron-right" size={24} color={ColorPalette.grayscale.mediumGrey} /> : null}
    </View>
  )
  if (!onPress) return header
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[roomTitle(t, room), where].filter(Boolean).join(', ')}
      accessibilityHint={t('Rooms.DetailsHint') as string}
      testID={testIdWithKey('RoomDetailsOpen')}
    >
      {header}
    </Pressable>
  )
}

export default RoomHeader
