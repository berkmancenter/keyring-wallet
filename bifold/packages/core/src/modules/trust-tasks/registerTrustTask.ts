/**
 * The single call surface 2026-09-01-al.md §2 specifies for R5:
 * `registerTrustTask({ spec, orchestration, renderer })`. Registers into the
 * engine-side dispatch registry (`./registry`'s `trustTaskRegistry`) and,
 * when a renderer is supplied, the UI-side display registry
 * (`./display/trustTaskDisplayRegistry`) in one call — so a demo profile has
 * one function to call rather than two registries to remember.
 *
 * @module trust-tasks/registerTrustTask
 */

import type { ITrustTaskDisplayHandler } from '../../types/trust-task-display'

import { trustTaskDisplayRegistry } from './display/trustTaskDisplayRegistry'
import { trustTaskRegistry } from './registry'
import type { TrustTaskDocumentHandler, TrustTaskOrchestration } from './registry'
import type { TrustTaskSpecPolicy } from './services/TrustTasksService'

export interface RegisterTrustTaskOptions {
  typeUri: string
  spec: TrustTaskSpecPolicy
  responseSpec?: TrustTaskSpecPolicy
  orchestration?: TrustTaskOrchestration
  handleRequest: TrustTaskDocumentHandler
  handleResponse?: TrustTaskDocumentHandler
  /** Display data extractor for the generic approval screen — omit for a task type with no person-facing UI (e.g. one that always auto-replies). */
  renderer?: ITrustTaskDisplayHandler
}

export function registerTrustTask(options: RegisterTrustTaskOptions): void {
  trustTaskRegistry.register({
    typeUri: options.typeUri,
    spec: options.spec,
    responseSpec: options.responseSpec,
    orchestration: options.orchestration,
    handleRequest: options.handleRequest,
    handleResponse: options.handleResponse,
  })
  if (options.renderer) {
    trustTaskDisplayRegistry.register(options.renderer)
  }
}
