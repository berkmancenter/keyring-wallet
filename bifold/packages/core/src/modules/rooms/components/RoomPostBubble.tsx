/**
 * One post in a room's conversation, drawn like a chat bubble: the member's own on the right in the brand colour,
 * everyone else's on the left. A post an AI agent wrote is marked as one, in words and with a dashed edge, so it is
 * never taken for a person's. What a post says is inert text: shown as written, links and markup included, and
 * never followed. A post this phone is still sending says so; one it could not send says so, and a tap sends it
 * again. A post's files show as chips under its words; a tap opens the attachment sheet.
 *
 * @module rooms/components/RoomPostBubble
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ReactionChips, reactionChipsLabel } from '../../../components/chat/ReactionChips'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { dayLabel, timeLabel, useDateWords, useUses24HourClock } from '../../../utils/localDay'
import { testIdWithKey } from '../../../utils/testable'
import { postRefusalText } from '../postRefusal'
import { isWithdrawn, type RoomPost } from '../roomPosts'
import { arrivedLate, type RoomReactionTally } from '../roomThread'
import type { Identity, RoomFile } from '../types'

import { RoomFileChip } from './RoomFileChip'
import { RoomQuote, type RoomQuoteTarget } from './RoomQuote'
import { roomHandle } from './RoomRow'
import { useMemberWords } from './memberWords'

export const RoomPostBubble: React.FC<{
  post: RoomPost
  onRetry?: () => void
  /** Stops a post's upload while it is sending. */
  onCancel?: () => void
  onOpenFile?: (file: RoomFile) => void
  /** Opens another member's sheet from their name. */
  onOpenAuthor?: (author: Identity) => void
  /** What this post answers, when it's a reply. */
  quote?: RoomQuoteTarget
  /** The reactions beside it. */
  reactions?: readonly RoomReactionTally[]
  /** Opens who reacted, from its chips. */
  onOpenReactions?: () => void
  /** Who wrote this record first, when this version came from someone else. */
  rewroteFrom?: Identity
  /** The long-press sheet. Only for a post with words to act on. */
  onLongPress?: () => void
}> = ({
  post,
  onRetry,
  onCancel,
  onOpenFile,
  onOpenAuthor,
  quote,
  reactions,
  onOpenReactions,
  rewroteFrom,
  onLongPress,
}) => {
  const { t } = useTranslation()
  const memberWords = useMemberWords()
  const { ColorPalette } = useTheme()
  const words = useDateWords()
  const use24h = useUses24HourClock()
  const mine = post.mine
  const ink = mine ? ColorPalette.grayscale.white : ColorPalette.brand.text
  const muted = mine ? ColorPalette.grayscale.white : ColorPalette.grayscale.mediumGrey
  const styles = StyleSheet.create({
    row: { flexDirection: 'row', justifyContent: mine ? 'flex-end' : 'flex-start', marginVertical: 3 },
    column: { maxWidth: '82%', alignItems: mine ? 'flex-end' : 'flex-start' },
    bubble: {
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
    // Another member's name in the brand's colour, as mocked (header B); the member's own "You" stays quiet.
    author: mine
      ? { color: ColorPalette.grayscale.white, fontSize: 13, opacity: 0.85 }
      : { color: ColorPalette.brand.primary, fontSize: 13, fontWeight: '600' },
    agent: { fontWeight: '700' },
    text: { color: ink },
    quiet: { color: muted, fontStyle: 'italic' },
    line: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 2 },
    lineText: { flexShrink: 1, color: muted, fontSize: 13, lineHeight: 18 },
  })
  const by = post.author
  const author = mine ? (t('Rooms.You') as string) : by ? memberWords(by) : undefined
  const openAuthor = !mine && by && onOpenAuthor ? () => onOpenAuthor(by) : undefined
  const time = post.at ? timeLabel(post.at, words, use24h) : undefined
  const withdrawn = isWithdrawn(post) && !rewroteFrom
  // A rewrite by someone else is said as one, never as this author's edit.
  const stamp = post.editedAt && !rewroteFrom && time ? `${t('Rooms.PostEdited')} · ${time}` : time
  const claimed = arrivedLate(post)
  const lateWhen = claimed ? `${dayLabel(claimed, words)}, ${timeLabel(claimed, words, use24h)}` : undefined
  const chips = (reactions ?? []).map((tally) => ({
    value: tally.shown,
    count: tally.count,
    mine: tally.mine,
  }))
  const meta = (
    <ThemedText style={styles.author}>
      {author}
      {post.byAgent ? (
        <ThemedText style={[styles.meta, styles.agent]} testID={testIdWithKey('RoomPostAgent')}>
          {author ? ' · ' : ''}
          {t('Rooms.AgentBadge')}
        </ThemedText>
      ) : null}
    </ThemedText>
  )
  // A failed post's file went with its upload, so that post is cleared and the file added again, not sent again.
  // One refused for good says why, and is not offered again.
  const notSent = post.refused
    ? postRefusalText(t, post.refused)
    : t(post.files.length > 0 ? 'Rooms.PostFileNotSent' : 'Rooms.PostNotSent')
  const bubble = (
    <View style={styles.row} testID={testIdWithKey(`RoomPost_${roomHandle(post.key)}`)}>
      <View style={styles.column}>
        <Pressable
          style={styles.bubble}
          onLongPress={onLongPress}
          disabled={!onLongPress}
          // Not one element to a screen reader: the author's name and a file's chip inside it stay reachable.
          accessible={false}
          testID={testIdWithKey('RoomPostBubble')}
        >
          {author || post.byAgent ? (
            openAuthor ? (
              <Pressable
                onPress={openAuthor}
                hitSlop={12}
                accessibilityRole="button"
                testID={testIdWithKey('RoomPostAuthor')}
              >
                {meta}
              </Pressable>
            ) : (
              meta
            )
          ) : null}
          {rewroteFrom ? (
            <View style={styles.line} testID={testIdWithKey('RoomPostRewrote')}>
              <Icon name="alert-circle-outline" size={14} color={muted} style={{ marginTop: 2 }} />
              <ThemedText style={styles.lineText}>
                {t('Rooms.PostRewrote', { name: memberWords(rewroteFrom), interpolation: { escapeValue: false } })}
              </ThemedText>
            </View>
          ) : null}
          {quote ? <RoomQuote target={quote} mine={mine} /> : null}
          {post.retracted ? (
            <ThemedText style={styles.quiet} testID={testIdWithKey('RoomPostRemoved')}>
              {t('Rooms.PostRemoved')}
            </ThemedText>
          ) : withdrawn ? (
            <ThemedText style={styles.quiet} testID={testIdWithKey('RoomPostWithdrawn')}>
              {t(mine ? 'Rooms.PostWithdrawnMine' : 'Rooms.PostWithdrawn')}
            </ThemedText>
          ) : post.unread ? (
            <ThemedText style={styles.quiet} testID={testIdWithKey('RoomPostUnread')}>
              {t('Rooms.PostUnread')}
            </ThemedText>
          ) : (
            <>
              {post.title ? <ThemedText style={[styles.text, { fontWeight: '700' }]}>{post.title}</ThemedText> : null}
              {post.text ? <ThemedText style={styles.text}>{post.text}</ThemedText> : null}
              {post.files.map((file) => (
                <RoomFileChip
                  key={file.fileId}
                  file={file}
                  ink={ink}
                  edge={mine ? ColorPalette.grayscale.white : ColorPalette.grayscale.lightGrey}
                  // A file still on its way up has nothing to open yet.
                  onPress={post.delivery ? undefined : onOpenFile}
                />
              ))}
            </>
          )}
          {lateWhen ? (
            <View style={styles.line} testID={testIdWithKey('RoomPostLate')}>
              <Icon name="clock-outline" size={14} color={muted} style={{ marginTop: 2 }} />
              <ThemedText style={styles.lineText}>
                {t('Rooms.PostArrivedLate', { when: lateWhen, interpolation: { escapeValue: false } })}
              </ThemedText>
            </View>
          ) : null}
          {post.delivery ? (
            <ThemedText
              style={[styles.meta, { alignSelf: 'flex-end' }]}
              accessibilityLiveRegion="polite"
              testID={testIdWithKey(post.delivery === 'failed' ? 'RoomPostNotSent' : 'RoomPostSending')}
            >
              {post.delivery === 'failed'
                ? notSent
                : post.progress !== undefined
                  ? t('Rooms.PostSendingPercent', { percent: Math.round(post.progress * 100) })
                  : t('Rooms.PostSending')}
            </ThemedText>
          ) : null}
          {post.delivery === 'sending' && onCancel ? (
            <Pressable
              onPress={onCancel}
              hitSlop={8}
              style={{ alignSelf: 'flex-end' }}
              accessibilityRole="button"
              testID={testIdWithKey('RoomPostCancel')}
            >
              <ThemedText style={[styles.meta, { textDecorationLine: 'underline' }]}>{t('Global.Cancel')}</ThemedText>
            </Pressable>
          ) : stamp ? (
            <ThemedText style={[styles.meta, { alignSelf: 'flex-end' }]} testID={testIdWithKey('RoomPostTime')}>
              {stamp}
            </ThemedText>
          ) : null}
        </Pressable>
        {chips.length > 0 ? (
          <ReactionChips
            chips={chips}
            isMe={mine}
            label={reactionChipsLabel(t, chips)}
            onPress={onOpenReactions}
            testID={testIdWithKey('RoomPostReactions')}
          />
        ) : null}
      </View>
    </View>
  )
  if (post.delivery !== 'failed' || !onRetry || post.refused) return bubble
  return (
    <Pressable
      onPress={onRetry}
      accessibilityRole="button"
      accessibilityHint={notSent}
      testID={testIdWithKey('RoomPostRetry')}
    >
      {bubble}
    </Pressable>
  )
}

export default RoomPostBubble
