/**
 * When Keyring sends the member's acknowledgement (`vtiMemberVmc`): after an
 * admission is kept — by the join's own verdict or by the community's
 * delivery — and when the community asks for it (`request-vmc`). Best effort:
 * the membership stands without it, so a failure is logged, never thrown.
 *
 * @module trust-tasks/module/vtiReciprocate
 */
import type { Agent } from '@credo-ts/core'

import { verifyDocumentProof } from '@bifold/trust-tasks'

import type { VtiCommunityStore } from './VtiCommunityStore'
import type { VtiPersona } from './VtiIdentityStore'
import { vtiAgent } from './vtiAgent'
import { operationalDocument } from './vtiCommunityNotices'
import { reciprocateMembership, REQUEST_VMC, type MemberVmcSend, type ReciprocateOutcome } from './vtiMemberVmc'

/** The refusals that are about the `requestId`, not the credential: sent again without it. */
const REQUEST_REFUSALS = /requestNotFound|requestNotApproved|requestApplicantMismatch/

const codeOf = (e: unknown): string => {
  const o = e as { code?: unknown; message?: unknown } | undefined
  return `${String(o?.code ?? '')} ${String(o?.message ?? '')}`
}

/**
 * Send this persona's acknowledgement of its membership in `communityDid`, if
 * owed. Only over the session the persona is signed in as: the document must
 * be signed by the persona, and a session that is someone else's cannot.
 */
export async function reciprocateIfOwed(
  agent: Agent,
  store: VtiCommunityStore,
  persona: Pick<VtiPersona, 'did' | 'kmsKeyIds' | 'vtaKeyIds'>,
  communityDid: string,
  options: { force?: boolean; send?: MemberVmcSend; sessionDid?: () => string | undefined } = {}
): Promise<ReciprocateOutcome | 'notSignedIn' | 'failed'> {
  const sessionDid = options.sessionDid ?? (() => vtiAgent.did)
  if (sessionDid() !== persona.did || !persona.kmsKeyIds?.signing) return 'notSignedIn'
  const sendVia: MemberVmcSend = options.send ?? ((c, vc, r) => vtiAgent.sendMemberVmc(c, vc, r))
  // The join request this closes, when the phone sent one (vtc/members/vmc/0.1 `requestId`).
  const requestId = (await store.getSubmission?.(communityDid, persona.did).catch(() => undefined))?.requestId
  const send: MemberVmcSend = async (c, vc, r) => {
    try {
      return await sendVia(c, vc, r)
    } catch (e) {
      // A request the community no longer holds open must not stop the
      // credential: the delivery stands on its own without it.
      if (r && REQUEST_REFUSALS.test(codeOf(e))) return sendVia(c, vc, undefined)
      throw e
    }
  }
  try {
    return await reciprocateMembership({ agent, store, persona, communityDid, send, requestId, force: options.force })
  } catch (e) {
    agent.config?.logger?.warn?.(
      `[VTI] the member's acknowledgement was not delivered (${e instanceof Error ? e.message : String(e)}); it is sent again next time`
    )
    return 'failed'
  }
}

/**
 * A community asking this member to issue its acknowledgement again
 * (`vtc/members/request-vmc/0.1`, `{ communityDid, reason? }`): an admin's
 * `solicit-vmc`, typically because the edge is incomplete. Taken only as the
 * community's own signed operational document for this persona, as openvtc
 * answers it (message_dispatch.rs:1537-1570), and answered with the
 * acknowledgement this membership already has, or a new one for a renewed
 * grant. `undefined` when the message is something else.
 */
export async function receiveRequestVmc(
  agent: Agent,
  store: VtiCommunityStore,
  persona: Pick<VtiPersona, 'did' | 'kmsKeyIds' | 'vtaKeyIds'>,
  message: { type?: unknown; from?: unknown; body?: unknown },
  options: {
    now?: number
    verify?: (doc: Record<string, unknown>, issuer: string) => Promise<boolean>
    send?: MemberVmcSend
    sessionDid?: () => string | undefined
  } = {}
): Promise<ReciprocateOutcome | 'notSignedIn' | 'failed' | 'ignored' | undefined> {
  if (message.type !== REQUEST_VMC) return undefined
  const ignore = (why: string) => {
    agent.config?.logger?.warn?.(`[VTI] ignored a request for the member's acknowledgement (${why})`, {
      from: String(message.from ?? ''),
    })
    return 'ignored' as const
  }
  const checked = operationalDocument(message, REQUEST_VMC, persona.did, options.now)
  if ('reason' in checked) return ignore(checked.reason)
  const community = String(message.from)
  const named = checked.doc.payload?.communityDid
  if (named !== undefined && named !== community) return ignore('it names another community')
  const verify =
    options.verify ??
    ((d: Record<string, unknown>, issuer: string) =>
      verifyDocumentProof(agent, d, issuer, { proofPurpose: 'authentication' }))
  if (!(await verify(checked.doc, community))) return ignore('its proof does not verify under the community')
  return reciprocateIfOwed(agent, store, persona, community, {
    force: true,
    send: options.send,
    sessionDid: options.sessionDid,
  })
}
