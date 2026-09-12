/**
 * Pending-approval store for a generic (Approver-shaped) Trust Task request —
 * the wallet-side counterpart to `witnessStatusStore.ts`'s `vrcFlowStore`,
 * same EventEmitter pattern, for a different moment: a task type whose
 * request needs a PERSON'S decision rather than an automatic protocol reply.
 *
 * `ceremony.ts`'s own `pendingProposals` map (for `vrc/relationships/propose`)
 * is the precedent this generalizes: that map is VRC-specific and lives next
 * to `respondToRelationshipProposal`. This store is the same idea made
 * generic across any registered task type, keyed by `(connectionId,
 * typeUri)` so more than one pending request — even of different types, or
 * with different contacts — can be outstanding at once.
 *
 * @module trust-tasks/trustTaskPromptStore
 */

import { EventEmitter } from 'events'

/** One inbound Trust Task request awaiting a person's approve/deny decision. */
export interface PendingTrustTaskPrompt {
  connectionId: string
  typeUri: string
  /** The verbatim inbound document — a renderer needs the whole thing, not just its payload, to build outcome evidence into the response. */
  document: Record<string, unknown>
  counterpartyLabel: string
  /** A renderer-agnostic one-line summary, for a chrome that has no registered renderer for this type. */
  summary: string
}

class TrustTaskPromptStore extends EventEmitter {
  private pending: Map<string, PendingTrustTaskPrompt> = new Map()

  private key(connectionId: string, typeUri: string): string {
    return `${connectionId}::${typeUri}`
  }

  /** Surface a request for user consent ('prompt' event). */
  setPending(prompt: PendingTrustTaskPrompt): void {
    this.pending.set(this.key(prompt.connectionId, prompt.typeUri), prompt)
    this.emit('prompt', prompt)
  }

  getPending(connectionId: string, typeUri: string): PendingTrustTaskPrompt | undefined {
    return this.pending.get(this.key(connectionId, typeUri))
  }

  /** Remove and return the pending prompt — the user answered it. */
  takePending(connectionId: string, typeUri: string): PendingTrustTaskPrompt | undefined {
    const k = this.key(connectionId, typeUri)
    const prompt = this.pending.get(k)
    this.pending.delete(k)
    if (prompt) this.emit('promptCleared', { connectionId, typeUri })
    return prompt
  }

  /** All pending prompts, across every connection and type — for a generic inbox UI. */
  list(): PendingTrustTaskPrompt[] {
    return [...this.pending.values()]
  }

  /** Tests only. */
  clear(): void {
    this.pending.clear()
  }
}

export const trustTaskPromptStore = new TrustTaskPromptStore()
