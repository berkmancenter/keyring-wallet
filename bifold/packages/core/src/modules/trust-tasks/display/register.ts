/**
 * Wires the Trust Task display registry singleton onto the container, the
 * same one-line pattern `modules/vrc/register.ts` uses for
 * `UTIL_CREDENTIAL_DISPLAY_REGISTRY`. Not called automatically at core boot —
 * a profile that actually renders a Trust Task approval screen calls this
 * once (the Approver demo profile does), the same way VRC's own
 * `registerVrcDisplayHandlers` is opt-in rather than always-on.
 *
 * @module trust-tasks/display/register
 */

import { DependencyContainer } from 'tsyringe'

import { TOKENS } from '../../../container-api'

import { trustTaskDisplayRegistry } from './trustTaskDisplayRegistry'

export function registerTrustTaskDisplay(container: DependencyContainer): void {
  container.registerInstance(TOKENS.UTIL_TRUST_TASK_DISPLAY_REGISTRY, trustTaskDisplayRegistry)
}
