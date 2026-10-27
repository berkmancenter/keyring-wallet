/**
 * Rooms: the offers waiting on the member, then their rooms grouped by community (rooms member sprint). Reached
 * from the Rooms card on the My Agent home, only while the rooms flag is on; with it off there is no service and
 * the screen says rooms are off rather than showing an empty list.
 *
 * @module rooms/screens/RoomsHome
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import RoomsListBody from '../components/RoomsListBody'
import { SampleDataBanner } from '../components/SampleDataBanner'
import { useMyRooms } from '../useMyRooms'
import { useRoomsService } from '../useRoomsService'

const RoomsHome: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const service = useRoomsService()
  const myRooms = useMyRooms(service)
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 16, gap: 16 },
  })
  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} testID={testIdWithKey('RoomsHome')}>
        {service ? (
          <>
            <SampleDataBanner service={service} />
            <RoomsListBody myRooms={myRooms} acrossCommunities />
          </>
        ) : (
          <ThemedText testID={testIdWithKey('RoomsOff')}>{t('Rooms.Off')}</ThemedText>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

export default RoomsHome
