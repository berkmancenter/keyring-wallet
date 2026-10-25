import { dropInMemoryKeys } from '@bifold/core'
import type { Agent } from '@credo-ts/core'

/**
 * Shut the agent down, dropping the persona keys borrowed for this session
 * first (#10): they live only in memory and must not outlive the session.
 * bifold core does this in its own agent setup, which Keyring doesn't use,
 * so every shutdown in the app goes through here.
 */
export async function shutdownAgent(agent: Agent): Promise<void> {
  try {
    await dropInMemoryKeys(agent)
  } catch {
    // Never keeps the agent running: the keys go with the process anyway.
  }
  await agent.shutdown()
}
