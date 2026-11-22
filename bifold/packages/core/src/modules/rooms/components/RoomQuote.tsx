/**
 * What a reply in a room answers, above the reply's words: drawn to the measures of the quote in one-to-one chat
 * (gifted-chat's MessageReply), which a room's list can't use because it draws its own bubbles. A target that can't be
 * shown says so in the name's place, as chat does, and nothing of it is shown. As in chat, a tap does nothing.
 *
 * @module rooms/components/RoomQuote
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import type { InertText } from '../inertText'

export type RoomQuoteTarget =
  | {
      available: true
      /** Who wrote it, in the words the room uses for them. None on a room that shows no authors. */
      author?: string
      text: InertText
      /** The target is a note, so it's called one rather than named. */
      note?: boolean
      /** The target was edited after this reply was written. */
      changed?: boolean
    }
  | { available: false }

export const RoomQuote: React.FC<{ target: RoomQuoteTarget; mine: boolean }> = ({ target, mine }) => {
  const { t } = useTranslation()
  const name = !target.available
    ? (t('Rooms.QuoteUnavailable') as string)
    : target.note
      ? (t('Rooms.QuoteNote') as string)
      : (target.author ?? (t('Rooms.QuoteNoAuthor') as string))
  return (
    <View style={[styles.box, mine ? styles.boxMine : styles.boxTheirs]} testID={testIdWithKey('RoomQuote')}>
      <ThemedText
        style={[styles.name, mine ? styles.inkMine : styles.nameTheirs]}
        numberOfLines={1}
        testID={testIdWithKey('RoomQuoteName')}
      >
        {name}
      </ThemedText>
      {target.available && target.text ? (
        <ThemedText
          style={[styles.text, mine ? styles.inkMine : styles.textTheirs]}
          numberOfLines={2}
          testID={testIdWithKey('RoomQuoteText')}
        >
          {target.text}
        </ThemedText>
      ) : null}
      {target.available && target.changed ? (
        <ThemedText
          style={[styles.changed, mine ? styles.inkMine : styles.textTheirs]}
          testID={testIdWithKey('RoomQuoteChanged')}
        >
          {t(mine ? 'Rooms.QuoteChangedMine' : 'Rooms.QuoteChanged')}
        </ThemedText>
      ) : null}
    </View>
  )
}

// gifted-chat's MessageReply, whose name has no size of its own and so draws at 14.
const styles = StyleSheet.create({
  box: { borderRadius: 8, marginBottom: 4, paddingHorizontal: 10, paddingVertical: 6, borderLeftWidth: 3 },
  boxTheirs: { backgroundColor: 'rgba(0, 0, 0, 0.06)', borderLeftColor: '#0084ff' },
  boxMine: { backgroundColor: 'rgba(255, 255, 255, 0.15)', borderLeftColor: 'rgba(255, 255, 255, 0.6)' },
  name: { fontSize: 14, lineHeight: 18, fontWeight: '600', marginBottom: 2 },
  nameTheirs: { color: '#0084ff' },
  text: { fontSize: 13, lineHeight: 17 },
  textTheirs: { color: '#333333' },
  inkMine: { color: 'rgba(255, 255, 255, 0.9)' },
  changed: { fontSize: 12, lineHeight: 16, marginTop: 2, fontStyle: 'italic' },
})

export default RoomQuote
