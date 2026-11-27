/**
 * `copy.ts` held to the brief's "Copy" table: every key present, the three languages non-empty and distinct, the same
 * placeholder names in all three, the brief's English where it fixes it, none of the words plan §6's copy rules
 * forbid, and a refusal that offers no retry.
 */
import { hcpPlaceholders } from '../../copy'
import { WHAT_IT_SAW_COPY, WHAT_IT_SAW_REFUSAL_KEYS, whatItSawText, type WhatItSawCopyKey } from '../copy'

const BRIEF: [WhatItSawCopyKey, string][] = [
  ['WhatItSawTitle', 'What "{{name}}" saw'],
  ['WhatItSawSummary', '{{n}} reads of {{categories}}, last at {{last}}. It can use what it read until {{until}}.'],
  ['WhatItSawRead', 'Read your {{category}} to {{purpose}}, {{time}}'],
  ['WhatItSawConnected', 'Connected, {{time}}'],
  ['WhatItSawRevoked', 'Revoked, {{time}}'],
  ['WhatItSawTold', 'Told it was revoked, {{time}}'],
  ['WhatItSawEmpty', "It hasn't read anything yet."],
  ['WhatItSawUnreachable', "We couldn't reach your VTA, so this list may be out of date."],
  ['WhatItSawRefused', "Your VTA didn't share this list."],
]
/** Beyond the brief's table, each PROPOSED: the singular, no `until`, an unlabelled purpose, and `More` reworded. */
const ADDED: WhatItSawCopyKey[] = [
  'WhatItSawSummaryOne',
  'WhatItSawSummaryNoUntil',
  'WhatItSawSummaryOneNoUntil',
  'WhatItSawReadOther',
  'WhatItSawMore',
]
const KEYS = [...BRIEF.map(([k]) => k), ...ADDED]
const RETRY = /try again|again|retry|réessa|relance|de nouveau|à nouveau|tente de novo|novamente|de novo/i
const FORBIDDEN = /instant|encrypted|private|no trace/i

describe('WHAT_IT_SAW_COPY', () => {
  it('has exactly the brief’s keys and the ones added beyond it', () => {
    expect(Object.keys(WHAT_IT_SAW_COPY).sort()).toEqual([...KEYS].sort())
  })

  it.each(BRIEF)('%s holds the brief’s English', (key, en) => {
    expect(WHAT_IT_SAW_COPY[key].en).toBe(en)
  })

  it.each(KEYS)('%s: three non-empty, distinct strings with the same placeholders, none forbidden', (key) => {
    const { en, fr, ptBr } = WHAT_IT_SAW_COPY[key]
    for (const text of [en, fr, ptBr]) {
      expect(text.trim()).not.toBe('')
      expect(text).not.toMatch(FORBIDDEN)
    }
    expect(new Set([en, fr, ptBr]).size).toBe(3)
    expect(hcpPlaceholders(fr)).toEqual(hcpPlaceholders(en))
    expect(hcpPlaceholders(ptBr)).toEqual(hcpPlaceholders(en))
  })

  it('sources each key as the brief does, and every added one as PROPOSED', () => {
    expect(WHAT_IT_SAW_COPY.WhatItSawRead.source).toBe('plan §6')
    expect(WHAT_IT_SAW_COPY.WhatItSawTitle.source).toBe('companion finding 6')
    expect(WHAT_IT_SAW_COPY.WhatItSawConnected.source).toBe('companion finding 6, the time PROPOSED')
    for (const key of ADDED) expect(WHAT_IT_SAW_COPY[key].source).toBe('PROPOSED')
  })

  it('the refusal is a key of its own, distinct from unreachable, and offers no retry in any language', () => {
    expect([...WHAT_IT_SAW_REFUSAL_KEYS]).toEqual(['WhatItSawRefused'])
    const { en, fr, ptBr, source } = WHAT_IT_SAW_COPY.WhatItSawRefused
    expect(source).toBe('PROPOSED')
    for (const text of [en, fr, ptBr]) expect(text).not.toMatch(RETRY)
    expect(en).not.toBe(WHAT_IT_SAW_COPY.WhatItSawUnreachable.en)
  })

  it('control: the checks bite on a string that breaks them', () => {
    expect('Please try again.').toMatch(RETRY)
    expect(hcpPlaceholders('Ce que « {{nom}} » a vu')).not.toEqual(hcpPlaceholders(WHAT_IT_SAW_COPY.WhatItSawTitle.en))
  })

  it('fills placeholders, and leaves a missing one showing', () => {
    expect(whatItSawText('WhatItSawTitle', 'fr', { name: 'Notes' })).toBe('Ce que « Notes » a vu')
    expect(whatItSawText('WhatItSawConnected', 'en')).toBe('Connected, {{time}}')
  })
})
