/** The testIDs of the chat screen's message actions: the contract the e2e drivers and the tests hold against. Values never change meaning; add, never rename. */
export const ChatIds = {
  // The sheet a long press on a message opens.
  actions: 'ChatMessageActions',
  // Tapping outside the sheet closes it.
  actionsBackdrop: 'ChatMessageActionsBackdrop',
  reactionBar: 'ChatReactionBar',
  // One quick reaction is `ChatReaction-<n>`, n from 0, in the bar's order.
  reaction: 'ChatReaction',
  // The "+" that opens the full emoji picker.
  reactionMore: 'ChatReactionBarMore',
  reply: 'ChatActionReply',
  copy: 'ChatActionCopy',
  deleteForMe: 'ChatActionDeleteForMe',
  // The reactions shown under a message.
  reactions: 'ChatMessageReactions',
  // The emoji button beside the composer.
  composerEmoji: 'ChatComposerEmojiButton',
} as const
