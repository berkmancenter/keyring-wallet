import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'
// gesture-handler touchables: RN's own touchables miss taps inside GiftedChat's
// inverted list + GestureHandlerRootView on Android with the new architecture
import { TouchableOpacity } from 'react-native-gesture-handler'

import { testIdWithKey } from '../../utils/testable'
import { ThemedText } from '../texts/ThemedText'
import { ChatIds } from './Chat.ids'

/** The six quick reactions, fully qualified (❤️ carries its variation selector). */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const

export interface ReactionBarProps {
  emojis?: readonly string[]
  /** This phone's current reaction to the message, shown as chosen. */
  selected?: string
  onReact: (emoji: string) => void
  /** Opens the full emoji picker. The "+" is shown only when this is set. */
  onMore?: () => void
}

const ReactionBar: React.FC<ReactionBarProps> = ({ emojis = QUICK_REACTIONS, selected, onReact, onMore }) => {
  const { t } = useTranslation()
  return (
    <View style={styles.bar} testID={testIdWithKey(ChatIds.reactionBar)}>
      {emojis.map((emoji, index) => (
        <TouchableOpacity
          key={emoji}
          onPress={() => onReact(emoji)}
          style={[styles.option, emoji === selected && styles.selected]}
          accessibilityRole="button"
          accessibilityLabel={t('Chat.ReactWith', { emoji })}
          accessibilityState={{ selected: emoji === selected }}
          testID={testIdWithKey(`${ChatIds.reaction}-${index}`)}
        >
          <ThemedText style={styles.emoji}>{emoji}</ThemedText>
        </TouchableOpacity>
      ))}
      {onMore && (
        <TouchableOpacity
          onPress={onMore}
          style={styles.option}
          accessibilityRole="button"
          accessibilityLabel={t('Chat.MoreReactions')}
          testID={testIdWithKey(ChatIds.reactionMore)}
        >
          <ThemedText style={styles.more}>+</ThemedText>
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  option: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  selected: { backgroundColor: '#E8E0EC' },
  emoji: { fontSize: 26, lineHeight: 32 },
  more: { fontSize: 26, lineHeight: 32, color: '#555555' },
})

export default ReactionBar
