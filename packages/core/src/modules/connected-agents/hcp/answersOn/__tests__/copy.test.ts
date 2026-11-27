/**
 * `copy.ts` held to the brief's "Copy" table for C5: every key present (and the two buttons added beyond it), the
 * plan §6 English verbatim, the three languages non-empty and distinct with the same placeholders, the refusal
 * offering no retry, and none of the words plan §6's copy rules forbid.
 */
import { hcpPlaceholders } from '../../copy'
import { ANSWERS_COPY, ANSWERS_REFUSAL_KEYS, type AnswersCopyKey, answersText } from '../copy'

/** The brief's table, with its English and source. */
const TABLE: [AnswersCopyKey, string, 'plan §6' | 'PROPOSED'][] = [
  ['AnswersRow', 'Answers other people', 'plan §6'],
  ['AnswersValueOff', 'Off', 'plan §6'],
  ['AnswersValueOn', 'On', 'plan §6'],
  [
    'AnswersHelpOff',
    "Anyone but you who mentions {{name}} gets a fixed reply that it can't respond to others.",
    'plan §6',
  ],
  ['AnswersHelpOn', '{{name}} also acts on mentions from other people in rooms you added it to.', 'plan §6'],
  ['AnswersOnTitle', 'Let "{{name}}" answer other people?', 'plan §6'],
  [
    'AnswersOnBody',
    'Anyone in a room can then ask it to do things by mentioning it. It could be tricked into using your memory or posting for you, and your phone cannot prevent that.',
    'plan §6',
  ],
  ['AnswersOnConfirm', 'Turn on', 'plan §6'],
  ['AnswersOnKeep', 'Keep it off', 'plan §6'],
  [
    'AnswersOffConfirm',
    'Turn off answers for "{{name}}"? You can\'t turn them back on for this connection yet.',
    'PROPOSED',
  ],
  ['AnswersLocked', 'Off for this connection. Connect it again to change this.', 'PROPOSED'],
  ['AnswersOnDirectiveText', "You may answer other people in rooms you've been added to.", 'PROPOSED'],
  ['AnswersOffDirectiveText', "Don't answer other people.", 'PROPOSED'],
  ['AnswersRefused', "Your VTA didn't accept this change.", 'PROPOSED'],
  ['AnswersUnreachable', "We couldn't reach your VTA, so nothing changed.", 'PROPOSED'],
]
/** Added beyond the table: the turn-off confirmation's two buttons, which the table does not name. */
const ADDED: AnswersCopyKey[] = ['AnswersOffTurnOff', 'AnswersOffKeep']
const KEYS = [...TABLE.map(([key]) => key), ...ADDED]

const RETRY = /try again|again|retry|réessa|relance|de nouveau|à nouveau|tente de novo|novamente|de novo/i
const FORBIDDEN = /instant|encrypted|private|no trace/i

describe('ANSWERS_COPY', () => {
  it('has exactly the keys of the brief’s table and the two added buttons', () => {
    expect(Object.keys(ANSWERS_COPY).sort()).toEqual([...KEYS].sort())
  })

  it.each(TABLE)('%s: the brief’s English and source', (key, en, source) => {
    expect(ANSWERS_COPY[key].en).toBe(en)
    expect(ANSWERS_COPY[key].source).toBe(source)
  })

  it.each(ADDED)('%s: PROPOSED', (key) => {
    expect(ANSWERS_COPY[key].source).toBe('PROPOSED')
  })

  it.each(KEYS)('%s: three non-empty, distinct strings with the same placeholders, none forbidden', (key) => {
    const { en, fr, ptBr } = ANSWERS_COPY[key]
    for (const text of [en, fr, ptBr]) {
      expect(text.trim()).not.toBe('')
      expect(text).not.toMatch(FORBIDDEN)
    }
    expect(new Set([en, fr, ptBr]).size).toBe(3)
    expect(hcpPlaceholders(fr)).toEqual(hcpPlaceholders(en))
    expect(hcpPlaceholders(ptBr)).toEqual(hcpPlaceholders(en))
  })

  it.each(ANSWERS_REFUSAL_KEYS)('%s: a refusal never offers another attempt, in any language', (key) => {
    const { en, fr, ptBr } = ANSWERS_COPY[key]
    for (const text of [en, fr, ptBr]) expect(text).not.toMatch(RETRY)
  })

  it('the refusal is a key of its own, distinct from unreachable', () => {
    expect(ANSWERS_REFUSAL_KEYS).not.toContain('AnswersUnreachable')
    expect(ANSWERS_COPY.AnswersRefused.en).not.toBe(ANSWERS_COPY.AnswersUnreachable.en)
  })

  it('answersText fills the name, and leaves a missing one showing', () => {
    expect(answersText('AnswersOnTitle', 'en', { name: 'Notes' })).toBe('Let "Notes" answer other people?')
    expect(answersText('AnswersOnTitle', 'fr', { name: 'Notes' })).toBe(
      'Laisser « Notes » répondre aux autres personnes ?'
    )
    expect(answersText('AnswersOnTitle', 'en')).toBe('Let "{{name}}" answer other people?')
  })

  it('control: the checks bite on a string that breaks them', () => {
    expect("Your VTA didn't accept this change. Try again.").toMatch(RETRY)
    expect('Réessayez plus tard.').toMatch(RETRY)
    expect('Gone in an instant').toMatch(FORBIDDEN)
    expect(hcpPlaceholders('{{name}} and {{time}}')).not.toEqual(hcpPlaceholders('{{name}}'))
  })
})
