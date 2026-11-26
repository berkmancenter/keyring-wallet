/**
 * The agent this phone acts with now: the linked VTA's DID, or none.
 *
 * Kept here, apart from `vtaAgent`, so the stores can read it without importing
 * the agent's controller (which imports them). `vtaAgent` writes it whenever its
 * link changes; a store that is asked for "this community's identity" answers
 * for this agent.
 *
 * @module trust-tasks/module/currentAgent
 */

let current: string | undefined

/** The linked agent's DID, if this phone is linked. */
export const currentAgentDid = (): string | undefined => current

/** Set by `vtaAgent` when its link changes (and by tests). */
export function setCurrentAgentDid(vtaDid: string | undefined): void {
  current = vtaDid
}
