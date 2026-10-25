/** The testIDs of the emoji picker: the contract the e2e drivers and the tests hold against. Values never change meaning; add, never rename. */
export const EmojiPickerIds = {
  root: 'EmojiPicker',
  search: 'EmojiPickerSearch',
  clearSearch: 'EmojiPickerClearSearch',
  recent: 'EmojiPickerRecent',
  noResults: 'EmojiPickerNoResults',
  // The sheet the picker opens in, over the chat.
  sheet: 'EmojiPickerSheet',
  sheetBackdrop: 'EmojiPickerSheetBackdrop',
  sheetClose: 'EmojiPickerSheetClose',
} as const

/**
 * One emoji's button is `EmojiPickerEmoji_` + its code points in upper-case
 * hex joined by `-` (👍 is `EmojiPickerEmoji_1F44D`, ❤️ is
 * `EmojiPickerEmoji_2764-FE0F`), so a driver can tap a specific emoji without
 * typing it. The stem is written literally at the call site so the testID
 * manifest records it.
 */
export const EMOJI_BUTTON_STEM = 'EmojiPickerEmoji_'

export function emojiCodePoints(emoji: string): string {
  return Array.from(emoji)
    .map((ch) => (ch.codePointAt(0) as number).toString(16).toUpperCase())
    .join('-')
}
