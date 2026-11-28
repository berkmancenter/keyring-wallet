/**
 * The plain-language labels "What my agent saw" (C4) shows in place of HCP's category names and purpose IRIs. Every
 * label is PROPOSED (backlog brief, section B part 3, "Labels"), the English purposes lower-cased from plan §6, and
 * every French and Portuguese label needs a native reader's approval before it moves into the localization files.
 *
 * View models carry the label keys below, never the text, and never a raw category name or purpose IRI.
 *
 * @module connected-agents/hcp/whatItSaw/labels
 */
import type { HcpCopyLanguage } from '../copy'

type Label = Record<HcpCopyLanguage, string>

/** One label per HCP 4.5 registered category, used lower-case after "your". */
export const HCP_CATEGORY_LABELS = {
  general_preferences: { en: 'general preferences', fr: 'préférences générales', ptBr: 'preferências gerais' },
  goals_and_constraints: { en: 'goals and limits', fr: 'objectifs et contraintes', ptBr: 'objetivos e limites' },
  health_context: { en: 'health information', fr: 'informations de santé', ptBr: 'informações de saúde' },
  education_learner_profile: {
    en: 'learning profile',
    fr: "profil d'apprentissage",
    ptBr: 'perfil de aprendizagem',
  },
  work_context: { en: 'work', fr: 'travail', ptBr: 'trabalho' },
  purchase_history_preferences: {
    en: 'shopping preferences',
    fr: "préférences d'achat",
    ptBr: 'preferências de compras',
  },
  values_and_ethics: { en: 'values', fr: 'valeurs', ptBr: 'valores' },
  location_context: { en: 'location preferences', fr: 'préférences de lieu', ptBr: 'preferências de localização' },
  coordination_context: { en: 'scheduling preferences', fr: "préférences d'agenda", ptBr: 'preferências de agenda' },
  /** Any category HCP 4.5 does not register. */
  other: { en: 'other information', fr: 'autres informations', ptBr: 'outras informações' },
} as const satisfies Record<string, Label>

export type HcpCategoryLabel = keyof typeof HCP_CATEGORY_LABELS

/**
 * The two purposes plan §6 names, by the `<name>` of their D44 IRI. A purpose that is neither, or none, has no label
 * of its own: its row uses the copy key `WhatItSawReadOther` ("…for another purpose") instead.
 */
export const HCP_PURPOSE_LABELS = {
  personalisation: {
    en: 'personalize its answers for you',
    fr: 'personnaliser ses réponses pour vous',
    ptBr: 'personalizar as respostas para você',
  },
  taskExecution: {
    en: 'do the tasks you ask of it',
    fr: 'effectuer les tâches que vous lui demandez',
    ptBr: 'fazer as tarefas que você pede',
  },
} as const satisfies Record<string, Label>

export type HcpPurposeLabel = keyof typeof HCP_PURPOSE_LABELS

const REGISTERED = new Set<string>(Object.keys(HCP_CATEGORY_LABELS).filter((k) => k !== 'other'))

/** The label of an HCP category: its own when HCP 4.5 registers it, else `other`. */
export function hcpCategoryLabel(category: string): HcpCategoryLabel {
  return REGISTERED.has(category) ? (category as HcpCategoryLabel) : 'other'
}

/** A D44 purpose IRI: `https://registry.trustoverip.org/dtg/purpose/<name>/<n>`, whatever `<n>` is. */
const D44_PURPOSE = /^https:\/\/registry\.trustoverip\.org\/dtg\/purpose\/([^/?#]+)\/[^/?#]+$/

/**
 * The label of a purpose IRI, matched on its D44 `<name>` alone; undefined for any other IRI or for none, which must
 * then read "for another purpose", never the IRI.
 */
export function hcpPurposeLabel(purpose: string | null | undefined): HcpPurposeLabel | undefined {
  const name = typeof purpose === 'string' ? D44_PURPOSE.exec(purpose)?.[1] : undefined
  return name !== undefined && Object.prototype.hasOwnProperty.call(HCP_PURPOSE_LABELS, name)
    ? (name as HcpPurposeLabel)
    : undefined
}

/** The word before the last item of a list, per language. */
const AND: Label = { en: 'and', fr: 'et', ptBr: 'e' }

/**
 * Items joined by the language's list form: "a", "a and b", "a, b and c" (no serial comma, in any of the three).
 * Written by hand: `Intl.ListFormat` is not on every Hermes build Keyring ships.
 */
export function hcpListForm(items: readonly string[], lang: HcpCopyLanguage): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} ${AND[lang]} ${items[items.length - 1]}`
}
