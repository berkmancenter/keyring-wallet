/**
 * Reading an agent's delegation record (plan §3.16, step 7.14): the `delegation` member of the agent's own
 * `memberProfile` record in a room, which carries its VDC grant and the agent's acceptance (§3.4). Any member who
 * reads the room verifies the pair before Keyring names an owner: the grant's `issuer` is the owner's persona, its
 * subject is the record's author, and the acceptance is the author's own, signed by it.
 *
 * Keyring only reads and verifies here. It never writes the record: the plugin does, as the agent, where the room's
 * profile lists `delegation` (step 7.15, Section C's RM6).
 *
 * The member's shape, decided here (the plan names the member and its two credentials, not their keys):
 * `delegation: { grant, acceptance }`, each the signed VDC as vdc.ts builds and verifies it.
 *
 * Pure apart from the proof verifier it is given: no storage, no network but what that verifier resolves.
 *
 * @module connected-agents/rooms/delegationRecord
 */

import { SignedVdc, VdcProblem, VdcProofVerifier, vdcShapeProblem, verifyVdcPair } from '../vdc'

export type DelegationCheck =
  | { ok: true; ownerDid: string }
  | { ok: false; reason: 'notListed' | 'absent' | 'subjectNotAuthor' | 'issuerNotPersona' | VdcProblem }

/** A DID as the DID syntax writes it, `did:<method>:<id>`. */
const DID_PATTERN = /^did:[a-z0-9]+:\S+$/

/**
 * Verify the `delegation` on an author's `memberProfile` record.
 *
 * - `notListed`: the room's profile does not list `delegation` in `recordMembers`; the body is not read at all.
 * - `absent`: the body has no `delegation` member.
 * - `subjectNotAuthor`: the grant is to someone other than the record's author.
 * - `issuerNotPersona`: the grant's issuer is not a DID, or is the author itself (an agent cannot vouch for itself).
 *   Keyring cannot tell a persona DID from any other DID by its text, so this is the most it checks; the owner's name
 *   is then resolved from `ownerDid` the way Keyring resolves any member.
 * - `valid-from` / `valid-until`: the grant or the acceptance is not yet valid, or has lapsed, at `now`. A reader
 *   judges validity: after Revoke a copy stays valid only to its `validUntil` (§3.4).
 * - Otherwise {@link verifyVdcPair}'s reason, run with `ownerPersonaDid` the grant's `issuer` and `agentDid` the author:
 *   an acceptance by another DID is `wrong-issuer`, one whose proof is not the author's is `acceptance-proof`.
 */
export async function verifyDelegationRecord(input: {
  profileBody: Record<string, unknown>
  authorDid: string
  roomListsDelegation: boolean
  verify: VdcProofVerifier
  now: number
}): Promise<DelegationCheck> {
  if (!input.roomListsDelegation) return { ok: false, reason: 'notListed' }
  const delegation = input.profileBody.delegation
  if (delegation === undefined || delegation === null) return { ok: false, reason: 'absent' }
  if (typeof delegation !== 'object' || Array.isArray(delegation)) return { ok: false, reason: 'not-an-object' }
  const { grant, acceptance } = delegation as { grant?: unknown; acceptance?: unknown }

  const grantProblem = vdcShapeProblem(grant, 'grant')
  if (grantProblem) return { ok: false, reason: grantProblem }
  const acceptanceProblem = vdcShapeProblem(acceptance, 'acceptance')
  if (acceptanceProblem) return { ok: false, reason: acceptanceProblem }
  const g = grant as SignedVdc
  const a = acceptance as SignedVdc

  if (g.credentialSubject.id !== input.authorDid) return { ok: false, reason: 'subjectNotAuthor' }
  if (!DID_PATTERN.test(g.issuer) || g.issuer === input.authorDid) return { ok: false, reason: 'issuerNotPersona' }

  if (Date.parse(g.validFrom) > input.now || Date.parse(a.validFrom) > input.now)
    return { ok: false, reason: 'valid-from' }
  if (Date.parse(g.validUntil) <= input.now) return { ok: false, reason: 'valid-until' }

  const pair = await verifyVdcPair({
    grant: g,
    acceptance: a,
    ownerPersonaDid: g.issuer,
    agentDid: input.authorDid,
    verify: input.verify,
  })
  if (!pair.ok) return pair
  return { ok: true, ownerDid: g.issuer }
}
