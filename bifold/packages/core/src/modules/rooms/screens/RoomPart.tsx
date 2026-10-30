/**
 * One part of a room, opened from its details (rooms in Messages, R2): its files, the room's library; its notes, the
 * titled records and the markers of removed ones, which the chat leaves out; or its members, the member's own access
 * and the community's list. Each was a tab of the room's screen (data rooms mock), and reads only its own list.
 *
 * Files: opening one shows the attachment sheet; "Add a file" goes back to the chat with its "+" open, since a file is
 * posted from the composer. Notes: a member who may write adds a titled note and edits their own, through the note
 * editor's check before posting; the notes are read again while they are in view, as the chat's posts are. Members: a
 * name opens that member's sheet, and leaving is on the community's screen.
 *
 * @module rooms/screens/RoomPart
 */
import { useNavigation, useRoute } from '@react-navigation/native'
import type { TFunction } from 'i18next'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { useDirectoryNames, useDirectoryService } from '../../directory/useDirectory'
import { PetnamesProvider } from '../components/memberWords'
import { RoomFileSheet } from '../components/RoomFileSheet'
import { RoomFilesTab } from '../components/RoomFilesTab'
import { RoomIdentitySheet } from '../components/RoomIdentitySheet'
import { RoomMembersTab } from '../components/RoomMembersTab'
import { type NoteEditorTarget, RoomNoteEditor } from '../components/RoomNoteEditor'
import { RoomNotesTab } from '../components/RoomNotesTab'
import { roomsStatusText } from '../components/roomsStatusText'
import { isNote } from '../roomPosts'
import { openInMyAgent } from '../roomLinks'
import type { Identity, RoomFile } from '../types'
import { useInViewAndActive } from '../useInViewAndActive'
import { useMyName } from '../useMyName'
import { usePetnames } from '../usePetname'
import { type RoomListing, useRoom } from '../useRoom'
import { useRoomPosts } from '../useRoomPosts'
import { useRoomsService } from '../useRoomsService'

export type RoomPartName = 'files' | 'notes' | 'members'

const LISTINGS: Record<RoomPartName, readonly RoomListing[]> = { files: ['files'], notes: [], members: [] }
const NO_DIDS: readonly string[] = []
const TITLES: Record<RoomPartName, string> = { files: 'Rooms.Files', notes: 'Rooms.Notes', members: 'Rooms.Members' }

/** The part's name as its screen's title. */
export const roomPartTitle = (t: TFunction, part: RoomPartName | undefined): string =>
  t(TITLES[part ?? 'files']) as string

const RoomPart: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const params = useRoute()?.params as { roomId?: string; part?: RoomPartName } | undefined
  const roomId = params?.roomId ?? ''
  const part = params?.part ?? 'files'
  const navigation = useNavigation() as unknown as { navigate: (name: string, params: object) => void }
  const service = useRoomsService()
  const state = useRoom(service, roomId, LISTINGS[part])
  const { room, roomCapabilities, reload } = state
  const inView = useInViewAndActive()
  // Only the notes read the room's posts: they come from the same reading as the chat's.
  const canList = roomCapabilities?.listNotes.status === 'available'
  const feed = useRoomPosts(service, roomId, room?.actingAs, part === 'notes' && !!room && canList, inView)
  const [openedFile, setOpenedFile] = useState<RoomFile>()
  const [noteEditor, setNoteEditor] = useState<NoteEditorTarget>()
  const [sheetFor, setSheetFor] = useState<Identity>()
  const me = useMyName(room?.communityDid)
  const petnames = usePetnames(room?.communityDid)
  const directoryNames = useDirectoryNames(useDirectoryService(), room?.communityDid, NO_DIDS)

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    centered: { padding: 16, gap: 8 },
  })

  if (!service)
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <ThemedText style={styles.centered} testID={testIdWithKey('RoomsOff')}>
          {t('Rooms.Off')}
        </ThemedText>
      </SafeAreaView>
    )

  if (!room || !roomCapabilities)
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']} testID={testIdWithKey('RoomPart')}>
        {state.unreachable ? (
          <View style={styles.centered}>
            <ThemedText testID={testIdWithKey('RoomReadFailed')}>{t('Rooms.AgentUnknown')}</ThemedText>
            <Button
              title={t('Rooms.TryAgain')}
              buttonType={ButtonType.Secondary}
              onPress={reload}
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

  const unavailable = roomsStatusText(t, roomCapabilities.listNotes, 'listNotes')
  const cannotPost = roomsStatusText(t, roomCapabilities.write, 'write')
  // Notes are written wherever the room's write status allows; where it does not, the notes say why.
  const canWriteNotes = !unavailable && !cannotPost
  const canOpenFiles = roomCapabilities.openFile.status === 'available'
  // As the composer's "+": where the room's files are listed and can be opened (see Room).
  const canAttach =
    roomCapabilities.listFiles.status === 'available' && roomCapabilities.openFile.status === 'available'

  return (
    <PetnamesProvider names={petnames} directoryNames={directoryNames}>
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']} testID={testIdWithKey('RoomPart')}>
        {part === 'files' ? (
          <RoomFilesTab
            files={state.files}
            failed={state.filesFailed}
            status={roomCapabilities.listFiles}
            refreshing={state.refreshing}
            onRefresh={reload}
            onOpenFile={canOpenFiles ? setOpenedFile : undefined}
            onAddFile={
              unavailable || cannotPost || !canAttach
                ? undefined
                : // Back to the chat below, with a new number: its composer opens the file picker.
                  () => navigation.navigate(Screens.Room, { roomId, attach: Date.now() })
            }
          />
        ) : null}
        {part === 'notes' ? (
          <RoomNotesTab
            notes={feed.posts?.filter(isNote)}
            feed={feed}
            unavailable={unavailable}
            onOpenFile={canOpenFiles ? setOpenedFile : undefined}
            onNewNote={canWriteNotes ? () => setNoteEditor({ kind: 'new' }) : undefined}
            onEditNote={canWriteNotes ? (note) => setNoteEditor({ kind: 'edit', note }) : undefined}
            cannotWrite={cannotPost}
            writeStatus={roomCapabilities.write}
          />
        ) : null}
        {part === 'members' ? (
          <RoomMembersTab
            me={me}
            onOpenIdentity={setSheetFor}
            service={service}
            room={room}
            status={roomCapabilities.listCommunityMembers}
            onLeave={
              room.communityDid
                ? () => openInMyAgent(navigation, Screens.VtiCommunity, { communityDid: room.communityDid })
                : undefined
            }
          />
        ) : null}
        <RoomFileSheet service={service} roomId={roomId} file={openedFile} onClose={() => setOpenedFile(undefined)} />
        <RoomIdentitySheet
          identity={sheetFor}
          communityDid={room.communityDid}
          mine={sheetFor?.did === room.actingAs.did}
          me={me}
          onClose={() => setSheetFor(undefined)}
          onOpenProfile={(profileId) => openInMyAgent(navigation, Screens.EditRCard, profileId ? { profileId } : {})}
          onViewCard={
            room.communityDid
              ? (memberDid, standIn) => {
                  setSheetFor(undefined)
                  openInMyAgent(navigation, Screens.CommunityMemberCard, {
                    communityDid: room.communityDid,
                    memberDid,
                    standIn,
                  })
                }
              : undefined
          }
        />
        <RoomNoteEditor
          service={service}
          roomId={roomId}
          communityDid={room.communityDid}
          target={noteEditor}
          onClose={() => setNoteEditor(undefined)}
          onSaved={feed.refresh}
        />
      </SafeAreaView>
    </PetnamesProvider>
  )
}

export default RoomPart
