/**
 * A source of words that do not come through t(), for the screen catalogue (screenCatalogue.test.tsx): views whose
 * words are finished text, as the HCP views draw `hcp/copy.ts` through `hcpText()`. A drawing file
 * (`screenStates*.tsx`) may export `WORD_SOURCES: WordSource[]`; each maps a rendered string to a word id starting with
 * its `prefix` (e.g. "Hcp.ApproveTitle"), and says which ids exist. The catalogue checks those words exactly as it
 * checks t() keys.
 *
 * The catalogue trusts `wordOf`, so a source must not be able to lie:
 * - its `wordOf` is DERIVED from its copy table (each entry's text in the language drawn, placeholders as wildcards),
 *   never written out by hand, where a mis-paired entry would certify a word the state does not show;
 * - a table with two keys of identical text in that language must make the source FAIL to build, never resolve to
 *   whichever it finds first ("Try again" is the kind of text two keys share), and a test of the source shows it.
 */
export type WordSource = {
  prefix: string
  wordOf: (text: string) => string | undefined
  exists: (word: string) => boolean
}
