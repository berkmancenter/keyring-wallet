/**
 * The Rooms section on a community's screen, for a member (data rooms mock): that community's offers waiting on the
 * member, then their rooms there, beside membership and vetting. An offer opens its consent screen and a room its
 * screen; the section is read again on coming back to it, so an offer accepted or hidden is gone. It is a second way
 * in: the Rooms card on the agent home still lists every room, across communities.
 *
 * It reads as the screen's other sections do (276.10, option A): "ROOMS · 2" over a grouped card, and while the rooms
 * are read, rows in the shape of rooms rather than a lone spinner.
 *
 * Nothing while the rooms flag is off.
 *
 * @module rooms/components/CommunityRoomsSection
 */
import { useNavigation } from '@react-navigation/native'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { View } from 'react-native'

import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { CommunityGroup, CommunitySectionLabel } from '../../trust-tasks/screens/CommunitySection'
import { useMyRooms } from '../useMyRooms'
import { useRereadOnReturn } from '../useRereadOnReturn'
import { useRoomsService } from '../useRoomsService'

import RoomsListBody from './RoomsListBody'
import { SampleDataBanner } from './SampleDataBanner'

/** Two rows in the shape of a room, while the rooms are read. */
const RoomRowsReading: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const block = { backgroundColor: ColorPalette.grayscale.lightGrey, borderRadius: 6 }
  return (
    <View accessible accessibilityLabel={t('Rooms.Reading')} testID={testIdWithKey('RoomsReading')}>
      {[70, 55].map((width) => (
        <View key={width} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 }}>
          <View style={{ ...block, width: 40, height: 40, borderRadius: 10 }} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ ...block, width: `${width}%` as `${number}%`, height: 12 }} />
            <View style={{ ...block, width: `${width - 25}%` as `${number}%`, height: 10, opacity: 0.6 }} />
          </View>
        </View>
      ))}
    </View>
  )
}

export const CommunityRoomsSection: React.FC<{ communityDid: string }> = ({ communityDid }) => {
  const { t } = useTranslation()
  const service = useRoomsService()
  const myRooms = useMyRooms(service, communityDid)
  const go = useNavigation() as unknown as { navigate: (name: string, params: object) => void }
  useRereadOnReturn(myRooms)
  if (!service) return null
  return (
    <View style={{ gap: 6 }} testID={testIdWithKey('CommunityRooms')}>
      <CommunitySectionLabel title={t('Rooms.Rooms')} count={myRooms.rooms?.length} />
      <SampleDataBanner service={service} />
      <CommunityGroup style={{ paddingHorizontal: 14, paddingVertical: 8 }}>
        <RoomsListBody
          myRooms={myRooms}
          acrossCommunities={false}
          onOpenRoom={(room) => go.navigate(Screens.Room, { roomId: room.roomId })}
          onOpenOffer={(offer) => go.navigate(Screens.RoomOffer, { offerRef: offer.offerId })}
          whileReading={<RoomRowsReading />}
        />
      </CommunityGroup>
    </View>
  )
}

export default CommunityRoomsSection
