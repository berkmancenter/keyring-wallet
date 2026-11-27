/**
 * The HCP views' words, as a word source for the screen catalogue (see `./wordSource.ts`): the HCP views draw
 * finished text from `hcp/copy.ts` (through `useHcpCopy`), never a `t()` key, so the catalogue reads a rendered
 * string back to its `Hcp.<key>` id here.
 *
 * Derived, never written out: `wordOf` is built from `HCP_COPY`'s English texts alone, each `{{x}}` a wildcard. A
 * table where two keys' English texts match one another (identical, or one template matching the other's text) fails
 * to build, naming both keys, so the catalogue never resolves to whichever key came first.
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
  const entries = Object.entries(table).map(([key, { en }]) => ({
    key,
    text: en,
    pattern: patternOf(en),
    plain: en.match(PLACEHOLDER) === null,
  }))
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
    wordOf: (text) => {
      const matches = entries.filter((e) => e.pattern.test(text))
      // If two keys match, the one with no placeholders; two templates that both match one text are not certified.
      const plain = matches.find((e) => e.plain)
      if (plain) return PREFIX + plain.key
      return matches.length === 1 ? PREFIX + matches[0].key : undefined
    },
    exists: (word) => word.startsWith(PREFIX) && Object.prototype.hasOwnProperty.call(table, word.slice(PREFIX.length)),
  }
}

export const HCP_WORD_SOURCE: WordSource = buildHcpWordSource(HCP_COPY)
