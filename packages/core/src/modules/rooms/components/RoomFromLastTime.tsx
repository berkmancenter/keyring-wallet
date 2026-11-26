/**
 * "From last time · Updating…": what a room says while the posts or notes it draws are the phone's own copy from
 * before (the kept copy, or this run's last listing) and the room's first listing has not answered (`useRoomPosts`
 * `unconfirmed`). Gone once it has. A listing that fails takes the copy off the screen, so this is never said beside
 * a failure.
 *
 * @module rooms/components/RoomFromLastTime
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

/** Whether a feed says its posts are not confirmed by the room yet: only `true` counts, so a feed that does not say shows nothing. */
export const isUnconfirmed = (feed: unknown): boolean =>
  (feed as { unconfirmed?: unknown } | undefined)?.unconfirmed === true

export const RoomFromLastTime: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const grey = ColorPalette.grayscale.mediumGrey
  return (
    <View
      style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 6, paddingVertical: 8 }}
      accessibilityLiveRegion="polite"
      testID={testIdWithKey('RoomFromLastTime')}
    >
      <ActivityIndicator size="small" color={grey} />
      <ThemedText style={{ color: grey }}>{t('Rooms.FromLastTimeUpdating')}</ThemedText>
    </View>
  )
}

export default RoomFromLastTime
