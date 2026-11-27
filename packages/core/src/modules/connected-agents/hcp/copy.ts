/**
 * The HCP demo's strings (step 7.27 track C, "Copy"). Here, not in the localization files, which are not this
 * work's: view models return these keys and parameters, never text. `hcpText` is for tests and for whoever moves
 * these into the localization files later.
 *
 * `source` is where the English comes from. Every French and Portuguese string is PROPOSED: each needs a native
 * reader's approval before it moves into the localization files. Plan §6's copy rules hold for all of them.
 *
 * @module connected-agents/hcp/copy
 */

export type HcpCopyLanguage = 'en' | 'fr' | 'ptBr'

export type HcpCopySource = 'companion finding 6' | 'plan §6' | 'PROPOSED'

export type HcpCopyKey =
  | 'ApproveTitle'
  | 'ApproveOwnTerminal'
  | 'Approve'
  | 'CodeExpired'
  | 'WrongNumber'
  | 'Locked'
  | 'StatusConnectedUntil'
  | 'StatusExpired'
  | 'StatusRevoked'
  | 'RevokeTelling'
  | 'RevokeTold'
  | 'RevokeNotTold'
  | 'RevokeTitle'
  | 'RevokeBody'
  | 'Revoke'
  | 'Keep'
  | 'RevokeUnreachable'
  | 'NewMemoryTitle'
  | 'NewMemoryField'
  | 'NewMemoryHelper'
  | 'NewMemorySave'
  | 'MemoryNotSaved'

export const HCP_COPY: Record<HcpCopyKey, { en: string; fr: string; ptBr: string; source: HcpCopySource }> = {
  ApproveTitle: {
    en: 'Connect "{{name}}"?',
    fr: 'Connecter « {{name}} » ?',
    ptBr: 'Conectar "{{name}}"?',
    source: 'plan §6',
  },
  ApproveOwnTerminal: {
    en: 'Only continue if you ran the command in your own terminal just now.',
    fr: 'Continuez seulement si vous venez de lancer la commande dans votre propre terminal.',
    ptBr: 'Só continue se você acabou de executar o comando no seu próprio terminal.',
    source: 'plan §6',
  },
  Approve: {
    en: 'Approve',
    fr: 'Approuver',
    ptBr: 'Aprovar',
    source: 'plan §6',
  },
  CodeExpired: {
    en: 'This code has expired. Run the command again.',
    fr: 'Ce code a expiré. Relancez la commande.',
    ptBr: 'Este código expirou. Execute o comando novamente.',
    source: 'plan §6',
  },
  WrongNumber: {
    en: "That isn't the number in your terminal. Nothing was connected.",
    fr: "Ce n'est pas le numéro affiché dans votre terminal. Rien n'a été connecté.",
    ptBr: 'Esse não é o número do seu terminal. Nada foi conectado.',
    source: 'plan §6',
  },
  Locked: {
    en: 'Too many wrong numbers. Try again in {{n}} minutes.',
    fr: 'Trop de numéros erronés. Réessayez dans {{n}} minutes.',
    ptBr: 'Números errados demais. Tente de novo em {{n}} minutos.',
    source: 'plan §6',
  },
  StatusConnectedUntil: {
    en: 'Connected until {{time}}',
    fr: "Connecté jusqu'à {{time}}",
    ptBr: 'Conectado até {{time}}',
    source: 'companion finding 6',
  },
  StatusExpired: {
    en: 'Expired',
    fr: 'Expiré',
    ptBr: 'Expirado',
    source: 'companion finding 6',
  },
  StatusRevoked: {
    en: 'Revoked',
    fr: 'Révoqué',
    ptBr: 'Revogado',
    source: 'companion finding 6',
  },
  RevokeTelling: {
    en: 'Revoked. Telling "{{name}}"…',
    fr: 'Révoqué. Nous prévenons « {{name}} »…',
    ptBr: 'Revogado. Avisando "{{name}}"…',
    source: 'companion finding 6',
  },
  RevokeTold: {
    en: 'Revoked. "{{name}}" was told at {{time}}.',
    fr: 'Révoqué. « {{name}} » a été prévenu à {{time}}.',
    ptBr: 'Revogado. "{{name}}" foi avisado às {{time}}.',
    source: 'companion finding 6',
  },
  RevokeNotTold: {
    en: 'Revoked. We couldn\'t tell "{{name}}". Anything it read stops being usable at {{time}}.',
    fr: "Révoqué. Nous n'avons pas pu prévenir « {{name}} ». Ce qu'il a lu cesse d'être utilisable à {{time}}.",
    ptBr: 'Revogado. Não conseguimos avisar "{{name}}". O que ele leu deixa de poder ser usado às {{time}}.',
    source: 'companion finding 6',
  },
  RevokeTitle: {
    en: 'Revoke "{{name}}"?',
    fr: 'Révoquer « {{name}} » ?',
    ptBr: 'Revogar "{{name}}"?',
    source: 'companion finding 6',
  },
  RevokeBody: {
    en: "It stops at once. We'll tell it, and show you when it has heard.",
    fr: "Il s'arrête aussitôt. Nous le prévenons, et vous montrons quand il a été prévenu.",
    ptBr: 'Ele para na hora. Vamos avisá-lo e mostrar quando ele receber o aviso.',
    source: 'companion finding 6',
  },
  Revoke: {
    en: 'Revoke',
    fr: 'Révoquer',
    ptBr: 'Revogar',
    source: 'companion finding 6',
  },
  Keep: {
    en: 'Keep',
    fr: 'Garder',
    ptBr: 'Manter',
    source: 'companion finding 6',
  },
  RevokeUnreachable: {
    en: 'We couldn\'t reach your VTA, so "{{name}}" is still connected.',
    fr: "Nous n'avons pas pu joindre votre VTA, donc « {{name}} » est toujours connecté.",
    ptBr: 'Não conseguimos falar com seu VTA, então "{{name}}" continua conectado.',
    source: 'plan §6',
  },
  NewMemoryTitle: {
    en: 'Add a memory for "{{name}}"',
    fr: 'Ajouter un souvenir pour « {{name}} »',
    ptBr: 'Adicionar uma memória para "{{name}}"',
    source: 'companion finding 6',
  },
  NewMemoryField: {
    en: 'What should it know?',
    fr: 'Que doit-il savoir ?',
    ptBr: 'O que ele deve saber?',
    source: 'companion finding 6',
  },
  NewMemoryHelper: {
    en: 'Saved as something you said.',
    fr: 'Enregistré comme quelque chose que vous avez dit.',
    ptBr: 'Salvo como algo que você disse.',
    source: 'companion finding 6',
  },
  NewMemorySave: {
    en: 'Save',
    fr: 'Enregistrer',
    ptBr: 'Salvar',
    source: 'companion finding 6',
  },
  MemoryNotSaved: {
    en: "We couldn't reach your VTA, so this memory wasn't saved.",
    fr: "Nous n'avons pas pu joindre votre VTA, donc ce souvenir n'a pas été enregistré.",
    ptBr: 'Não conseguimos falar com seu VTA, então esta memória não foi salva.',
    source: 'PROPOSED',
  },
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g

/** The `{{name}}`-style placeholder names a string uses, each once, sorted. */
export function hcpPlaceholders(text: string): string[] {
  const names = new Set<string>()
  for (const m of text.matchAll(PLACEHOLDER)) names.add(m[1])
  return [...names].sort()
}

/**
 * The string for `key` in `lang`, with each `{{name}}` filled from `params`. A placeholder with no value is left as
 * it is, so a missing parameter shows rather than reading as an empty name.
 */
export function hcpText(key: HcpCopyKey, lang: HcpCopyLanguage, params: Record<string, string> = {}): string {
  return HCP_COPY[key][lang].replace(PLACEHOLDER, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? params[name] : whole
  )
}
