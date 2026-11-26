import { EmojiEntry, EmojiSet } from './data'

/** One category of the picker grid, keyed by its Unicode group name. */
export interface PickerGroup {
  group: string
  entries: EmojiEntry[]
}

/**
 * What the picker offers: base emoji only (skin-tone variants stay valid as
 * reactions but are not shown), and nothing newer than `maxVersion`, so the
 * device never offers an emoji it would draw as an empty box.
 */
export function offeredGroups(set: EmojiSet, maxVersion: number): PickerGroup[] {
  return set.groups
    .map((g) => ({ group: g.name, entries: g.entries.filter((e) => !e.skinTone && e.version <= maxVersion) }))
    .filter((g) => g.entries.length > 0)
}

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[\s:,]+/)
    .filter(Boolean)

/**
 * English search over CLDR names and keywords, for the emoji the picker
 * offers. A query matches when every word of it starts a word of the name or
 * a keyword, so "cat" finds 🐱 ("cat face") and 🐈 ("cat"), and "red heart"
 * finds ❤️. Exact word matches come first; set order is kept otherwise.
 */
export function searchEmoji(set: EmojiSet, query: string, maxVersion: number, limit = 120): EmojiEntry[] {
  const terms = words(query)
  if (terms.length === 0) return []
  const exact: EmojiEntry[] = []
  const prefix: EmojiEntry[] = []
  for (const g of set.groups) {
    for (const e of g.entries) {
      if (e.skinTone || e.version > maxVersion) continue
      const vocabulary = [...words(e.name), ...e.keywords.flatMap(words)]
      if (!terms.every((t) => vocabulary.some((w) => w.startsWith(t)))) continue
      if (terms.every((t) => vocabulary.includes(t))) exact.push(e)
      else prefix.push(e)
    }
  }
  return [...exact, ...prefix].slice(0, limit)
}

/** Split a list into rows of `columns`, for a virtualised grid. */
export function toRows<T>(items: T[], columns: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns))
  return rows
}
