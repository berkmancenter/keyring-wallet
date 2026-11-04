/**
 * One line in a room's chat for a note: the chat keeps notes on the room's Notes, so without it a note written from the
 * community's web page or the browser wallet arrives with nothing in the conversation to say so (IN-459). It sits at
 * the note's latest time, and a tap opens the Notes. It only reads: nothing is written to the room.
 *
 * "Note:", not "Note added": a record's version counts per room and nothing on a record shows an edit, so a new note
 * and an edited one look the same from here.
 *
 * One line, the title cut short and "See" always in view. From large text it wraps, "See" under the words: on one line
 * the title would keep a few letters, as a note's card found in a render (11-03).
 *
 * @module rooms/components/RoomNoteMarker
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { InertText } from '../inertText'

/** The text size from which the line wraps. Android reports 1.3 as 1.2999…: compared to two decimals. */
const WRAPS_FROM = 1.3

export interface RoomNoteMarkerProps {
  /** The note's title, shown as written. */
  title?: InertText
  onOpen: () => void
}

export const RoomNoteMarker: React.FC<RoomNoteMarkerProps> = ({ title, onOpen }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { fontScale } = useWindowDimensions()
  const wraps = Math.round(fontScale * 100) / 100 >= WRAPS_FROM
  const label = t('Rooms.NoteMarker') as string
  const open = t('Rooms.NoteMarkerOpen') as string
  const styles = StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: wraps ? 'flex-start' : 'center',
      gap: 8,
      minHeight: 44,
      marginVertical: 4,
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 12,
      // The day pill's colours: #4A4A4A on #E6E0E6 is 6.8:1, which clears AA. Fixed, so light only, as the pill's are.
      backgroundColor: '#E6E0E6',
    },
    words: { flex: 1, minWidth: 0 },
    text: { color: '#4A4A4A', fontSize: 15, lineHeight: 20 },
    title: { fontWeight: '600' },
    open: { fontSize: 15, lineHeight: 20, fontWeight: '700', color: ColorPalette.brand.primary },
  })
  const see = (
    <ThemedText style={styles.open} testID={testIdWithKey('RoomNoteMarkerOpen')}>
      {open}
    </ThemedText>
  )
  return (
    <Pressable
      style={styles.row}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={[label, title].filter(Boolean).join(' ')}
      accessibilityHint={t('Rooms.NotesWaitingOpen') as string}
      testID={testIdWithKey('RoomNoteMarker')}
    >
      <Icon name="note-text-outline" size={18} color={ColorPalette.brand.primary} />
      <View style={styles.words}>
        <ThemedText
          style={styles.text}
          numberOfLines={wraps ? undefined : 1}
          testID={testIdWithKey('RoomNoteMarkerWords')}
        >
          {label} <ThemedText style={[styles.text, styles.title]}>{title}</ThemedText>
        </ThemedText>
        {wraps ? see : null}
      </View>
      {wraps ? null : see}
    </Pressable>
  )
}

export default RoomNoteMarker
