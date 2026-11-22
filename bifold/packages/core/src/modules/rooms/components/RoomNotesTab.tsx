/**
 * A room's notes (data rooms mock, Notes): its longer, titled records, pinned ones first, then newest first, each
 * shown exactly as written. They come from the same reading as the chat, so "Load older" here reads the same next
 * page, and pull to refresh reads the room again.
 *
 * Where notes can't be listed, the tab says why in the rooms screens' usual words, never an empty list.
 *
 * Where the member may write, "New note" opens the note editor, and each of their own notes offers Edit. Where
 * writing isn't open to them yet, the tab says so instead of offering a button that would fail.
 *
 * @module rooms/components/RoomNotesTab
 */
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { RoomPost } from '../roomPosts'
import type { OperationStatus, RoomFile } from '../types'
import type { RoomPosts } from '../useRoomPosts'

import { isComingSoon, RoomFeatureCard } from './RoomFeatureCard'
import { RoomNoteCard } from './RoomNoteCard'

export interface RoomNotesTabProps {
  /** The room's notes, newest first; undefined while reading. */
  notes?: RoomPost[]
  feed: Pick<RoomPosts, 'failed' | 'refreshing' | 'refresh' | 'hasOlder' | 'loadOlder' | 'loadingOlder' | 'incomplete'>
  /** Why notes can't be listed here, in words; none where they can. */
  unavailable?: string
  onOpenFile?: (file: RoomFile) => void
  /** Opens the editor for a new note; none where the member can't write one. */
  onNewNote?: () => void
  /** Opens the editor on one of the member's own notes. */
  onEditNote?: (note: RoomPost) => void
  /** Why notes can't be written here, in words; none where they can or the room doesn't say. */
  cannotWrite?: string
  /** The room's write status: where writing is on its way, a card says so in place of `cannotWrite`. */
  writeStatus?: OperationStatus
}

/** Pinned first, keeping the order given (newest first) within each. */
export const pinnedFirst = (notes: RoomPost[]): RoomPost[] => [
  ...notes.filter((n) => n.pinned && !n.retracted),
  ...notes.filter((n) => !n.pinned || n.retracted),
]

export const RoomNotesTab: React.FC<RoomNotesTabProps> = ({
  notes,
  feed,
  unavailable,
  onOpenFile,
  onNewNote,
  onEditNote,
  cannotWrite,
  writeStatus,
}) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const sorted = useMemo(() => (notes ? pinnedFirst(notes) : []), [notes])
  const styles = StyleSheet.create({
    list: { paddingHorizontal: 16, paddingVertical: 8, gap: 10 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    centered: { paddingVertical: 16 },
    footer: { gap: 12, paddingTop: 4 },
    header: { gap: 10 },
  })

  const empty = unavailable ? (
    <ThemedText style={[styles.muted, styles.centered]} testID={testIdWithKey('RoomNotesUnavailable')}>
      {unavailable}
    </ThemedText>
  ) : feed.failed && !notes ? (
    <ThemedText style={[styles.muted, styles.centered]} testID={testIdWithKey('RoomNotesFailed')}>
      {t('Rooms.NotesFailed')}
    </ThemedText>
  ) : notes ? (
    <ThemedText style={[styles.muted, styles.centered]} testID={testIdWithKey('RoomNotesNone')}>
      {t('Rooms.NotesNone')}
    </ThemedText>
  ) : (
    <ActivityIndicator
      style={styles.centered}
      color={ColorPalette.brand.primary}
      accessibilityLabel={t('Rooms.Reading')}
      testID={testIdWithKey('RoomNotesReading')}
    />
  )

  return (
    <FlatList
      testID={testIdWithKey('RoomNotes')}
      data={unavailable ? [] : sorted}
      keyExtractor={(note) => `${note.key}-${note.version}`}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        unavailable ? null : (
          <View style={styles.header}>
            {onNewNote ? (
              <Button
                title={t('Rooms.NoteNew')}
                buttonType={ButtonType.Secondary}
                onPress={onNewNote}
                testID={testIdWithKey('RoomNoteNew')}
              />
            ) : isComingSoon(writeStatus) ? (
              <RoomFeatureCard status={writeStatus} feature="noteWrite" />
            ) : cannotWrite ? (
              <ThemedText style={styles.muted} testID={testIdWithKey('RoomNotesCannotWrite')}>
                {cannotWrite}
              </ThemedText>
            ) : null}
            <ThemedText variant="caption" style={styles.muted} testID={testIdWithKey('RoomNotesCaption')}>
              {t('Rooms.NotesCaption')}
            </ThemedText>
          </View>
        )
      }
      renderItem={({ item }) => <RoomNoteCard note={item} onOpenFile={onOpenFile} onEdit={onEditNote} />}
      ListEmptyComponent={empty}
      refreshControl={
        unavailable ? undefined : (
          <RefreshControl
            refreshing={feed.refreshing}
            onRefresh={feed.refresh}
            tintColor={ColorPalette.brand.primary}
          />
        )
      }
      // Older notes load as the member scrolls down to them; the app's spinner shows while they are read. No button.
      onEndReached={feed.hasOlder && !feed.loadingOlder && !unavailable ? feed.loadOlder : undefined}
      onEndReachedThreshold={0.25}
      ListFooterComponent={
        <View style={styles.footer}>
          {feed.loadingOlder && !unavailable ? (
            <ActivityIndicator
              color={ColorPalette.brand.primary}
              accessibilityLabel={t('Rooms.Reading')}
              testID={testIdWithKey('RoomNotesLoadingOlder')}
            />
          ) : feed.incomplete && !feed.hasOlder && !unavailable ? (
            <ThemedText style={styles.muted} testID={testIdWithKey('RoomNotesIncomplete')}>
              {t('Rooms.NotesIncomplete')}
            </ThemedText>
          ) : null}
        </View>
      }
    />
  )
}

export default RoomNotesTab
