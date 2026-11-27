/**
 * The strings of "What my agent saw" (C4; backlog brief, section B part 3, "Copy"), in the shape of `../copy.ts`.
 * Here, not in the localization files: the view model returns these keys and parameters, never text.
 *
 * `source` is where the English comes from. Every French and Portuguese string is PROPOSED: each needs a native
 * reader's approval before it moves into the localization files. Plan §6's copy rules hold for all of them.
 *
 * @module connected-agents/hcp/whatItSaw/copy
 */
import type { HcpCopyLanguage, HcpCopySource } from '../copy'

/** Where an English string comes from; the row strings take the word from the companion and the time is PROPOSED. */
export type WhatItSawCopySource = HcpCopySource | 'companion finding 6, the time PROPOSED'

export type WhatItSawCopyKey =
  | 'WhatItSawTitle'
  | 'WhatItSawSummary'
  | 'WhatItSawSummaryOne'
  | 'WhatItSawSummaryNoUntil'
  | 'WhatItSawSummaryOneNoUntil'
  | 'WhatItSawRead'
  | 'WhatItSawReadOther'
  | 'WhatItSawConnected'
  | 'WhatItSawRevoked'
  | 'WhatItSawTold'
  | 'WhatItSawEmpty'
  | 'WhatItSawUnreachable'
  | 'WhatItSawRefused'
  | 'WhatItSawMore'

/** The refusal: the same read fails the same way every time, so it never offers another attempt. */
export const WHAT_IT_SAW_REFUSAL_KEYS = ['WhatItSawRefused'] as const satisfies readonly WhatItSawCopyKey[]

export const WHAT_IT_SAW_COPY: Record<
  WhatItSawCopyKey,
  { en: string; fr: string; ptBr: string; source: WhatItSawCopySource }
> = {
  WhatItSawTitle: {
    en: 'What "{{name}}" saw',
    fr: 'Ce que « {{name}} » a vu',
    ptBr: 'O que "{{name}}" viu',
    source: 'companion finding 6',
  },
  WhatItSawSummary: {
    en: '{{n}} reads of {{categories}}, last at {{last}}. It can use what it read until {{until}}.',
    fr: "{{n}} lectures ({{categories}}), la dernière à {{last}}. Il peut utiliser ce qu'il a lu jusqu'à {{until}}.",
    ptBr: '{{n}} leituras ({{categories}}), a última às {{last}}. Ele pode usar o que leu até {{until}}.',
    source: 'companion finding 6',
  },
  // Beyond the brief's table: the singular, so one read never shows as "1 reads".
  WhatItSawSummaryOne: {
    en: '1 read of {{categories}}, at {{last}}. It can use what it read until {{until}}.',
    fr: "1 lecture ({{categories}}), à {{last}}. Il peut utiliser ce qu'il a lu jusqu'à {{until}}.",
    ptBr: '1 leitura ({{categories}}), às {{last}}. Ele pode usar o que leu até {{until}}.',
    source: 'PROPOSED',
  },
  // Beyond the brief's table: the summary with no `usableUntil`, or one already past, which "can use … until" would
  // misstate.
  WhatItSawSummaryNoUntil: {
    en: '{{n}} reads of {{categories}}, last at {{last}}.',
    fr: '{{n}} lectures ({{categories}}), la dernière à {{last}}.',
    ptBr: '{{n}} leituras ({{categories}}), a última às {{last}}.',
    source: 'PROPOSED',
  },
  WhatItSawSummaryOneNoUntil: {
    en: '1 read of {{categories}}, at {{last}}.',
    fr: '1 lecture ({{categories}}), à {{last}}.',
    ptBr: '1 leitura ({{categories}}), às {{last}}.',
    source: 'PROPOSED',
  },
  WhatItSawRead: {
    en: 'Read your {{category}} to {{purpose}}, {{time}}',
    fr: 'A lu « {{category}} » pour {{purpose}}, {{time}}',
    ptBr: 'Leu "{{category}}" para {{purpose}}, {{time}}',
    source: 'plan §6',
  },
  // Beyond the brief's table: a purpose with no label. The brief's "for another purpose" does not fit after "to".
  WhatItSawReadOther: {
    en: 'Read your {{category}} for another purpose, {{time}}',
    fr: 'A lu « {{category}} » pour un autre usage, {{time}}',
    ptBr: 'Leu "{{category}}" para outra finalidade, {{time}}',
    source: 'PROPOSED',
  },
  WhatItSawConnected: {
    en: 'Connected, {{time}}',
    fr: 'Connecté, {{time}}',
    ptBr: 'Conectado, {{time}}',
    source: 'companion finding 6, the time PROPOSED',
  },
  WhatItSawRevoked: {
    en: 'Revoked, {{time}}',
    fr: 'Révoqué, {{time}}',
    ptBr: 'Revogado, {{time}}',
    source: 'companion finding 6, the time PROPOSED',
  },
  WhatItSawTold: {
    en: 'Told it was revoked, {{time}}',
    fr: 'Informé de la révocation, {{time}}',
    ptBr: 'Avisado da revogação, {{time}}',
    source: 'companion finding 6, the time PROPOSED',
  },
  WhatItSawEmpty: {
    en: "It hasn't read anything yet.",
    fr: "Il n'a encore rien lu.",
    ptBr: 'Ainda não leu nada.',
    source: 'companion finding 6',
  },
  WhatItSawUnreachable: {
    en: "We couldn't reach your VTA, so this list may be out of date.",
    fr: "Nous n'avons pas pu joindre votre VTA, cette liste n'est donc peut-être pas à jour.",
    ptBr: 'Não conseguimos acessar seu VTA, então esta lista pode estar desatualizada.',
    source: 'companion finding 6',
  },
  WhatItSawRefused: {
    en: "Your VTA didn't share this list.",
    fr: "Votre VTA n'a pas partagé cette liste.",
    ptBr: 'Seu VTA não compartilhou esta lista.',
    source: 'PROPOSED',
  },
  // The brief's "Showing the latest 500." would be untrue: `hcp/audit/read` pages oldest first, so the 500 read are
  // the earliest.
  WhatItSawMore: {
    en: 'Showing the earliest 500.',
    fr: 'Affichage des 500 premiers.',
    ptBr: 'Mostrando os 500 primeiros.',
    source: 'PROPOSED',
  },
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g

/**
 * The string for `key` in `lang`, with each `{{name}}` filled from `params`. A placeholder with no value is left as
 * it is, so a missing parameter shows rather than reading as empty.
 */
export function whatItSawText(
  key: WhatItSawCopyKey,
  lang: HcpCopyLanguage,
  params: Record<string, string> = {}
): string {
  return WHAT_IT_SAW_COPY[key][lang].replace(PLACEHOLDER, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? params[name] : whole
  )
}
