import { EventEmitter } from 'events'

/**
 * Credential Exchange Query Store
 *
 * Mirrors `modules/vrc/witnessStatusStore.ts`'s `vrcFlowStore.proposalPrompts`
 * pattern (a Trust Task arrives, a consent prompt is surfaced, the user's
 * answer resolves it) for `credential-exchange/query` — a verifier asking to
 * see a credential, rather than a peer proposing a relationship. Kept as its
 * own store rather than folded into `vrcFlowStore`: this is not VRC-specific,
 * and a wallet may hold prompts from more than one verifier connection at
 * once, so entries are keyed by the QUERY DOCUMENT's own id, not by
 * connectionId (unlike `RelationshipProposalPrompt`, where one connection has
 * at most one pending proposal at a time).
 */
export interface CredentialExchangeQueryPrompt {
  /** The query document's own `id` — how the answer is correlated back. */
  queryId: string
  connectionId: string
  verifierLabel: string
  /** The verifier's stated reason for asking (payload.purpose, REQUIRED). */
  purpose: string
}

class CredentialExchangeStore extends EventEmitter {
  private queryPrompts: Map<string, CredentialExchangeQueryPrompt> = new Map()

  /** Surface a credential-exchange query for user consent ('queryPrompt' event). */
  setQueryPrompt(prompt: CredentialExchangeQueryPrompt): void {
    this.queryPrompts.set(prompt.queryId, prompt)
    this.emit('queryPrompt', prompt)
  }

  getQueryPrompt(queryId: string): CredentialExchangeQueryPrompt | undefined {
    return this.queryPrompts.get(queryId)
  }

  /** The first pending prompt, if any — what a global consent modal renders. */
  getAnyQueryPrompt(): CredentialExchangeQueryPrompt | undefined {
    return this.queryPrompts.values().next().value
  }

  clearQueryPrompt(queryId: string): void {
    this.queryPrompts.delete(queryId)
    this.emit('queryPromptCleared', { queryId })
  }
}

export const credentialExchangeStore = new CredentialExchangeStore()
