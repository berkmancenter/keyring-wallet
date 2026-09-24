/**
 * What a community asks a vetter to confirm, in words a person reads — never
 * the claim key ("name.legal") a criterion carries. A known claim has its own
 * words; an unknown one is spelt out from its key ("address.postal" → "your
 * address postal"), which is plain if not elegant, and never dotted.
 *
 * @module trust-tasks/screens/claimWords
 */

import type { TFunction } from 'i18next'

import type { JoinNeed } from '../module/vtiJoin'

/** Claims with words of their own, by key. */
const KNOWN: Record<string, string> = {
  'name.legal': 'Claims.NameLegal',
}

/** A key as words: split at dots, dashes, underscores and camelCase, lower-cased. */
const spelt = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[.:_\-\s]+/)
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

export function claimWords(claim: string, t: TFunction): string {
  const known = KNOWN[claim]
  if (known) return t(known) as string
  return t('Claims.Other', { what: spelt(claim), interpolation: { escapeValue: false } }) as string
}

/** Several claims as one phrase: "your legal name and your address". */
export function claimList(claims: string[], t: TFunction): string {
  const words = claims.map((c) => claimWords(c, t))
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} ${t('Claims.And')} ${words[words.length - 1]}`
}

/**
 * One thing a community asked for when it deferred an application, in words.
 * Its verdict names them as keys — "vetting:statements:1",
 * "vetting:method:in_person:1", "claim:name.legal" — which used to be shown
 * as they came.
 */
export function needWords(need: string, t: TFunction): string {
  const statements = /^vetting:statements:(\d+)$/.exec(need)
  if (statements) return t('Vetting.NeedsStatements', { count: Number(statements[1]) }) as string
  const method = /^vetting:method:([^:]+):(\d+)$/.exec(need)
  if (method) {
    return t('Vetting.NeedsMethod', {
      n: Number(method[2]),
      method: t(`Vetting.Method.${method[1]}`, { defaultValue: spelt(method[1]) }),
      interpolation: { escapeValue: false },
    }) as string
  }
  const claim = /^(?:claim|credential):(.+)$/.exec(need)
  if (claim) return claimWords(claim[1], t)
  return spelt(need)
}

/** The same, for a need the join state has already read (vtiJoin's JoinNeed). */
export function joinNeedWords(need: JoinNeed, t: TFunction): string {
  switch (need.kind) {
    case 'statements':
      return t('Vetting.NeedsStatements', { count: need.count }) as string
    case 'invitation':
      return t('Vetting.NeedsInvitation') as string
    case 'vetting':
      return t('Vetting.NeedsVetting') as string
    case 'agreement':
      return t('Vetting.NeedsAgreement', { what: spelt(need.id), interpolation: { escapeValue: false } }) as string
    default:
      return needWords(need.raw, t)
  }
}
