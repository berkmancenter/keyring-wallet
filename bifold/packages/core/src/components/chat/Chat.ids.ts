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
  // A photo in a message bubble; tapping it opens it full screen.
  image: 'ChatMessageImage',
  // The composer's "+", which opens the sheet below.
  actionsButton: 'ChatActionsButton',
  // In the composer's "+" sheet: take a photo, or choose one, to send.
  attachCamera: 'ChatAttachCamera',
  attachLibrary: 'ChatAttachLibrary',
  // The disappearing-messages sheet the chat's menu opens.
  disappearing: 'ChatDisappearingSheet',
  // One choice is `ChatDisappearingOption-<seconds>`, 0 for Off.
  disappearingOption: 'ChatDisappearingOption',
  // A timer the other phone set to a length no choice offers, shown as the current setting.
  disappearingCurrent: 'ChatDisappearingCurrent',
  disappearingSave: 'ChatDisappearingSave',
  disappearingCancel: 'ChatDisappearingCancel',
} as const
