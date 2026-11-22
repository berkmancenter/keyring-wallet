/**
 * The reactions under a message, one chip per value: its value, a count when more than one person chose it, and the
 * phone's own marked. One-to-one chat and a room's conversation both draw these, so the two look the same. A value may
 * be a few words from another app in a room: it stays on one line, cut short, and is plain text, never a link.
 *
 * @module components/chat/ReactionChips
 */
import type { TFunction } from 'i18next'
import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

export interface ReactionChip {
  value: string
  count: number
  mine: boolean
}

/** How wide one chip may get. A longer value is cut short; a room's sheet shows it whole. */
export const CHIP_MAX_WIDTH = 220

/** A chip is shorter than a finger, so a tap on the row gets room around it. */
const ROW_HIT_SLOP = 10

/** What a screen reader says for a row of chips. A value may be someone's words, so it isn't escaped for markup. */
export const reactionChipsLabel = (t: TFunction, chips: readonly ReactionChip[]): string =>
  chips
    .map(({ value, count, mine }) =>
      t(mine ? 'Chat.ReactionYou' : 'Chat.ReactionThem', {
        emoji: value,
        count,
        interpolation: { escapeValue: false },
      })
    )
    .join(', ')

export interface ReactionChipsProps {
  chips: readonly ReactionChip[]
  /** Under the phone's own message: the chips sit on the right. */
  isMe: boolean
  /** What a screen reader says for the whole row. */
  label: string
  /** Opens the list of who reacted. Without it the row is only read. */
  onPress?: () => void
  testID?: string
}

export const ReactionChips: React.FC<ReactionChipsProps> = ({ chips, isMe, label, onPress, testID }) => {
  const row = { justifyContent: isMe ? 'flex-end' : 'flex-start' } as const
  const body = chips.map(({ value, count, mine }) => (
    <View key={value} style={[styles.chip, mine && styles.chipMine]}>
      <Text style={styles.value} numberOfLines={1}>
        {value}
      </Text>
      {count > 1 && <Text style={styles.count}>{count}</Text>}
    </View>
  ))
  if (onPress)
    return (
      <Pressable
        style={[styles.row, row]}
        onPress={onPress}
        hitSlop={ROW_HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={testID}
      >
        {body}
      </Pressable>
    )
  return (
    <View style={[styles.row, row]} accessible accessibilityLabel={label} testID={testID}>
      {body}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: -6, gap: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: CHIP_MAX_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(170, 170, 170, 0.4)',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  chipMine: { backgroundColor: '#E8E0EC' },
  value: { fontSize: 14, flexShrink: 1 },
  count: { fontSize: 12, color: '#555555', marginLeft: 2 },
})

export default ReactionChips
