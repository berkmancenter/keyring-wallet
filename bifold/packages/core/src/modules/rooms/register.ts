/**
 * Wires a rooms service onto the container. Not called at core boot: the app registers the real
 * service (or, in a development or test build, the sample one) once an agent exists, the same
 * opt-in pattern as `modules/trust-tasks/display/register.ts`. Screens treat an unregistered token as
 * "no rooms here" rather than failing.
 *
 * @module rooms/register
 */
import { DependencyContainer } from 'tsyringe'

import { TOKENS } from '../../container-api'

import type { RoomsService } from './types'

export function registerRoomsService(container: DependencyContainer, service: RoomsService): void {
  container.registerInstance(TOKENS.UTIL_ROOMS_SERVICE, service)
}
