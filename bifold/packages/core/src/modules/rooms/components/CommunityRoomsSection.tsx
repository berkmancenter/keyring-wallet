/**
 * The Rooms section on a community's screen, for a member (data rooms mock): that community's offers waiting on the
 * member, then their rooms there, beside membership and vetting. An offer opens its consent screen and a room its
 * screen; the section is read again on coming back to it, so an offer accepted or hidden is gone. It is a second way
 * in: the Rooms card on the agent home still lists every room, across communities.
 *
 * Nothing while the rooms flag is off.
 *
 * @module rooms/components/CommunityRoomsSection
 */
import { useNavigation } from '@react-navigation/native'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { useMyRooms } from '../useMyRooms'
import { useRereadOnReturn } from '../useRereadOnReturn'
import { useRoomsService } from '../useRoomsService'

import RoomsListBody from './RoomsListBody'
import { SampleDataBanner } from './SampleDataBanner'

export const CommunityRoomsSection: React.FC<{ communityDid: string }> = ({ communityDid }) => {
  const { t } = useTranslation()
  const service = useRoomsService()
  const myRooms = useMyRooms(service, communityDid)
  const go = useNavigation() as unknown as { navigate: (name: string, params: object) => void }
  useRereadOnReturn(myRooms)
  if (!service) return null
  return (
    <View style={{ gap: 8 }} testID={testIdWithKey('CommunityRooms')}>
      <ThemedText variant="headingFour" accessibilityRole="header">
        {t('Rooms.Rooms')}
      </ThemedText>
      <SampleDataBanner service={service} />
      <RoomsListBody
        myRooms={myRooms}
        acrossCommunities={false}
        onOpenRoom={(room) => go.navigate(Screens.Room, { roomId: room.roomId })}
        onOpenOffer={(offer) => go.navigate(Screens.RoomOffer, { offerRef: offer.offerId })}
      />
    </View>
  )
}

export default CommunityRoomsSection
