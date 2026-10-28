/**
 * One post in a room's conversation, drawn like a chat bubble: the member's own on the right in the brand colour,
 * everyone else's on the left. A post an AI agent wrote is marked as one, in words and with a dashed edge, so it is
 * never taken for a person's. What a post says is inert text: shown as written, links and markup included, and
 * never followed. A post this phone is still sending says so; one it could not send says so, and a tap sends it
 * again.
 *
 * @module rooms/components/RoomPostBubble
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { timeLabel, useDateWords, useUses24HourClock } from '../../../utils/localDay'
import { testIdWithKey } from '../../../utils/testable'
import type { RoomPost } from '../roomPosts'

import { roomHandle } from './RoomRow'
import { identityText } from './roomWords'

export const RoomPostBubble: React.FC<{ post: RoomPost; onRetry?: () => void }> = ({ post, onRetry }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const words = useDateWords()
  const use24h = useUses24HourClock()
  const mine = post.mine
  const ink = mine ? ColorPalette.grayscale.white : ColorPalette.brand.text
  const muted = mine ? ColorPalette.grayscale.white : ColorPalette.grayscale.mediumGrey
  const styles = StyleSheet.create({
    row: { flexDirection: 'row', justifyContent: mine ? 'flex-end' : 'flex-start', marginVertical: 3 },
    bubble: {
      maxWidth: '82%',
      borderRadius: 14,
      paddingHorizontal: 11,
      paddingVertical: 7,
      gap: 2,
      backgroundColor: mine ? ColorPalette.brand.primary : ColorPalette.brand.secondaryBackground,
      // Not in the room yet: drawn lighter until it is.
      opacity: post.delivery ? 0.7 : 1,
      borderWidth: post.byAgent ? 1.5 : 1,
      borderStyle: post.byAgent ? 'dashed' : 'solid',
      borderColor: mine ? ColorPalette.brand.primary : ColorPalette.grayscale.lightGrey,
    },
    meta: { color: muted, fontSize: 12 },
    agent: { fontWeight: '700' },
    text: { color: ink },
    quiet: { color: muted, fontStyle: 'italic' },
  })
  const author = mine ? (t('Rooms.You') as string) : post.author ? identityText(post.author) : undefined
  const time = post.at ? timeLabel(post.at, words, use24h) : undefined
  const bubble = (
    <View style={styles.row} testID={testIdWithKey(`RoomPost_${roomHandle(post.key)}`)}>
      <View style={styles.bubble}>
        {author || post.byAgent ? (
          <ThemedText style={styles.meta}>
            {author}
            {post.byAgent ? (
              <ThemedText style={[styles.meta, styles.agent]} testID={testIdWithKey('RoomPostAgent')}>
                {author ? ' · ' : ''}
                {t('Rooms.AgentBadge')}
              </ThemedText>
            ) : null}
          </ThemedText>
        ) : null}
        {post.retracted ? (
          <ThemedText style={styles.quiet} testID={testIdWithKey('RoomPostRemoved')}>
            {t('Rooms.PostRemoved')}
          </ThemedText>
        ) : post.unread ? (
          <ThemedText style={styles.quiet} testID={testIdWithKey('RoomPostUnread')}>
            {t('Rooms.PostUnread')}
          </ThemedText>
        ) : (
          <>
            {post.title ? <ThemedText style={[styles.text, { fontWeight: '700' }]}>{post.title}</ThemedText> : null}
            {post.text ? (
              <ThemedText style={styles.text} selectable>
                {post.text}
              </ThemedText>
            ) : null}
          </>
        )}
        {post.delivery ? (
          <ThemedText
            style={[styles.meta, { alignSelf: 'flex-end' }]}
            accessibilityLiveRegion="polite"
            testID={testIdWithKey(post.delivery === 'failed' ? 'RoomPostNotSent' : 'RoomPostSending')}
          >
            {t(post.delivery === 'failed' ? 'Rooms.PostNotSent' : 'Rooms.PostSending')}
          </ThemedText>
        ) : time ? (
          <ThemedText style={[styles.meta, { alignSelf: 'flex-end' }]}>{time}</ThemedText>
        ) : null}
      </View>
    </View>
  )
  if (post.delivery !== 'failed' || !onRetry) return bubble
  return (
    <Pressable
      onPress={onRetry}
      accessibilityRole="button"
      accessibilityHint={t('Rooms.PostNotSent')}
      testID={testIdWithKey('RoomPostRetry')}
    >
      {bubble}
    </Pressable>
  )
}

export default RoomPostBubble
