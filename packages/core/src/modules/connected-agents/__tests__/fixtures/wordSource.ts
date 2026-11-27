/**
 * A source of words that do not come through t(), for the screen catalogue (screenCatalogue.test.tsx): views whose
 * words are finished text, as the HCP views draw `hcp/copy.ts` through `hcpText()`. A drawing file
 * (`screenStates*.tsx`) may export `WORD_SOURCES: WordSource[]`; each maps a rendered string to a word id starting with
 * its `prefix` (e.g. "Hcp.ApproveTitle"), and says which ids exist. The catalogue checks those words exactly as it
 * checks t() keys.
 */
export type WordSource = {
  prefix: string
  wordOf: (text: string) => string | undefined
  exists: (word: string) => boolean
}
