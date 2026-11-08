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
  // A room's own message: new words, or an empty version in its place.
  edit: 'ChatActionEdit',
  withdraw: 'ChatActionWithdraw',
  // A line in the sheet saying why it offers less, above its entries.
  actionsNotice: 'ChatMessageActionsNotice',
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
  // The composer's field (the pill), and the button on its right: Camera while it is empty, Send once it holds text.
  // Send has no id of ours: its handle is gifted-chat's GC_SEND_TOUCHABLE on the touchable (MessageInput renderSend).
  composerField: 'ChatComposerField',
  composerCamera: 'ChatComposerCamera',
  // A day's marker ("Today", "Wed 15 Oct"): above its first message, and floating at the top while scrolling.
  dayPill: 'ChatDayPill',
  // A photo on its way: shown from the moment it is picked until it is sent, or until a failed one is deleted.
  pendingPhoto: 'ChatPendingPhoto',
  pendingPhotoStatus: 'ChatPendingPhotoStatus',
  // Stops a photo while it is made ready; there is none once it is being sent.
  pendingPhotoStop: 'ChatPendingPhotoStop',
  // A photo that wasn't sent: tapping it opens the sheet below.
  pendingPhotoFailed: 'ChatPendingPhotoFailed',
  pendingPhotoSheet: 'ChatPendingPhotoSheet',
  // The sheet's words and buttons scroll, the buttons last.
  pendingPhotoSheetScroll: 'ChatPendingPhotoSheetScroll',
  pendingPhotoRetry: 'ChatPendingPhotoRetry',
  pendingPhotoDelete: 'ChatPendingPhotoDelete',
  pendingPhotoNotNow: 'ChatPendingPhotoNotNow',
  // Tapping outside that sheet closes it, as Not now.
  pendingPhotoBackdrop: 'ChatPendingPhotoBackdrop',
  // "✓ Sent" beside the time of a photo this phone sent.
  photoSent: 'ChatPhotoSent',
} as const
