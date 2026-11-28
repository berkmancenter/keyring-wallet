/**
 * The developer switch for agent connect's rooms tier, P1 (docs/plans/agent-connect-plan.md §7.0, steps 7.13 and
 * 7.14). Off unless a developer turns it on, and off whenever agent connect itself is off: P1 is its own tier ("A P1
 * screen is not walked or required by the P0 gate"), so a build that turns agent connect on does not also show the
 * rooms screens (decided 2026-11-28: backlog 3, ruling 1).
 *
 * A module-level switch, like agentConnectFlag.ts: the app sets it from its developer settings at start-up.
 *
 * @module connected-agents/agentRoomsFlag
 */

import { isAgentConnectEnabled } from './agentConnectFlag'

let agentRoomsEnabled = false

/** Turn agent connect's rooms tier on or off (developer setting). It takes effect only with agent connect on. */
export function setAgentRoomsEnabled(enabled: boolean): void {
  agentRoomsEnabled = enabled
}

/** Whether agent connect's rooms tier is on: its own switch, and agent connect's. */
export function isAgentRoomsEnabled(): boolean {
  return agentRoomsEnabled && isAgentConnectEnabled()
}
