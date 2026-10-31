/**
 * One of a room's notes (data rooms mock, Notes): its title, who wrote it (an AI agent's labelled as the agent's)
 * and when, and its whole text, shown exactly as written: links, markup and instruction-like text are displayed,
 * never followed. A pinned note says so. A note a curator removed keeps its place as a marker, with no text. The
 * member's own notes offer Edit, which saves a new version.
 *
 * @module rooms/components/RoomNoteCard
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { localDate } from '../../trust-tasks/screens/localTime'
import type { RoomPost } from '../roomPosts'
import type { RoomFile } from '../types'

import { RoomFileChip } from './RoomFileChip'
import { roomHandle } from './RoomRow'
import { useMemberWords } from './memberWords'

export const RoomNoteCard: React.FC<{
  note: RoomPost
  onOpenFile?: (file: RoomFile) => void
  /** Opens the editor on this note; offered only on the member's own notes that were read. */
  onEdit?: (note: RoomPost) => void
}> = ({ note, onOpenFile, onEdit }) => {
  const { t } = useTranslation()
  const memberWords = useMemberWords()
  const { ColorPalette } = useTheme()
  const muted = ColorPalette.grayscale.mediumGrey
  const styles = StyleSheet.create({
    card: {
      gap: 6,
      padding: 12,
      borderRadius: 10,
      borderWidth: note.byAgent ? 1.5 : 1,
      borderStyle: note.byAgent ? 'dashed' : 'solid',
      borderColor: ColorPalette.grayscale.lightGrey,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    muted: { color: muted },
    quiet: { color: muted, fontStyle: 'italic' },
  })
  const author = note.author ? (note.mine ? (t('Rooms.You') as string) : memberWords(note.author)) : undefined
  const who = author
    ? note.byAgent
      ? (t('Rooms.NoteByAgentFor', { who: author, interpolation: { escapeValue: false } }) as string)
      : author
    : undefined
  const editable = !!onEdit && note.mine && !note.retracted && !note.unread && !note.delivery
  const line = [who, note.at ? localDate(note.at.toISOString()) : undefined].filter(Boolean).join(' · ')
  const title = note.retracted
    ? (t('Rooms.NoteRetracted') as string)
    : note.title
      ? String(note.title)
      : (t('Rooms.NoteEncrypted') as string)
  return (
    <View style={styles.card} testID={testIdWithKey(`RoomNote_${roomHandle(note.key)}`)}>
      <View style={styles.head}>
        <Icon
          name={note.retracted ? 'note-remove-outline' : note.pinned ? 'pin' : 'note-text-outline'}
          size={20}
          color={note.retracted ? muted : ColorPalette.brand.primary}
          accessibilityLabel={note.pinned && !note.retracted ? (t('Rooms.NotePinned') as string) : undefined}
          testID={note.pinned && !note.retracted ? testIdWithKey('RoomNotePinned') : undefined}
        />
        <ThemedText
          variant="bold"
          style={[{ flex: 1 }, note.retracted ? styles.muted : undefined]}
          accessibilityRole="header"
        >
          {title}
        </ThemedText>
        {editable ? (
          <Pressable
            onPress={() => onEdit?.(note)}
            accessibilityRole="button"
            accessibilityLabel={t('Rooms.NoteEdit')}
            hitSlop={8}
            testID={testIdWithKey('RoomNoteEdit')}
          >
            <ThemedText variant="bold" style={{ color: ColorPalette.brand.primary }}>
              {t('Rooms.NoteEdit')}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      {line ? (
        <ThemedText variant="caption" style={styles.muted}>
          {line}
          {note.byAgent ? (
            <ThemedText variant="caption" style={[styles.muted, { fontWeight: '700' }]}>
              {` · ${t('Rooms.AgentBadge')}`}
            </ThemedText>
          ) : null}
        </ThemedText>
      ) : null}
      {note.retracted ? (
        <ThemedText style={styles.quiet} testID={testIdWithKey('RoomNoteRemoved')}>
          {t('Rooms.NoteRemoved')}
        </ThemedText>
      ) : note.unread ? (
        <ThemedText style={styles.quiet} testID={testIdWithKey('RoomNoteUnread')}>
          {t('Rooms.PostUnread')}
        </ThemedText>
      ) : (
        <>
          {note.text ? <ThemedText selectable>{note.text}</ThemedText> : null}
          {note.files.map((file) => (
            <RoomFileChip
              key={file.fileId}
              file={file}
              ink={ColorPalette.brand.text}
              edge={ColorPalette.grayscale.lightGrey}
              onPress={onOpenFile}
            />
          ))}
        </>
      )}
    </View>
  )
}

export default RoomNoteCard
