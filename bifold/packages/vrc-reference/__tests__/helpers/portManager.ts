/**
 * Port Manager for Jest Parallel Test Execution
 *
 * This module provides worker-aware port allocation to prevent conflicts
 * when running integration tests in parallel. Each Jest worker gets a
 * dedicated, non-overlapping port range.
 */

/**
 * Port allocation strategy:
 * - Worker 0: 20000-20999
 * - Worker 1: 21000-21999
 * - Worker 2: 22000-22999
 * - Worker 3: 23000-23999
 * - etc.
 *
 * Within each worker's range:
 * - Alice agents: offset 0-99
 * - Bob agents: offset 100-199
 * - Witness agents: offset 200-299
 * - Additional agents: offset 300-399
 */

export enum AgentType {
  ALICE = 0,
  BOB = 100,
  WITNESS = 200,
  OTHER = 300,
}

/**
 * Get the Jest worker ID (0-indexed)
 * Falls back to 0 if not in a Jest worker context
 */
export function getWorkerId(): number {
  const workerId = process.env.JEST_WORKER_ID
  if (!workerId) {
    return 0
  }
  // Jest worker IDs are 1-indexed, we want 0-indexed
  return parseInt(workerId, 10) - 1
}

/**
 * Calculate a port number for an agent based on worker ID and agent type
 *
 * @param agentType - The type of agent (Alice, Bob, Witness, or Other)
 * @param instanceIndex - Instance number within the type (0, 1, 2, etc.)
 * @returns A unique port number for this worker and agent combination
 */
export function getPortForAgent(agentType: AgentType, instanceIndex: number = 0): number {
  const workerId = getWorkerId()
  const basePort = 20000 + workerId * 1000
  const port = basePort + agentType + instanceIndex

  // Validate port is within worker's range
  const maxPort = basePort + 999
  if (port > maxPort) {
    throw new Error(
      `Port ${port} exceeds worker ${workerId} maximum (${maxPort}). ` +
        `Instance index ${instanceIndex} is too high for agent type ${agentType}.`
    )
  }

  return port
}

/**
 * Generate a unique agent ID that includes worker, process, and timestamp info
 * This ensures no wallet ID collisions even when tests run in parallel
 *
 * @param agentName - Base name for the agent (e.g., 'alice', 'bob', 'witness')
 * @param suffix - Optional additional suffix for uniqueness
 * @returns A globally unique agent identifier
 */
export function generateUniqueAgentId(agentName: string, suffix?: string): string {
  const workerId = getWorkerId()
  const pid = process.pid
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)

  const parts = [agentName, `w${workerId}`, `pid${pid}`, timestamp, random]
  if (suffix) {
    parts.push(suffix)
  }

  return parts.join('-')
}

/**
 * Get port allocation info for debugging
 */
export function getPortAllocationInfo(): {
  workerId: number
  basePort: number
  portRange: string
  aliceRange: string
  bobRange: string
  witnessRange: string
} {
  const workerId = getWorkerId()
  const basePort = 20000 + workerId * 1000

  return {
    workerId,
    basePort,
    portRange: `${basePort}-${basePort + 999}`,
    aliceRange: `${basePort + AgentType.ALICE}-${basePort + AgentType.ALICE + 99}`,
    bobRange: `${basePort + AgentType.BOB}-${basePort + AgentType.BOB + 99}`,
    witnessRange: `${basePort + AgentType.WITNESS}-${basePort + AgentType.WITNESS + 99}`,
  }
}
