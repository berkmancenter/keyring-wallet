/**
 * The labels held to the brief's "Labels" table: one per HCP 4.5 registered category in three languages, `other`
 * for any other category, the two purposes matched on their D44 `<name>` alone, and the list form.
 */
import {
  HCP_CATEGORY_LABELS,
  HCP_PURPOSE_LABELS,
  hcpCategoryLabel,
  hcpListForm,
  hcpPurposeLabel,
  type HcpCategoryLabel,
} from '../labels'

const TABLE: [HcpCategoryLabel, string, string, string][] = [
  ['general_preferences', 'general preferences', 'préférences générales', 'preferências gerais'],
  ['goals_and_constraints', 'goals and limits', 'objectifs et contraintes', 'objetivos e limites'],
  ['health_context', 'health information', 'informations de santé', 'informações de saúde'],
  ['education_learner_profile', 'learning profile', "profil d'apprentissage", 'perfil de aprendizagem'],
  ['work_context', 'work', 'travail', 'trabalho'],
  ['purchase_history_preferences', 'shopping preferences', "préférences d'achat", 'preferências de compras'],
  ['values_and_ethics', 'values', 'valeurs', 'valores'],
  ['location_context', 'location preferences', 'préférences de lieu', 'preferências de localização'],
  ['coordination_context', 'scheduling preferences', "préférences d'agenda", 'preferências de agenda'],
  ['other', 'other information', 'autres informations', 'outras informações'],
]

describe('category labels', () => {
  it('are exactly the brief’s table', () => {
    expect(Object.keys(HCP_CATEGORY_LABELS).sort()).toEqual(TABLE.map(([k]) => k).sort())
  })

  it.each(TABLE)('%s reads "%s" / "%s" / "%s", lower-case', (key, en, fr, ptBr) => {
    expect(HCP_CATEGORY_LABELS[key]).toEqual({ en, fr, ptBr })
    for (const text of [en, fr, ptBr]) expect(text).toBe(text.toLowerCase())
  })

  it('maps each registered category to its own label, and anything else to other', () => {
    for (const [key] of TABLE.filter(([k]) => k !== 'other')) expect(hcpCategoryLabel(key)).toBe(key)
    for (const c of ['other', 'hobbies', 'https://example.org/category/x', '', 'toString', '__proto__'])
      expect(hcpCategoryLabel(c)).toBe('other')
  })

  it('control: a near miss is not registered', () => {
    expect(hcpCategoryLabel('General_preferences')).toBe('other')
  })
})

describe('purpose labels', () => {
  it('match the D44 IRI on its <name> alone, whatever <n> is', () => {
    for (const n of ['1', '2', '17', 'v3'])
      expect(hcpPurposeLabel(`https://registry.trustoverip.org/dtg/purpose/personalisation/${n}`)).toBe(
        'personalisation'
      )
    expect(hcpPurposeLabel('https://registry.trustoverip.org/dtg/purpose/taskExecution/1')).toBe('taskExecution')
  })

  it('give no label for any other IRI, or for none', () => {
    for (const p of [
      'https://registry.trustoverip.org/dtg/purpose/marketing/1',
      'https://registry.trustoverip.org/dtg/purpose/personalisation',
      'https://registry.trustoverip.org/dtg/purpose/personalisation/1/extra',
      'https://example.org/dtg/purpose/personalisation/1',
      'https://hcp.example/purposes/personalization',
      'https://registry.trustoverip.org/dtg/purpose/toString/1',
      null,
      undefined,
    ])
      expect(hcpPurposeLabel(p)).toBeUndefined()
  })

  it('read as the brief says, lower-case, in three languages', () => {
    expect(HCP_PURPOSE_LABELS.personalisation.en).toBe('personalize its answers for you')
    expect(HCP_PURPOSE_LABELS.taskExecution.en).toBe('do the tasks you ask of it')
    for (const label of Object.values(HCP_PURPOSE_LABELS)) {
      expect(new Set([label.en, label.fr, label.ptBr]).size).toBe(3)
      for (const text of [label.en, label.fr, label.ptBr]) expect(text).toBe(text.toLowerCase())
    }
  })
})

describe('hcpListForm', () => {
  it('joins with the language’s "and", with no serial comma', () => {
    expect(hcpListForm([], 'en')).toBe('')
    expect(hcpListForm(['work'], 'en')).toBe('work')
    expect(hcpListForm(['work', 'values'], 'en')).toBe('work and values')
    expect(hcpListForm(['a', 'b', 'c'], 'en')).toBe('a, b and c')
    expect(hcpListForm(['a', 'b', 'c'], 'fr')).toBe('a, b et c')
    expect(hcpListForm(['a', 'b'], 'ptBr')).toBe('a e b')
  })
})
