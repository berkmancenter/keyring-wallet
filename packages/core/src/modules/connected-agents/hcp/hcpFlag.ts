/**
 * The developer switch for the HCP demo (step 7.27 track C, part 1). Off unless a developer turns it on, and on
 * only together with agent connect: `isHcpEnabled()` needs both. With both required, the release gate that watches
 * the agent-connect setter (`../__tests__/releaseGate.test.ts`) protects the HCP code with no change.
 *
 * Every other file in `hcp/` checks `isHcpEnabled()`, never `isHcpFlagOn()`. Nothing outside the tests calls
 * `setHcpEnabled`.
 *
 * @module connected-agents/hcp/hcpFlag
 */
import { isAgentConnectEnabled } from '../agentConnectFlag'

let hcpEnabled = false

/** Turn the HCP flag on or off (developer setting; tests only for now). */
export function setHcpEnabled(enabled: boolean): void {
  hcpEnabled = enabled
}

/** Whether the HCP flag itself is on, whatever agent connect's flag says. */
export function isHcpFlagOn(): boolean {
  return hcpEnabled
}

/** Whether the HCP demo may run: agent connect on and the HCP flag on. */
export function isHcpEnabled(): boolean {
  return isAgentConnectEnabled() && hcpEnabled
}
