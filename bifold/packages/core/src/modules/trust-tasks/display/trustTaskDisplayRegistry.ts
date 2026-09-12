/**
 * Trust Task Display Registry
 *
 * Implements `ITrustTaskDisplayRegistry` from core, mirroring
 * `modules/vrc/display/displayRegistry.ts`'s `CredentialDisplayRegistry`
 * exactly: a plain registration list keyed by type, with a documented
 * fallback for anything unregistered.
 *
 * @module trust-tasks/display/trustTaskDisplayRegistry
 */

import { ITrustTaskDisplayHandler, ITrustTaskDisplayRegistry, TrustTaskDisplayResult } from '../../../types/trust-task-display'

const FALLBACK: TrustTaskDisplayResult = {
  title: 'Approval request',
  fields: [],
  approveLabel: 'Global.Accept',
  denyLabel: 'Global.Decline',
}

class TrustTaskDisplayRegistry implements ITrustTaskDisplayRegistry {
  private handlers: Map<string, ITrustTaskDisplayHandler> = new Map()

  register(handler: ITrustTaskDisplayHandler): void {
    this.handlers.set(handler.typeUri, handler)
  }

  unregister(typeUri: string): void {
    this.handlers.delete(typeUri)
  }

  hasHandler(typeUri: string): boolean {
    return this.handlers.has(typeUri)
  }

  getDisplayInfo(typeUri: string, document: Record<string, unknown>): TrustTaskDisplayResult {
    const handler = this.handlers.get(typeUri)
    return handler ? handler.getDisplayInfo(document) : FALLBACK
  }

  /** Tests only. */
  clear(): void {
    this.handlers.clear()
  }
}

/** Global singleton instance — resolved via `TOKENS.UTIL_TRUST_TASK_DISPLAY_REGISTRY` once a profile registers it (see `./register.ts`). */
export const trustTaskDisplayRegistry = new TrustTaskDisplayRegistry()
