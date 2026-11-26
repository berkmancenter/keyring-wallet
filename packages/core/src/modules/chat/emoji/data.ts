/**
 * The pinned emoji set, generated from Unicode's emoji-test.txt and CLDR's
 * English annotations by scripts/emoji/generate-emoji-data.mjs. The JSON is
 * about 380 KB (64 KB gzipped). Metro puts it in the JS bundle regardless,
 * so it adds that much to the bundle and to every OTA update; what is
 * deferred to first use (opening the picker, or checking a received reaction)
 * is its parse, not its download.
 */

/** A base emoji: shown in the picker and searchable. */
export type BaseEntryTuple = [emoji: string, name: string, keywords: string[], version: number]
/** A skin-tone variant: a valid reaction, but not shown in the grid or searched. */
export type ToneEntryTuple = [emoji: string, name: string, keywords: 0, version: number, tone: 1]

export interface EmojiDataFile {
  unicode: string
  cldr: string
  sources: Record<string, string>
  count: number
  groups: { name: string; entries: (BaseEntryTuple | ToneEntryTuple)[] }[]
  aliases: Record<string, string>
}

export interface EmojiEntry {
  emoji: string
  name: string
  keywords: string[]
  /** The emoji version it first appeared in (the `E` field of emoji-test.txt). */
  version: number
  /** True for a skin-tone variant of a base emoji. */
  skinTone: boolean
  group: string
}

export interface EmojiSet {
  unicode: string
  groups: { name: string; entries: EmojiEntry[] }[]
  /** Every fully-qualified emoji, by its exact string. */
  byEmoji: ReadonlyMap<string, EmojiEntry>
  /**
   * Minimally-qualified and unqualified forms, to their fully-qualified emoji.
   * A Map, not the parsed JSON object: indexing a plain object also finds
   * inherited keys, so "toString" or "__proto__" would come back as a match.
   */
  aliases: ReadonlyMap<string, string>
}

let cached: EmojiSet | undefined

export function toEmojiSet(file: EmojiDataFile): EmojiSet {
  const byEmoji = new Map<string, EmojiEntry>()
  const groups = file.groups.map((g) => ({
    name: g.name,
    entries: g.entries.map((t) => {
      const entry: EmojiEntry = {
        emoji: t[0],
        name: t[1],
        keywords: t[2] === 0 ? [] : t[2],
        version: t[3],
        skinTone: t[4] === 1,
        group: g.name,
      }
      byEmoji.set(entry.emoji, entry)
      return entry
    }),
  }))
  return { unicode: file.unicode, groups, byEmoji, aliases: new Map(Object.entries(file.aliases)) }
}

/**
 * The emoji set, parsed once and kept. A `require` rather than a static
 * import, so the JSON is evaluated on first use instead of when the chat
 * module loads (it is in the bundle either way); a dynamic import() would
 * make Metro split the bundle.
 */
export function getEmojiSet(): EmojiSet {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (!cached) cached = toEmojiSet(require('./emoji-data.json') as EmojiDataFile)
  return cached
}
