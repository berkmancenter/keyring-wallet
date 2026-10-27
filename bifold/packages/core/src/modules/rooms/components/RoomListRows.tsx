/**
 * A room's notes and files as list rows. Room text (titles, names) is inert: shown as plain text, never
 * followed or interpreted. A note's key is never shown as its title: on attributed and private rooms the
 * title is sealed with the body, so the row says the note is encrypted until it is read. A retracted note
 * is a tombstone: it says so and has no body.
 *
 * Neither row opens anything yet; reading a note and opening a file come in later steps.
 *
 * @module rooms/components/RoomListRows
 */
import type { TFunction } from 'i18next'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { localDate } from '../../trust-tasks/screens/localTime'
import { testIdWithKey } from '../../../utils/testable'
import type { NoteSummary, RoomFile } from '../types'

import { roomHandle } from './RoomRow'
import { identityText } from './roomWords'

const useRowStyles = () => {
  const { ColorPalette } = useTheme()
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingVertical: 4 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
}

/** The note's title as shown: its own when the host can see it, else that it is encrypted. */
export const noteTitle = (t: TFunction, note: Pick<NoteSummary, 'title'>): string =>
  note.title ?? (t('Rooms.NoteEncrypted') as string)

/** Who wrote it and when, and its curation state, in one line. */
export const noteLine = (t: TFunction, note: NoteSummary): string =>
  [
    note.status === 'retracted' ? (t('Rooms.NoteRetracted') as string) : undefined,
    note.status === 'deprecated' ? (t('Rooms.NoteOutdated') as string) : undefined,
    note.author
      ? note.byAgent
        ? (t('Rooms.NoteByAgentFor', {
            who: identityText(note.author),
            interpolation: { escapeValue: false },
          }) as string)
        : identityText(note.author)
      : undefined,
    note.updatedAt ? localDate(note.updatedAt) : undefined,
  ]
    .filter(Boolean)
    .join(' · ')

export const NoteRow: React.FC<{ note: NoteSummary }> = ({ note }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const styles = useRowStyles()
  const title = noteTitle(t, note)
  const line = noteLine(t, note)
  const retracted = note.status === 'retracted'
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${note.pinned ? `${t('Rooms.NotePinned')}, ` : ''}${title}, ${line}`}
      testID={testIdWithKey(`RoomNoteRow_${roomHandle(note.key)}`)}
    >
      <Icon
        name={note.pinned ? 'pin' : retracted ? 'note-remove-outline' : 'note-text-outline'}
        size={22}
        color={retracted ? ColorPalette.grayscale.mediumGrey : ColorPalette.brand.primary}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText variant={retracted ? 'normal' : 'bold'} style={retracted || !note.title ? styles.muted : undefined}>
          {title}
        </ThemedText>
        {line ? (
          <ThemedText variant="caption" style={styles.muted}>
            {line}
          </ThemedText>
        ) : null}
      </View>
    </View>
  )
}

/** "84 KB", "1.2 MB". */
export const fileSize = (bytes: number): string =>
  bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`

export const FileRow: React.FC<{ file: RoomFile }> = ({ file }) => {
  // Drawn again on a language change, so the shared date follows it.
  useTranslation()
  const { ColorPalette } = useTheme()
  const styles = useRowStyles()
  const line = [
    file.size !== undefined ? fileSize(file.size) : undefined,
    file.sharedBy ? identityText(file.sharedBy) : undefined,
    file.sharedAt ? localDate(file.sharedAt) : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={line ? `${file.name}, ${line}` : file.name}
      testID={testIdWithKey(`RoomFileRow_${roomHandle(file.fileId)}`)}
    >
      <Icon name="file-outline" size={22} color={ColorPalette.brand.primary} />
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText variant="bold">{file.name}</ThemedText>
        {line ? (
          <ThemedText variant="caption" style={styles.muted}>
            {line}
          </ThemedText>
        ) : null}
      </View>
    </View>
  )
}
