/**
 * The developer switch for agent connect (docs/plans/agent-connect-plan.md). Off unless a developer turns it on:
 * with it off, the `agent-connect` trigger flow is unknown to the reader and its links are answered exactly as any
 * flow this build does not know ("This code needs a newer version of the app."), and no connect screen is offered.
 *
 * A module-level switch, like `setSharedConnectEnabled`: the app sets it from its developer settings at start-up.
 *
 * Absent from store builds (agentConnectBuild.ts): with `agentConnectAvailableInBuild()` false the switch reads off and
 * setting it does nothing.
 *
 * @module connected-agents/agentConnectFlag
 */

import { agentConnectAvailableInBuild } from './agentConnectBuild'

let agentConnectEnabled = false

/** Turn agent connect on or off (developer setting). Does nothing in a build without agent connect. */
export function setAgentConnectEnabled(enabled: boolean): void {
  if (!agentConnectAvailableInBuild()) return
  agentConnectEnabled = enabled
}

/** Whether agent connect is on: never in a build without it. */
export function isAgentConnectEnabled(): boolean {
  return agentConnectAvailableInBuild() && agentConnectEnabled
}
