/**
 * A room's notes and files as list rows. Room text (titles, names) is inert: shown as plain text, never
 * followed or interpreted. A note's key is never shown as its title: on attributed and private rooms the
 * title is sealed with the body, so the row says the note is encrypted until it is read. A retracted note
 * is a tombstone: it says so and has no body.
 *
 * A file row opens the attachment sheet; a note row opens nothing yet.
 *
 * @module rooms/components/RoomListRows
 */
import type { TFunction } from 'i18next'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { localDate } from '../../trust-tasks/screens/localTime'
import { testIdWithKey } from '../../../utils/testable'
import type { Identity, NoteSummary, RoomFile } from '../types'

import { fileIcon, fileSizeText, fileTypeText } from './fileWords'
import { useMemberWords } from './memberWords'
import { roomHandle } from './RoomRow'
import { memberText } from './roomWords'

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

/** Who wrote it and when, and its curation state, in one line; `words` names the author (see useMemberWords). */
export const noteLine = (
  t: TFunction,
  note: NoteSummary,
  words: (identity: Identity) => string = (identity) => memberText(t, identity)
): string =>
  [
    note.status === 'retracted' ? (t('Rooms.NoteRetracted') as string) : undefined,
    note.status === 'deprecated' ? (t('Rooms.NoteOutdated') as string) : undefined,
    note.author
      ? note.byAgent
        ? (t('Rooms.NoteByAgentFor', {
            who: words(note.author),
            interpolation: { escapeValue: false },
          }) as string)
        : words(note.author)
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

/** The type and size the sharer gave, in the app's words ("PDF · 84 KB"), then who shared it and when. */
export const fileLines = (
  t: TFunction,
  file: RoomFile,
  language: string,
  words: (identity: Identity) => string = (identity) => memberText(t, identity)
): [string, string] => [
  [fileTypeText(file), file.size !== undefined ? fileSizeText(t, file.size, language) : undefined]
    .filter(Boolean)
    .join(' · '),
  [
    file.sharedBy
      ? (t('Rooms.FileSharedBy', {
          who: words(file.sharedBy),
          interpolation: { escapeValue: false },
        }) as string)
      : undefined,
    file.sharedAt ? localDate(file.sharedAt) : undefined,
  ]
    .filter(Boolean)
    .join(' · '),
]

/** A file in the room's library. A tap opens the attachment sheet; with no `onPress` the row is not a button. */
export const FileRow: React.FC<{ file: RoomFile; onPress?: (file: RoomFile) => void }> = ({ file, onPress }) => {
  const { t, i18n } = useTranslation()
  const { ColorPalette } = useTheme()
  const styles = useRowStyles()
  const memberWords = useMemberWords()
  const [facts, shared] = fileLines(t, file, i18n.language, memberWords)
  const label = [String(file.name), facts, shared].filter(Boolean).join(', ')
  const testID = testIdWithKey(`RoomFileRow_${roomHandle(file.fileId)}`)
  const content = (
    <>
      <Icon name={fileIcon(file)} size={26} color={ColorPalette.brand.primary} />
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText variant="bold" numberOfLines={2} ellipsizeMode="middle">
          {file.name}
        </ThemedText>
        {facts ? (
          <ThemedText variant="caption" style={styles.muted}>
            {facts}
          </ThemedText>
        ) : null}
        {shared ? (
          <ThemedText variant="caption" style={styles.muted}>
            {shared}
          </ThemedText>
        ) : null}
      </View>
    </>
  )
  if (!onPress)
    return (
      <View style={styles.row} accessible accessibilityLabel={label} testID={testID}>
        {content}
      </View>
    )
  return (
    <Pressable
      style={styles.row}
      onPress={() => onPress(file)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('Rooms.FileOpenHint')}
      testID={testID}
    >
      {content}
      <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
    </Pressable>
  )
}
