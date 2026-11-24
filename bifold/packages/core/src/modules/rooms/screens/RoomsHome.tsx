/**
 * Rooms: the offers waiting on the member, then their rooms grouped by community (rooms member sprint). An offer
 * opens its consent screen, and the list is read again on coming back to it, or when pulled down. Reached from the Rooms card on the
 * My Agent home, only while the rooms flag is on; with it off there is no service and the screen says rooms are
 * off rather than showing an empty list.
 *
 * @module rooms/screens/RoomsHome
 */
import { useNavigation } from '@react-navigation/native'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshControl, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import RoomsListBody from '../components/RoomsListBody'
import { SampleDataBanner } from '../components/SampleDataBanner'
import { useMyRooms } from '../useMyRooms'
import { useRereadOnReturn } from '../useRereadOnReturn'
import { useRoomsService } from '../useRoomsService'

const RoomsHome: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const navigation = useNavigation()
  const service = useRoomsService()
  const myRooms = useMyRooms(service)
  const go = navigation as unknown as { navigate: (name: string, params: object) => void }
  const openRoom = (room: { roomId: string }) => go.navigate(Screens.Room, { roomId: room.roomId })
  const openOffer = (offer: { offerId: string }) => go.navigate(Screens.RoomOffer, { offerRef: offer.offerId })
  useRereadOnReturn(myRooms)
  const { reload } = myRooms
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 16, gap: 16 },
  })
  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        testID={testIdWithKey('RoomsHome')}
        refreshControl={
          service ? (
            <RefreshControl refreshing={myRooms.refreshing} onRefresh={reload} tintColor={ColorPalette.brand.primary} />
          ) : undefined
        }
      >
        {service ? (
          <>
            <SampleDataBanner service={service} />
            <RoomsListBody myRooms={myRooms} acrossCommunities onOpenRoom={openRoom} onOpenOffer={openOffer} />
          </>
        ) : (
          <ThemedText testID={testIdWithKey('RoomsOff')}>{t('Rooms.Off')}</ThemedText>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

export default RoomsHome
