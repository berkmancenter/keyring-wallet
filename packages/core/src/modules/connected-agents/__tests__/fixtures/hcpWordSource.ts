/**
 * The HCP views' words, as a word source for the screen catalogue (see `./wordSource.ts`): the HCP views draw
 * finished text from `hcp/copy.ts` (through `useHcpCopy`), never a `t()` key, so the catalogue reads a rendered
 * string back to its `Hcp.<key>` id here.
 *
 * Derived, never written out: `wordOf` is built from `HCP_COPY`'s English texts alone, each `{{x}}` a wildcard. A
 * table where two keys' English texts match one another (identical, or one template matching the other's text) fails
 * to build, naming both keys, so the catalogue never resolves to whichever key came first. A rendered string that two
 * templates both match makes `wordOf` throw, naming the string and both keys; it is never read as no word.
 */
import { HCP_COPY } from '../../hcp/copy'

import type { WordSource } from './wordSource'

const PREFIX = 'Hcp.'
const PLACEHOLDER = /\{\{\w+\}\}/g

type Table = Record<string, { en: string }>

/** A whole-string pattern for an English template: its text literally, each `{{x}}` as `.+`. */
const patternOf = (text: string) =>
  new RegExp(
    '^' +
      text
        .split(PLACEHOLDER)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.+') +
      '$'
  )

/** Builds a word source over `table`'s English texts; throws, naming both keys, when two of them match one another. */
export function buildHcpWordSource(table: Table): WordSource {
  const entries = Object.entries(table).map(([key, { en }]) => ({ key, text: en, pattern: patternOf(en) }))
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]
      const b = entries[j]
      if (a.text === b.text || a.pattern.test(b.text) || b.pattern.test(a.text)) {
        throw new Error(`hcpWordSource: ${PREFIX}${a.key} and ${PREFIX}${b.key} have the same English text`)
      }
    }
  }
  return {
    prefix: PREFIX,
    // Three cases. No match: not an HCP word. One match: that key. Two or more: a throw naming the string and the keys,
    // because a string read as no word is invisible to the catalogue, and if the manifest also left it out it would
    // pass unchecked. Two matches can only be two templates (say "Hello {{a}} x" and "Hello y {{b}}" on "Hello y x"):
    // a string matching a key with no placeholders is that key's own text, so a template matching it too is a pair the
    // build above has already refused.
    wordOf: (text) => {
      const matches = entries.filter((e) => e.pattern.test(text))
      if (matches.length > 1) {
        const keys = matches.map((e) => PREFIX + e.key).join(' and ')
        throw new Error(`hcpWordSource: "${text}" matches ${keys}; it is no one word`)
      }
      return matches.length === 1 ? PREFIX + matches[0].key : undefined
    },
    exists: (word) => word.startsWith(PREFIX) && Object.prototype.hasOwnProperty.call(table, word.slice(PREFIX.length)),
  }
}

export const HCP_WORD_SOURCE: WordSource = buildHcpWordSource(HCP_COPY)
