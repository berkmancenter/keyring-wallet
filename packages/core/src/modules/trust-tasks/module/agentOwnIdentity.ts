/**
 * An agent's own DID is never one of this phone's identities.
 *
 * A community can name the agent itself as a member: an admin console's wallet
 * invite sent to the agent's DID, and the community's cards issued to it. Taken
 * on as a persona (Bring back), the phone then signed in to the mediator as the
 * agent. A mediator keeps one live connection per DID, newest wins, so the
 * phone took the agent's inbox: what the phone sent its agent came back to the
 * phone, and the agent answered nothing (`agentUnreachable`) for as long as the
 * phone held it.
 *
 * So the agent's own DID is not taken on, not listed among the phone's
 * identities and not signed in as; only an identity's keys are borrowed.
 * Signing in to a community as the agent is still offered: that goes through
 * the agent, which signs as itself.
 *
 * @module trust-tasks/module/agentOwnIdentity
 */
import { sameIdentity } from './didScid'

/** Whether `did` is the agent `vtaDid` itself, in either of its forms (didScid). */
export function isAgentsOwnDid(did: string, vtaDid: string | undefined): boolean {
  return Boolean(vtaDid) && sameIdentity(did, vtaDid as string)
}

/** Whether a persona record is its own agent's DID. */
export const isAgentsOwnPersona = (persona: { did: string; vtaDid?: string }): boolean =>
  isAgentsOwnDid(persona.did, persona.vtaDid)

/** The DID a key id belongs to: `did:…#key-1` → `did:…`. */
export const didOfKeyId = (keyId: string): string => keyId.split('#')[0]
