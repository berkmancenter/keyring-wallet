/**
 * The strings of memories on HCP (step 7.29, C10), in the shape of `../copy.ts`: here, not in the localization files,
 * which are not this work's. One key for now, for a future screen: C10 cannot be built until Keyring has a Management
 * Client access token (see `./management.ts`). Every string is PROPOSED, and French and Portuguese need a native
 * reader's approval before they move into the localization files.
 *
 * @module connected-agents/hcp/memories/copy
 */
import type { HcpCopyLanguage, HcpCopySource } from '../copy'

export type MemoriesCopyKey = 'MemoriesNeedVtaUpdate'

export const MEMORIES_COPY: Record<MemoriesCopyKey, { en: string; fr: string; ptBr: string; source: HcpCopySource }> = {
  MemoriesNeedVtaUpdate: {
    en: "Your VTA can't change memories for this agent yet.",
    fr: 'Votre VTA ne peut pas encore modifier les souvenirs de cet agent.',
    ptBr: 'Seu VTA ainda não pode alterar as memórias deste agente.',
    source: 'PROPOSED',
  },
}

/** The string of `key` in `lang`. No key takes a parameter yet. */
export function memoriesText(key: MemoriesCopyKey, lang: HcpCopyLanguage): string {
  return MEMORIES_COPY[key][lang]
}
