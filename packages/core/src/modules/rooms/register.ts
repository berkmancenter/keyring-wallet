/**
 * Wires a rooms service onto the container. Not called at core boot: the app registers the real
 * service (or, in a development or test build, the sample one) once an agent exists, the same
 * opt-in pattern as `modules/trust-tasks/display/register.ts`. Screens treat an unregistered token as
 * "no rooms here" rather than failing.
 *
 * The app registers again whenever its agent starts, and an unlock restarts the same agent. A service built on
 * the agent already registered is not swapped in: the registered one keeps the rooms it has read and what the
 * agent serves. A new one knew no room, so a screen the app came back on after the PIN (Room details, a room's
 * notes) had to list the member's rooms through the community before asking the agent, and with the community's
 * connection down across the unlock, that read failed every time and the agent never heard of it (276.10).
 *
 * @module rooms/register
 */
import { DependencyContainer } from 'tsyringe'

import { TOKENS } from '../../container-api'

import type { RoomsService } from './types'

export function registerRoomsService(container: DependencyContainer, service: RoomsService): void {
  if (service.runsOn !== undefined && registered(container)?.runsOn === service.runsOn) return
  container.registerInstance(TOKENS.UTIL_ROOMS_SERVICE, service)
}

const registered = (container: DependencyContainer): RoomsService | undefined =>
  container.isRegistered(TOKENS.UTIL_ROOMS_SERVICE)
    ? container.resolve<RoomsService | undefined>(TOKENS.UTIL_ROOMS_SERVICE)
    : undefined
