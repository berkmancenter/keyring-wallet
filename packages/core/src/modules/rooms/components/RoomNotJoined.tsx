/**
 * A sealed room the community lists for this identity while the agent holds none of its keys as it
 * (`RoomSummary.joined === false`). A community's re-invite does not re-admit to a room: its posts, notes and files said
 * "Couldn't read… Try again later" for ever, and trying again could never help (34VR-Y58H, 277.8, 11-03). Said once,
 * in place of what cannot be read, with the way to an offer for the room when one is waiting.
 *
 * @module rooms/components/RoomNotJoined
 */
import { useNavigation } from '@react-navigation/native'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { communityLabelOf } from '../../trust-tasks/screens/communityName'
import type { RoomSummary } from '../types'
import { useRoomsService } from '../useRoomsService'

export const RoomNotJoined: React.FC<{ room: Pick<RoomSummary, 'roomId' | 'communityDid' | 'communityName'> }> = ({
  room,
}) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const navigation = useNavigation() as unknown as { navigate: (name: string, params: object) => void }
  const service = useRoomsService()
  // An offer for this room, if the community has one waiting: accepting it is how the member gets in.
  const [offerId, setOfferId] = useState<string | undefined>()
  useEffect(() => {
    if (!service || !room.communityDid) return
    let live = true
    service
      .listOffers(room.communityDid)
      .then((offers) => live && setOfferId(offers.find((o) => o.roomId === room.roomId)?.offerId))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [service, room.roomId, room.communityDid])
  const community = room.communityName
    ? String(room.communityName)
    : room.communityDid
      ? communityLabelOf(room.communityDid, t)
      : (t('Rooms.CommunityNotKnown') as string)
  const styles = StyleSheet.create({
    scroll: { flex: 1 },
    card: {
      margin: 16,
      padding: 16,
      gap: 8,
      borderRadius: 12,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
  })
  // It scrolls: at the largest text the words and the button run past the screen, and the button is the way back in.
  return (
    <ScrollView style={styles.scroll}>
      <View style={styles.card} testID={testIdWithKey('RoomNotJoined')}>
        <ThemedText variant="bold" accessibilityRole="header">
          {t('Rooms.NotJoinedTitle')}
        </ThemedText>
        <ThemedText>{t('Rooms.NotJoinedBody', { community, interpolation: { escapeValue: false } })}</ThemedText>
        {offerId ? (
          <Button
            title={t('Rooms.NotJoinedOffer')}
            buttonType={ButtonType.Primary}
            onPress={() => navigation.navigate(Screens.RoomOffer, { offerRef: offerId })}
            testID={testIdWithKey('RoomNotJoinedOffer')}
          />
        ) : null}
      </View>
    </ScrollView>
  )
}

export default RoomNotJoined
