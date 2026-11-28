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
  | 'ApproveNotSignIn'
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
  | 'RevokeNothingDisclosed'
  | 'RevokeNotToldPast'
  | 'RevokeAlreadyEnded'
  | 'RevokeAlreadyDisconnected'
  | 'RevokeTitle'
  | 'RevokeBody'
  | 'Revoke'
  | 'Keep'
  | 'RevokeUnreachable'
  | 'RevokeRefused'
  | 'RevokeNotYetIssued'
  | 'RevokeGrantAmbiguous'
  | 'NewMemoryTitle'
  | 'NewMemoryField'
  | 'NewMemoryHelper'
  | 'NewMemorySave'
  | 'MemoryNotSaved'
  | 'MemoryRefused'
  | 'MemoryNoVta'
  | 'ApproveNotApproved'
  | 'ApproveNotRecorded'
  | 'ApproveDeclined'
  | 'ApproveAnsweredElsewhere'
  | 'ApproveCancelled'
  | 'ApproveAllowsPurposes'
  | 'ApproveNotTemporary'
  | 'ApproveBadTerm'

/**
 * The keys for a refusal (added after the brief, at review): unlike `RevokeUnreachable` and `MemoryNotSaved`, the
 * same request fails the same way every time, so none of these strings may offer another attempt.
 */
export const HCP_REFUSAL_KEYS = ['RevokeRefused', 'MemoryRefused'] as const satisfies readonly HcpCopyKey[]

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
  // Keyring's own line on every HCP consent, never an effect: the base path's `ConnectedAgents.ApproveNotSignIn`.
  ApproveNotSignIn: {
    en: 'Approving gives access. It is not signing in.',
    fr: "Approuver donne un accès. Ce n'est pas une connexion à votre compte.",
    ptBr: 'Aprovar dá acesso. Não é um login.',
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
  // Added for the notice read by grant (backlog 2, track 5): nothing was disclosed to the client under the grant, so
  // there is no one to tell. The English is the "Revoked." the three lines above open with; no new words.
  RevokeNothingDisclosed: {
    en: 'Revoked.',
    fr: 'Révoqué.',
    ptBr: 'Revogado.',
    source: 'PROPOSED',
  },
  // Added for the "Telling…" rule (the notice read from the audit log by grant): not told, and the time anything
  // it read stays usable has already passed (V0 copies last at most 1 h).
  RevokeNotToldPast: {
    en: 'Revoked. We couldn\'t tell "{{name}}". Anything it read stopped being usable at {{time}}.',
    fr: "Révoqué. Nous n'avons pas pu prévenir « {{name}} ». Ce qu'il a lu a cessé d'être utilisable à {{time}}.",
    ptBr: 'Revogado. Não conseguimos avisar "{{name}}". O que ele leu deixou de poder ser usado às {{time}}.',
    source: 'PROPOSED',
  },
  // The grant had expired before the revoke reached the VTA: no notice is sent for an expired grant. Names the access,
  // not the agent, as having ended (reworded at review).
  RevokeAlreadyEnded: {
    en: 'Access for "{{name}}" had already ended, so there was nothing to tell.',
    fr: "L'accès de « {{name}} » avait déjà pris fin, il n'y avait donc rien à lui dire.",
    ptBr: 'O acesso de "{{name}}" já tinha terminado, então não havia nada a avisar.',
    source: 'PROPOSED',
  },
  // The client had relinquished the grant itself: no notice follows a relinquishment.
  RevokeAlreadyDisconnected: {
    en: '"{{name}}" had already disconnected, so there was nothing to tell.',
    fr: "« {{name}} » s'était déjà déconnecté, il n'y avait donc rien à lui dire.",
    ptBr: '"{{name}}" já tinha se desconectado, então não havia nada a avisar.',
    source: 'PROPOSED',
  },
  // Added for the VTI hcp.md §5.1 contract, reworded at review: a request that names no purpose. No picker is
  // offered (no choice would reach the VTA), so the line states the real scope; the purposes follow as rows.
  ApproveAllowsPurposes: {
    en: '"{{name}}" didn\'t say what it needs this for. If you approve, it may use it for any of these:',
    fr: "« {{name}} » n'a pas dit à quoi cela lui sert. Si vous approuvez, il pourra l'utiliser pour chacun de ces usages :",
    ptBr: '"{{name}}" não disse para que precisa disso. Se você aprovar, ele poderá usar para qualquer um destes fins:',
    source: 'PROPOSED',
  },
  // Added at review: V0 approves a temporary grant only, so a request to stay connected is declined.
  ApproveNotTemporary: {
    en: '"{{name}}" asks to stay connected. Keyring can\'t approve that yet, so it was declined.',
    fr: "« {{name}} » demande à rester connecté. Keyring ne peut pas encore l'approuver, la demande a donc été refusée.",
    ptBr: '"{{name}}" pede para ficar conectado. O Keyring ainda não pode aprovar isso, então o pedido foi recusado.',
    source: 'PROPOSED',
  },
  // Added at review: the grant would end in the past, or more than 24 hours ahead (HCP 6.1.3), so it was declined.
  ApproveBadTerm: {
    en: '"{{name}}" asked for access ending at a time Keyring can\'t approve, so it was declined.',
    fr: '« {{name}} » a demandé un accès qui se termine à une heure que Keyring ne peut pas approuver, la demande a donc été refusée.',
    ptBr: '"{{name}}" pediu um acesso que termina num horário que o Keyring não pode aprovar, então o pedido foi recusado.',
    source: 'PROPOSED',
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
  // Plan §6 has no words for a refused revoke; this follows its "Your VTA refused this connection. Nothing was
  // connected." A refusal (for example `notFound`, a grant the VTA no longer holds) repeats, so no "try again".
  RevokeRefused: {
    en: 'Your VTA refused to revoke "{{name}}", so nothing changed here.',
    fr: "Votre VTA a refusé de révoquer « {{name}} », donc rien n'a changé ici.",
    ptBr: 'Seu VTA recusou revogar "{{name}}", então nada mudou aqui.',
    source: 'PROPOSED',
  },
  // Added at review of the §5.1 alignment: nothing was sent, because the grant is not in the audit log yet (the
  // client has not picked up its access). It can be tried again shortly.
  RevokeNotYetIssued: {
    en: '"{{name}}" hasn\'t picked up its access yet. Try again in a minute.',
    fr: "« {{name}} » n'a pas encore récupéré son accès. Réessayez dans une minute.",
    ptBr: '"{{name}}" ainda não pegou seu acesso. Tente de novo em um minuto.',
    source: 'PROPOSED',
  },
  // Added at review of the §5.1 alignment: nothing was sent, because Keyring cannot tell which of the client's grants
  // is this connection's (two approvals at once). Revoking the wrong one would end the wrong access.
  RevokeGrantAmbiguous: {
    en: 'Keyring can\'t tell yet which access of "{{name}}" to end, so nothing changed. Try again later.',
    fr: "Keyring ne sait pas encore quel accès de « {{name}} » arrêter, donc rien n'a changé. Réessayez plus tard.",
    ptBr: 'O Keyring ainda não sabe qual acesso de "{{name}}" encerrar, então nada mudou. Tente de novo mais tarde.',
    source: 'PROPOSED',
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
  // Plan §6 has no words for a refused memory; as `RevokeRefused`, it follows "Your VTA refused this connection." and
  // offers no retry, since the same memory would be refused again.
  MemoryRefused: {
    en: "Your VTA refused this memory, so it wasn't saved.",
    fr: "Votre VTA a refusé ce souvenir, donc il n'a pas été enregistré.",
    ptBr: 'Seu VTA recusou esta memória, então ela não foi salva.',
    source: 'PROPOSED',
  },
  // Added at review: a phone with no manager DID is not signed in to a VTA, which is not an unreachable one, and
  // nothing was sent. Plan §6 has no sign-in words to reuse.
  MemoryNoVta: {
    en: "This phone isn't signed in to your VTA, so this memory wasn't saved.",
    fr: "Ce téléphone n'est pas identifié auprès de votre VTA, donc ce souvenir n'a pas été enregistré.",
    ptBr: 'Este telefone não está conectado ao seu VTA, então esta memória não foi salva.',
    source: 'PROPOSED',
  },
  // Added at review, the approve flow's `failed` and `cancelled`, one key per case, never the error text. Plan §6 has
  // words for none of them.
  // Nothing was approved (the record before `decide` failed, or no name was given): another attempt is safe.
  ApproveNotApproved: {
    en: 'Nothing was approved, so nothing was connected. Run the command again.',
    fr: "Rien n'a été approuvé, donc rien n'a été connecté. Relancez la commande.",
    ptBr: 'Nada foi aprovado, então nada foi conectado. Execute o comando novamente.',
    source: 'PROPOSED',
  },
  // The VTA approved and the grant exists; only Keyring's record failed, and the reconcile completes it. No other
  // attempt may be offered: a second approval would create a second grant.
  ApproveNotRecorded: {
    en: 'Your VTA approved "{{name}}". It will show as connected the next time Keyring starts.',
    fr: 'Votre VTA a approuvé « {{name}} ». Il apparaîtra comme connecté au prochain démarrage de Keyring.',
    ptBr: 'Seu VTA aprovou "{{name}}". Ele vai aparecer como conectado na próxima vez que o Keyring abrir.',
    source: 'PROPOSED',
  },
  // The VTA did not approve (the request settled otherwise, carried its own error, or `decide` failed). It says
  // nothing about whether something was connected: after a failed `decide` the reconcile may still complete it.
  ApproveDeclined: {
    en: "Your VTA didn't approve this connection.",
    fr: "Votre VTA n'a pas approuvé cette connexion.",
    ptBr: 'Seu VTA não aprovou esta conexão.',
    source: 'PROPOSED',
  },
  // The request was approved elsewhere in Keyring (the ordinary requests list) while this flow waited: not declined.
  ApproveAnsweredElsewhere: {
    en: 'This request was already answered elsewhere in Keyring.',
    fr: 'Cette demande a déjà reçu une réponse ailleurs dans Keyring.',
    ptBr: 'Este pedido já foi respondido em outro lugar do Keyring.',
    source: 'PROPOSED',
  },
  ApproveCancelled: {
    en: 'Cancelled. Nothing was connected.',
    fr: "Annulé. Rien n'a été connecté.",
    ptBr: 'Cancelado. Nada foi conectado.',
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
