/**
 * Keyring's side of step 7.15 (backlog 3, fb-P1g): the fixed reply of §3.13 ("Answers other people" off), shown by
 * Keyring as a preview in the agent's details from `ConnectedAgents.OthersReply`, and sent by the plugin from its own
 * `src/core/others/messages.json`. Both are checked against one shared vector file, `vectors/others-reply.json`; the
 * plugin's test of its copy is the other side's.
 */
import { readFileSync } from 'fs'
import path from 'path'

import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'
import { SETTLED_ELSEWHERE } from '../proposedCopy'
import vectors from '../vectors/others-reply.json'

const LOCALES = ['en', 'fr', 'pt-br'] as const
type Locale = (typeof LOCALES)[number]

const othersReply = (file: unknown) =>
  (file as { ConnectedAgents: { OthersReply?: string } }).ConnectedAgents.OthersReply
const KEYRING: Record<Locale, string | undefined> = {
  en: othersReply(en),
  fr: othersReply(fr),
  'pt-br': othersReply(ptBr),
}

/** The locales whose text differs from the vector's. */
const drift = (vector: Record<Locale, string>, copy: Record<Locale, string | undefined>) =>
  LOCALES.filter((locale) => copy[locale] !== vector[locale])

const PLAN = readFileSync(path.resolve(__dirname, '../../../../../../docs/plans/agent-connect-plan.md'), 'utf8')
/** §3.13's table row for a locale: `| fr | "…" |`. */
const planRow = (locale: Locale) => {
  const start = PLAN.indexOf('\n### 3.13 ')
  const section = PLAN.slice(start, PLAN.indexOf('\n#', start + 1))
  return section.match(new RegExp(`^\\| ${locale.replace('-', '\\-')} \\| "(.*)" \\|$`, 'm'))?.[1]
}

describe('the others-reply vectors', () => {
  it('carry the three locales Keyring is localized in, and their review status', () => {
    expect(Object.keys(vectors).filter((key) => (LOCALES as readonly string[]).includes(key))).toEqual([...LOCALES])
    expect(vectors.status).toBe('fr and pt-br drafts, not reviewed (D16)')
    for (const locale of LOCALES) expect(vectors[locale]).toMatch(/\S/)
  })

  it("are §3.13's table, word for word", () => {
    for (const locale of LOCALES) expect([locale, vectors[locale]]).toEqual([locale, planRow(locale)])
  })

  it("match Keyring's ConnectedAgents.OthersReply in every locale file", () => {
    expect(drift(vectors, KEYRING)).toEqual([])
  })

  it('is the key the copy rule counts as settled by §3.13', () => {
    expect(SETTLED_ELSEWHERE.OthersReply).toBe('§3.13')
  })

  it('control: one changed French character fails, and names fr alone', () => {
    // control: the same check, with "à" changed to "a" in the French copy only
    const changed = { ...KEYRING, fr: KEYRING.fr?.replace('à', 'a') }
    expect(changed.fr).not.toBe(KEYRING.fr)
    expect(drift(vectors, changed)).toEqual(['fr'])
    // control: the plan reader finds a row, and none for a locale the table lacks
    expect(planRow('en')).toBe(vectors.en)
    expect(planRow('de' as Locale)).toBeUndefined()
  })
})
