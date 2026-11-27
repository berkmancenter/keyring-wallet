/**
 * The strings of "Answers on" (step 7.29, C5), in the shape of `../copy.ts`: here, not in the localization files,
 * which are not this work's. View models return these keys and parameters, never text.
 *
 * The row and its turn-on confirmation are plan §6's own words for "Answers other people" (7.14), kept per companion
 * finding 6. Everything else is PROPOSED, because on the HCP path Off cannot be undone in P1 where the base path's
 * Off can. Every French and Portuguese string is PROPOSED: each needs a native reader's approval before it moves into
 * the localization files.
 *
 * @module connected-agents/hcp/answersOn/copy
 */
import type { HcpCopyLanguage, HcpCopySource } from '../copy'

export type AnswersCopyKey =
  | 'AnswersRow'
  | 'AnswersValueOff'
  | 'AnswersValueOn'
  | 'AnswersHelpOff'
  | 'AnswersHelpOn'
  | 'AnswersOnTitle'
  | 'AnswersOnBody'
  | 'AnswersOnConfirm'
  | 'AnswersOnKeep'
  | 'AnswersOffConfirm'
  | 'AnswersOffTurnOff'
  | 'AnswersOffKeep'
  | 'AnswersLocked'
  | 'AnswersOnDirectiveText'
  | 'AnswersOffDirectiveText'
  | 'AnswersRefused'
  | 'AnswersUnreachable'

/**
 * The refusal: the same change is refused the same way every time, so it never offers another attempt (only
 * `AnswersUnreachable` may).
 */
export const ANSWERS_REFUSAL_KEYS = ['AnswersRefused'] as const satisfies readonly AnswersCopyKey[]

export const ANSWERS_COPY: Record<AnswersCopyKey, { en: string; fr: string; ptBr: string; source: HcpCopySource }> = {
  AnswersRow: {
    en: 'Answers other people',
    fr: 'Répond aux autres personnes',
    ptBr: 'Responde a outras pessoas',
    source: 'plan §6',
  },
  AnswersValueOff: {
    en: 'Off',
    fr: 'Désactivé',
    ptBr: 'Desativado',
    source: 'plan §6',
  },
  AnswersValueOn: {
    en: 'On',
    fr: 'Activé',
    ptBr: 'Ativado',
    source: 'plan §6',
  },
  AnswersHelpOff: {
    en: "Anyone but you who mentions {{name}} gets a fixed reply that it can't respond to others.",
    fr: 'Toute autre personne que vous qui mentionne {{name}} reçoit une réponse fixe indiquant qu’il ne peut pas répondre aux autres.',
    ptBr: 'Qualquer pessoa além de você que mencionar {{name}} recebe uma resposta fixa dizendo que ele não pode responder a outros.',
    source: 'plan §6',
  },
  AnswersHelpOn: {
    en: '{{name}} also acts on mentions from other people in rooms you added it to.',
    fr: '{{name}} agit aussi sur les mentions d’autres personnes dans les salons où vous l’avez ajouté.',
    ptBr: '{{name}} também age quando outras pessoas o mencionam nas salas em que você o adicionou.',
    source: 'plan §6',
  },
  AnswersOnTitle: {
    en: 'Let "{{name}}" answer other people?',
    fr: 'Laisser « {{name}} » répondre aux autres personnes ?',
    ptBr: 'Deixar "{{name}}" responder a outras pessoas?',
    source: 'plan §6',
  },
  AnswersOnBody: {
    en: 'Anyone in a room can then ask it to do things by mentioning it. It could be tricked into using your memory or posting for you, and your phone cannot prevent that.',
    fr: 'N’importe qui dans un salon pourra alors lui demander d’agir en le mentionnant. On pourrait le pousser à utiliser votre mémoire ou à publier pour vous, et votre téléphone ne peut pas l’empêcher.',
    ptBr: 'Qualquer pessoa numa sala poderá então pedir que ele faça coisas ao mencioná-lo. Ele pode ser enganado para usar sua memória ou publicar por você, e seu telefone não pode impedir isso.',
    source: 'plan §6',
  },
  AnswersOnConfirm: {
    en: 'Turn on',
    fr: 'Activer',
    ptBr: 'Ativar',
    source: 'plan §6',
  },
  AnswersOnKeep: {
    en: 'Keep it off',
    fr: 'Laisser désactivé',
    ptBr: 'Manter desativado',
    source: 'plan §6',
  },
  // Departs from plan §6 ("Turning it off needs no confirmation"): on the HCP path an Off cannot be undone in P1.
  AnswersOffConfirm: {
    en: 'Turn off answers for "{{name}}"? You can\'t turn them back on for this connection yet.',
    fr: 'Désactiver les réponses de « {{name}} » ? Vous ne pourrez pas encore les réactiver pour cette connexion.',
    ptBr: 'Desativar as respostas de "{{name}}"? Você ainda não poderá reativá-las para esta conexão.',
    source: 'PROPOSED',
  },
  // Added beyond the brief's table: the buttons of the turn-off confirmation, which the table does not name.
  AnswersOffTurnOff: {
    en: 'Turn off',
    fr: 'Désactiver',
    ptBr: 'Desativar',
    source: 'PROPOSED',
  },
  AnswersOffKeep: {
    en: 'Keep it on',
    fr: 'Laisser activé',
    ptBr: 'Manter ativado',
    source: 'PROPOSED',
  },
  AnswersLocked: {
    en: 'Off for this connection. Connect it again to change this.',
    fr: 'Désactivé pour cette connexion. Connectez-le de nouveau pour changer cela.',
    ptBr: 'Desativado para esta conexão. Conecte-o outra vez para mudar isso.',
    source: 'PROPOSED',
  },
  AnswersOnDirectiveText: {
    en: "You may answer other people in rooms you've been added to.",
    fr: 'Vous pouvez répondre aux autres personnes dans les salons où vous avez été ajouté.',
    ptBr: 'Você pode responder a outras pessoas nas salas em que foi adicionado.',
    source: 'PROPOSED',
  },
  AnswersOffDirectiveText: {
    en: "Don't answer other people.",
    fr: 'Ne répondez pas aux autres personnes.',
    ptBr: 'Não responda a outras pessoas.',
    source: 'PROPOSED',
  },
  AnswersRefused: {
    en: "Your VTA didn't accept this change.",
    fr: 'Votre VTA n’a pas accepté ce changement.',
    ptBr: 'Seu VTA não aceitou esta mudança.',
    source: 'PROPOSED',
  },
  AnswersUnreachable: {
    en: "We couldn't reach your VTA, so nothing changed.",
    fr: 'Impossible de joindre votre VTA : rien n’a changé.',
    ptBr: 'Não foi possível contatar seu VTA, então nada mudou.',
    source: 'PROPOSED',
  },
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g

/**
 * The string for `key` in `lang`, with each `{{name}}` filled from `params`. A placeholder with no value is left as
 * it is, as `hcpText` does.
 */
export function answersText(key: AnswersCopyKey, lang: HcpCopyLanguage, params: Record<string, string> = {}): string {
  return ANSWERS_COPY[key][lang].replace(PLACEHOLDER, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? params[name] : whole
  )
}
