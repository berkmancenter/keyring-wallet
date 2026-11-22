/**
 * Where the "You connected" card sits in a chat: always first, the oldest item, whatever its time.
 *
 * gifted-chat starts a day pill wherever two neighbouring items fall on different days, so the card must not be
 * dated after anything below it. A contact's clock running behind (accepted up to a day, `MAX_EVENT_CLOCK_SKEW_MS`)
 * can date a message before the connection; left at the connection's time, the card would then open its day a
 * second time further down ("Today", then "Yesterday", then "Today" again). The card takes the earlier of the two.
 *
 * @module hooks/connectedCard
 */

type Dated = { createdAt: Date | number }

/** `messages` (newest first, as gifted-chat takes them) with the card last, dated no later than the oldest. */
export function withConnectedCard<T extends Dated>(messages: T[], card: T): T[] {
  const oldest = messages[messages.length - 1]
  if (oldest && new Date(oldest.createdAt).getTime() < new Date(card.createdAt).getTime()) {
    return [...messages, { ...card, createdAt: oldest.createdAt }]
  }
  return [...messages, card]
}
