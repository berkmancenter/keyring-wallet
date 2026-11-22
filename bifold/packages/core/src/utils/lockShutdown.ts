import { AskarStoreManager } from '@credo-ts/askar'
import type { Agent } from '@credo-ts/core'

/**
 * How long a new agent start waits for the last lock-out's shutdown before treating the old store as in an unknown
 * state. The draft flush the shutdown waits for is capped at 1 s (DRAFT_FLUSH_TIMEOUT_MS, modules/chat/draft.ts), and
 * a healthy `agent.shutdown()` takes well under that; 10 s is an order of magnitude past the normal case. A shutdown
 * still running at that point has not released the store, so the start refuses rather than proceeds.
 */
export const LOCK_SHUTDOWN_WAIT_MS = 10_000

/** The shutdown a lock-out started: the agent it shuts down, and the promise that settles when it is done. */
export interface LockShutdown {
  agent?: Agent | null
  done: Promise<unknown>
}

/**
 * Whether a new agent may start after a lock-out: only on positive evidence that the old agent's Askar store is
 * closed. Every other outcome refuses, and the person relaunches, which releases the store with the process.
 *
 * Why the store is checked rather than the shutdown trusted, as the credo in this tree behaves (0.7.1-pr-2704):
 * - `Agent.shutdown()` (build/agent/Agent.mjs:67-72) runs `shutdownModules`, then `closeAgentContext`, with no
 *   try/finally; `shutdownModules` (DependencyManager.mjs:45-52) rethrows at the first module that throws, so
 *   `closeAgentContext`, which closes the store, never runs.
 * - `closeAgentContext` (DependencyManager.mjs:95-107) also stops at the first module's `onCloseContext` that throws.
 * - The shutdown helpers swallow those errors (useBifoldAgentSetup's and the wallet's shutdownAndClearAgentIfExists
 *   log and resolve), so the promise resolving says nothing about the store.
 * So the store manager is asked directly (`isStoreOpen`, AskarStoreManager.mjs:28-30) and, if it is still open, closed
 * directly (`closeStore`, :277, which unregisters the Store on success), touching no other module's hooks. Any
 * exception on the way, including a store manager that cannot be resolved, is not evidence, and refuses.
 * A credo upgrade must re-read those four methods: lockShutdown.credo.test.ts fails when their behaviour changes.
 */
export async function oldStoreClosed(shutdown: LockShutdown, waitMs: number = LOCK_SHUTDOWN_WAIT_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const outcome = await Promise.race([
    shutdown.done.then(
      () => 'settled' as const,
      () => 'settled' as const
    ),
    new Promise<'hung'>((resolve) => (timer = setTimeout(() => resolve('hung'), waitMs))),
  ])
  clearTimeout(timer)
  if (outcome === 'hung') return false
  // No agent at the lock-out: nothing it could have left open.
  const agent = shutdown.agent
  if (!agent) return true
  try {
    const stores = agent.dependencyManager.resolve(AskarStoreManager)
    if (stores.isStoreOpen(agent.context)) await stores.closeStore(agent.context)
    return !stores.isStoreOpen(agent.context)
  } catch {
    return false
  }
}
