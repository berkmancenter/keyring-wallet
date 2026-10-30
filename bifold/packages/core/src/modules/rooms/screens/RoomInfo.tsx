/**
 * A room's details (rooms in Messages, R2), opened from the title above its chat, as a group chat's are: the room, its
 * community and until when the member's access runs, and its tier; then its parts, Files, Notes and Members, each a
 * screen of its own (RoomPart); then the member here, who they post as and what they may do, which opens their own
 * sheet; then Hide from Messages, and the community's screen, where leaving is done.
 *
 * Nothing here is listed: the room itself is already known to this phone, and each part reads its own list when it is
 * opened, so this screen asks the agent nothing new.
 *
 * @module rooms/screens/RoomInfo
 */
import { useNavigation, useRoute } from '@react-navigation/native'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Toast from 'react-native-toast-message'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { UNDO_WINDOW_MS } from '../../chat/pendingChatDeletes'
import { communityTarget } from '../../trust-tasks/module/vtiCommunityLink'
import { ROOM_MARK_FILL, RoomHeader } from '../components/RoomHeader'
import { initialsOf, RoomIdentitySheet } from '../components/RoomIdentitySheet'
import { roleText } from '../components/RoomMembersTab'
import { roomTitle } from '../components/RoomRow'
import { openInMyAgent } from '../roomLinks'
import type { Identity } from '../types'
import { useMyName } from '../useMyName'
import { type RoomListing, useRoom } from '../useRoom'
import { canHideRoom, hideRoom } from '../useRoomRows'
import { useRoomsService } from '../useRoomsService'

const NO_LISTINGS: readonly RoomListing[] = []
const PARTS = [
  { part: 'files', icon: 'file-multiple-outline', words: 'Rooms.Files' },
  { part: 'notes', icon: 'note-text-outline', words: 'Rooms.Notes' },
  { part: 'members', icon: 'account-group-outline', words: 'Rooms.Members' },
] as const
// A table, so that the test-ID manifest names each one (scripts/gen-testids.mjs).
const PART_TEST_ID: Record<(typeof PARTS)[number]['part'], string> = {
  files: 'RoomInfoFiles',
  notes: 'RoomInfoNotes',
  members: 'RoomInfoMembers',
}
const asWritten = { interpolation: { escapeValue: false } }

const RoomInfo: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const roomId = (useRoute()?.params as { roomId?: string } | undefined)?.roomId ?? ''
  const navigation = useNavigation() as unknown as { navigate: (name: string, params: object) => void }
  const service = useRoomsService()
  const state = useRoom(service, roomId, NO_LISTINGS)
  const { room } = state
  const me = useMyName(room?.communityDid)
  const [sheetFor, setSheetFor] = useState<Identity>()

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    centered: { padding: 16, gap: 8 },
    caption: {
      paddingHorizontal: 16,
      paddingTop: 18,
      paddingBottom: 6,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      color: ColorPalette.grayscale.mediumGrey,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      minHeight: 56,
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      marginLeft: 54,
      backgroundColor: ColorPalette.grayscale.lightGrey,
    },
    label: { flex: 1, minWidth: 0, fontSize: 17 },
    sub: { fontSize: 14, color: ColorPalette.grayscale.mediumGrey },
    mark: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: ROOM_MARK_FILL,
    },
    letter: { fontSize: 12, color: ColorPalette.brand.primary },
    footnote: { paddingHorizontal: 16, paddingVertical: 12, color: ColorPalette.grayscale.mediumGrey },
  })

  if (!service)
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <ThemedText style={styles.centered} testID={testIdWithKey('RoomsOff')}>
          {t('Rooms.Off')}
        </ThemedText>
      </SafeAreaView>
    )

  if (!room)
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']} testID={testIdWithKey('RoomInfo')}>
        {state.unreachable ? (
          <View style={styles.centered}>
            <ThemedText testID={testIdWithKey('RoomReadFailed')}>{t('Rooms.AgentUnknown')}</ThemedText>
            <Button
              title={t('Rooms.TryAgain')}
              buttonType={ButtonType.Secondary}
              onPress={state.reload}
              testID={testIdWithKey('RoomTryAgain')}
            />
          </View>
        ) : (
          <ActivityIndicator
            style={styles.centered}
            color={ColorPalette.brand.primary}
            testID={testIdWithKey('RoomReading')}
          />
        )}
      </SafeAreaView>
    )

  const community =
    (room.communityName ? String(room.communityName) : undefined) ??
    (room.communityDid ? communityTarget.publishedNameOf(room.communityDid) : undefined)
  const hide = () => {
    const undo = hideRoom(roomId)
    if (!undo) return
    Toast.show({
      type: 'undo',
      text1: t('Rooms.Hidden', { room: roomTitle(t, room), ...asWritten }) as string,
      visibilityTime: UNDO_WINDOW_MS,
      props: { onUndo: undo },
    })
  }
  const chevron = <Icon name="chevron-right" size={24} color={ColorPalette.grayscale.mediumGrey} />
  const icon = (name: string) => <Icon name={name} size={24} color={ColorPalette.brand.primary} />

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']} testID={testIdWithKey('RoomInfo')}>
      <ScrollView>
        <RoomHeader room={room} />

        <ThemedText style={styles.caption} accessibilityRole="header">
          {t('Rooms.InThisRoom')}
        </ThemedText>
        {PARTS.map(({ part, icon: name, words }, i) => (
          <View key={part}>
            {i > 0 ? <View style={styles.divider} /> : null}
            <Pressable
              style={styles.item}
              onPress={() => navigation.navigate(Screens.RoomPart, { roomId, part })}
              accessibilityRole="button"
              testID={testIdWithKey(PART_TEST_ID[part])}
            >
              {icon(name)}
              <ThemedText style={styles.label}>{t(words)}</ThemedText>
              {chevron}
            </Pressable>
          </View>
        ))}

        <ThemedText style={styles.caption} accessibilityRole="header">
          {t('Rooms.YouHere')}
        </ThemedText>
        <Pressable
          style={styles.item}
          onPress={() => setSheetFor(room.actingAs)}
          accessibilityRole="button"
          testID={testIdWithKey('RoomInfoYou')}
        >
          <View style={styles.mark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {me.name ? (
              <ThemedText variant="bold" style={styles.letter}>
                {initialsOf(me.name).slice(0, 1)}
              </ThemedText>
            ) : (
              <Icon name="account-outline" size={16} color={ColorPalette.brand.primary} />
            )}
          </View>
          <View style={styles.label}>
            <ThemedText>
              {me.name ? t('Rooms.PostingAs', { who: me.name, ...asWritten }) : t('Rooms.PostingAsAddName')}
            </ThemedText>
            {room.verbs ? <ThemedText style={styles.sub}>{roleText(t, room.verbs)}</ThemedText> : null}
          </View>
          {chevron}
        </Pressable>
        {canHideRoom(roomId) ? (
          <>
            <View style={styles.divider} />
            <Pressable
              style={styles.item}
              onPress={hide}
              accessibilityRole="button"
              testID={testIdWithKey('RoomInfoHide')}
            >
              {icon('eye-off-outline')}
              <ThemedText style={styles.label}>{t('Rooms.HideFromMessages')}</ThemedText>
            </Pressable>
          </>
        ) : null}
        {room.communityDid ? (
          <>
            <View style={styles.divider} />
            <Pressable
              style={styles.item}
              onPress={() => openInMyAgent(navigation, Screens.VtiCommunity, { communityDid: room.communityDid })}
              accessibilityRole="button"
              testID={testIdWithKey('RoomInfoCommunity')}
            >
              {icon('account-multiple-outline')}
              <ThemedText style={styles.label}>
                {community ? t('Rooms.OpenCommunity', { community, ...asWritten }) : t('Rooms.OpenCommunityUnnamed')}
              </ThemedText>
              {chevron}
            </Pressable>
            <ThemedText style={styles.footnote}>{t('Rooms.MembersLeaveHint')}</ThemedText>
          </>
        ) : null}
      </ScrollView>
      <RoomIdentitySheet
        identity={sheetFor}
        communityDid={room.communityDid}
        mine={sheetFor?.did === room.actingAs.did}
        me={me}
        onClose={() => setSheetFor(undefined)}
        onOpenProfile={(profileId) => openInMyAgent(navigation, Screens.EditRCard, profileId ? { profileId } : {})}
      />
    </SafeAreaView>
  )
}

export default RoomInfo
