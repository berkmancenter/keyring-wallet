/**
 * The developer switch for agent connect (docs/plans/agent-connect-plan.md). Off unless a developer turns it on:
 * with it off, the `agent-connect` trigger flow is unknown to the reader and its links are answered exactly as any
 * flow this build does not know ("This code needs a newer version of the app."), and no connect screen is offered.
 *
 * A module-level switch, like `setSharedConnectEnabled`: the app sets it from its developer settings at start-up.
 *
 * @module connected-agents/agentConnectFlag
 */

let agentConnectEnabled = false

/** Turn agent connect on or off (developer setting). */
export function setAgentConnectEnabled(enabled: boolean): void {
  agentConnectEnabled = enabled
}

/** Whether agent connect is on. */
export function isAgentConnectEnabled(): boolean {
  return agentConnectEnabled
}
