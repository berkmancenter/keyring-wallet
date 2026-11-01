/**
 * Whether something kept for an identity is an agent's own.
 *
 * Memberships, join requests and cards are kept by the identity that holds
 * them, and outlive the agent they came through: unlinking leaves them on the
 * phone, so linking that agent again shows them again. So each reader has to
 * ask whose they are. Being on the phone says nothing: a new agent read a
 * membership nothing tied to it as its own, said "You're a member", and could
 * not apply.
 *
 * Only reads are decided here. Nothing is removed for not being an agent's.
 *
 * @module trust-tasks/module/heldByAgent
 */
import { isAgentsOwnDid } from './agentOwnIdentity'
import { sameIdentity } from './didScid'

/**
 * Whether `identityDid` is held by `agentDid`: a persona of that agent's, or the
 * agent itself, which a community can name directly and which has no persona.
 * `personas` are all the phone's, every agent's.
 *
 * A persona kept from before agents names none, and counts for the agent of the
 * moment. So does a record that names no identity, which says nothing either
 * way; and, with no agent known yet, one with no persona.
 */
export function heldByAgent(
  identityDid: string | undefined,
  personas: { did: string; vtaDid?: string }[],
  agentDid: string | undefined
): boolean {
  if (!identityDid) return true
  const known = personas.filter((p) => sameIdentity(p.did, identityDid))
  if (known.length > 0) return known.some((p) => !p.vtaDid || p.vtaDid === agentDid)
  return !agentDid || isAgentsOwnDid(identityDid, agentDid)
}
