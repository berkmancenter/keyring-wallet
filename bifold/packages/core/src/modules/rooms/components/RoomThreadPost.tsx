/**
 * The parts of a room's conversation that name members: a post with its quote and reactions, and the sheet of who
 * reacted. They sit inside the screen's `PetnamesProvider`, where the member's own words for people are known.
 *
 * @module rooms/components/RoomThreadPost
 */
import React from 'react'
import { useTranslation } from 'react-i18next'

import { quotedWords, quoteOf, rewroteFrom, type RoomReactionTally } from '../roomThread'
import type { RoomThreadView } from '../useRoomThread'

import { useMemberWords } from './memberWords'
import { RoomPostBubble } from './RoomPostBubble'
import type { RoomQuoteTarget } from './RoomQuote'
import { RoomReactionsSheet } from './RoomReactionsSheet'

type BubbleProps = React.ComponentProps<typeof RoomPostBubble>

export const RoomThreadPost: React.FC<
  Omit<BubbleProps, 'quote' | 'reactions' | 'rewroteFrom'> & { thread: RoomThreadView }
> = ({ thread, ...bubble }) => {
  const { t } = useTranslation()
  const memberWords = useMemberWords()
  const { post } = bubble
  const of = quoteOf(post, thread.posts, thread.targets, thread.missing, thread)
  let quote: RoomQuoteTarget | undefined
  if (of?.available === false) quote = { available: false }
  else if (of?.available === true) {
    const { target, note, changed } = of
    const author = target.mine ? (t('Rooms.You') as string) : target.author ? memberWords(target.author) : undefined
    quote = { available: true, author, text: quotedWords(target) as typeof target.text, note, changed }
  }
  return (
    <RoomPostBubble
      {...bubble}
      quote={quote}
      reactions={thread.reactions.get(post.key)}
      rewroteFrom={rewroteFrom(post, thread.held.get(post.key))}
    />
  )
}

/** Who reacted to the post whose chips were tapped. */
export const RoomThreadReactions: React.FC<{
  tallies: readonly RoomReactionTally[] | undefined
  onClose: () => void
}> = ({ tallies, onClose }) => {
  const { t } = useTranslation()
  const memberWords = useMemberWords()
  const you = t('Rooms.You') as string
  return (
    <RoomReactionsSheet
      rows={tallies?.map((tally) => ({
        value: tally.shown,
        // The phone's own comes first, as "You".
        names: [...(tally.mine ? [you] : []), ...tally.others.map(memberWords)],
      }))}
      onClose={onClose}
    />
  )
}
