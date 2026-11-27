/**
 * `copy.ts` held to the brief's part 5: its one key with the brief's English, PROPOSED; the three languages non-empty
 * and distinct, with no placeholder, no retry and none of the words plan §6's copy rules forbid.
 */
import { hcpPlaceholders } from '../../copy'
import { MEMORIES_COPY, memoriesText } from '../copy'

const RETRY = /try again|again|retry|réessa|relance|de nouveau|à nouveau|tente de novo|novamente|de novo/i
const FORBIDDEN = /instant|encrypted|private|no trace/i

describe('MEMORIES_COPY', () => {
  it('has exactly the one key the brief names, with its English, PROPOSED', () => {
    expect(Object.keys(MEMORIES_COPY)).toEqual(['MemoriesNeedVtaUpdate'])
    expect(MEMORIES_COPY.MemoriesNeedVtaUpdate.en).toBe("Your VTA can't change memories for this agent yet.")
    expect(MEMORIES_COPY.MemoriesNeedVtaUpdate.source).toBe('PROPOSED')
  })

  it('three non-empty, distinct strings with no placeholder, no retry and nothing forbidden', () => {
    const { en, fr, ptBr } = MEMORIES_COPY.MemoriesNeedVtaUpdate
    for (const text of [en, fr, ptBr]) {
      expect(text.trim()).not.toBe('')
      expect(text).not.toMatch(RETRY)
      expect(text).not.toMatch(FORBIDDEN)
      expect(hcpPlaceholders(text)).toEqual([])
    }
    expect(new Set([en, fr, ptBr]).size).toBe(3)
  })

  it('memoriesText gives the string in each language', () => {
    expect(memoriesText('MemoriesNeedVtaUpdate', 'fr')).toBe(MEMORIES_COPY.MemoriesNeedVtaUpdate.fr)
    expect(memoriesText('MemoriesNeedVtaUpdate', 'ptBr')).toBe(MEMORIES_COPY.MemoriesNeedVtaUpdate.ptBr)
  })

  // control: the retry, forbidden-word and placeholder checks each match a string that breaks them.
  it('control: the checks bite on a string that breaks them', () => {
    expect("Your VTA can't change memories yet. Try again later.").toMatch(RETRY)
    expect('Gone in an instant').toMatch(FORBIDDEN)
    expect(hcpPlaceholders('{{name}}')).not.toEqual([])
  })
})
