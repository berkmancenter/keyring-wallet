/**
 * A room's header (data rooms, header B): the room's letters, its name, the community it is in and until when the
 * member's access runs, and its tier. Who the member acts as is said once, in the composer, not here.
 *
 * @module rooms/components/RoomHeader
 */
import type { TFunction } from 'i18next'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Platform, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { localDate } from '../../trust-tasks/screens/localTime'
import type { RoomSummary } from '../types'

import { initialsOf } from './RoomIdentitySheet'
import { roomTitle } from './RoomRow'
import TierBadge from './TierBadge'

/** "in Keyring Lab · until 26 Jan 2027": either part alone when the other is not known. */
export const roomWhere = (
  t: TFunction,
  room: Pick<RoomSummary, 'communityName' | 'validUntil'>
): string | undefined => {
  const date = room.validUntil ? localDate(room.validUntil) : undefined
  const community = room.communityName ? String(room.communityName) : undefined
  if (community && date)
    return t('Rooms.RoomInUntil', { community, date, interpolation: { escapeValue: false } }) as string
  if (community) return t('Rooms.RoomIn', { community, interpolation: { escapeValue: false } }) as string
  if (date) return t('Rooms.Until', { date }) as string
  return undefined
}

export const RoomHeader: React.FC<{ room: RoomSummary }> = ({ room }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const where = roomWhere(t, room)
  const byId = room.nameFrom === 'roomId'
  const styles = StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
    mark: {
      width: 48,
      height: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    letters: { color: ColorPalette.brand.primary, fontSize: 18 },
    words: { flex: 1, gap: 2 },
    idName: { fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }) },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  return (
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
          style={byId ? styles.idName : undefined}
          accessibilityRole="header"
          testID={testIdWithKey('RoomTitle')}
        >
          {roomTitle(t, room)}
        </ThemedText>
        {where ? (
          <ThemedText style={styles.muted} testID={testIdWithKey('RoomWhere')}>
            {where}
          </ThemedText>
        ) : null}
      </View>
      <TierBadge tier={room.tier} />
    </View>
  )
}

export default RoomHeader
