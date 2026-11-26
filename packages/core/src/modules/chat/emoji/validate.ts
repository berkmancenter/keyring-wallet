import { getEmojiSet } from './data'

/**
 * Longest emoji string checked against the set, in UTF-16 code units. The
 * longest fully-qualified emoji (a family with skin tones) is well under it.
 * Matches the chat event parser's cap (plan §5).
 */
export const MAX_EMOJI_LENGTH = 32

/**
 * The fully-qualified form of `input` if it is exactly one emoji of the
 * pinned set, else undefined.
 *
 * Validation is by exact membership because Hermes on React Native 0.81 has
 * no `Intl.Segmenter` and no RegExp `v` flag, and `\p{Extended_Pictographic}`
 * matches single code points without checking sequences. A minimally-qualified
 * or unqualified form (for example "❤" without U+FE0F) becomes its
 * fully-qualified emoji ("❤️"). Anything else, including two emoji in one
 * string, is rejected.
 */
export function normalizeEmoji(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_EMOJI_LENGTH) return undefined
  const set = getEmojiSet()
  if (set.byEmoji.has(input)) return input
  return set.aliases.get(input)
}

/** The CLDR English name of an emoji in any accepted form, for accessibility labels. */
export function emojiName(input: string): string | undefined {
  const emoji = normalizeEmoji(input)
  return emoji ? getEmojiSet().byEmoji.get(emoji)?.name : undefined
}

/** The emoji version a fully-qualified or aliased emoji first appeared in. */
export function emojiVersion(input: string): number | undefined {
  const emoji = normalizeEmoji(input)
  return emoji ? getEmojiSet().byEmoji.get(emoji)?.version : undefined
}
