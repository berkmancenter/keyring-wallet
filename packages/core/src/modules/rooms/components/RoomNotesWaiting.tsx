/**
 * Under an empty room's "No messages yet.", the notes the room does hold, and the way to them. Every other client
 * writes a room's records as notes (the community's web page, the browser wallet), and Keyring keeps them off the
 * chat, on the room's Notes: a note written from the web page read as a room with nothing in it (IN-434, 11-03).
 *
 * @module rooms/components/RoomNotesWaiting
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { InertText } from '../inertText'

export interface RoomNotesWaitingProps {
  count: number
  /** The newest note's title, shown as written. */
  newest?: InertText
  onOpen: () => void
}

export const RoomNotesWaiting: React.FC<RoomNotesWaitingProps> = ({ count, newest, onOpen }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const styles = StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 64,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    words: { flex: 1, minWidth: 0, gap: 2 },
    newest: { color: ColorPalette.grayscale.mediumGrey },
    open: { color: ColorPalette.brand.primary },
  })
  const counted = t('Rooms.NotesWaiting', { count }) as string
  return (
    <Pressable
      style={styles.card}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={[counted, newest].filter(Boolean).join(', ')}
      accessibilityHint={t('Rooms.NotesWaitingOpen') as string}
      testID={testIdWithKey('RoomNotesWaiting')}
    >
      <Icon name="note-text-outline" size={24} color={ColorPalette.brand.primary} />
      {/* "See notes" under the words, not beside them: beside, at the largest text it left the words a third of the
          row, and the note's title read "Hell…" (render, 11-03). */}
      <View style={styles.words}>
        <ThemedText variant="bold">{counted}</ThemedText>
        {newest ? (
          <ThemedText style={styles.newest} numberOfLines={2} testID={testIdWithKey('RoomNotesWaitingNewest')}>
            {newest}
          </ThemedText>
        ) : null}
        <ThemedText variant="bold" style={styles.open}>
          {t('Rooms.NotesWaitingOpen')}
        </ThemedText>
      </View>
      <Icon name="chevron-right" size={22} color={ColorPalette.brand.primary} />
    </Pressable>
  )
}

export default RoomNotesWaiting
