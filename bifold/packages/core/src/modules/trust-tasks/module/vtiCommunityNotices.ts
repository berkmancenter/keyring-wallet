/**
 * What a community pushes a member that is neither a card nor an answer to a
 * question: that it removed them, and that it received their join request.
 *
 * - `vtc/members/removal-notice/0.1`: sent after an admin removal or a purge
 *   has taken effect (vtc-service ceremony/removal_notice.rs, orchestrate.rs
 *   remove_inner and the purge), to the member's persona DID, never for a
 *   member who left on their own. Unsolicited: no thread.
 * - `vtc/join-requests/submit-receipt/0.1`: sent when a join decided from a
 *   `credential-exchange/present` answers a community's query, threaded on it
 *   (vtc-service trust_tasks/credential_exchange.rs `handle_present`).
 *
 * Both come through the VTC's push engine (TSP, then DIDComm, then REST, the
 * same document each time) as operational documents: signed by the community
 * under `authentication`, addressed to the persona, with no reply expected.
 * Keyring ignored both. openvtc checks and applies them
 * (openvtc-core operational.rs `check_envelope`, messaging.rs
 * `handle_member_removal_notice`, `handle_join_submit_receipt`).
 *
 * A notice is applied only once and only to the membership it is about: it
 * must be decided after that membership was granted, so a notice replayed
 * after the person joined again changes nothing. openvtc keeps a set of seen
 * notice ids for the same purpose.
 *
 * @module trust-tasks/module/vtiCommunityNotices
 */
import type { Agent } from '@credo-ts/core'
import { verifyDocumentProof } from '@bifold/trust-tasks'
import { DeviceEventEmitter } from 'react-native'

import { didPrefix } from './didPrefix'
import { recordStatus } from './joinSubmission'
import type { VtiCommunityStore, VtiRemoval } from './VtiCommunityStore'

export const REMOVAL_NOTICE = 'https://trusttasks.org/spec/vtc/members/removal-notice/0.1'
export const SUBMIT_RECEIPT = 'https://trusttasks.org/spec/vtc/join-requests/submit-receipt/0.1'

/** A community removed this persona: `{ communityDid, reason? }`, for a notice in plain words. */
export const VTI_REMOVED_EVENT = 'vti:removed'

/** How old a notice may be (openvtc operational.rs:51-52, 87-94): a removal notice travels up to 30 days. */
const MAX_AGE_MS = { [REMOVAL_NOTICE]: 31 * 24 * 3600 * 1000, [SUBMIT_RECEIPT]: 24 * 3600 * 1000 }
/** How far ahead of this phone's clock an `issuedAt` may be. */
const FUTURE_SKEW_MS = 5 * 60 * 1000

export type VtiNoticeOutcome = 'removed' | 'acknowledged' | 'ignored'

type Document = Record<string, unknown> & { payload?: Record<string, unknown> }

/**
 * The document, if it is the community's own operational document of `type`
 * for `personaDid`: everything openvtc's `check_envelope` asks except the
 * proof, which the caller verifies. The reason otherwise, for the log.
 */
export function operationalDocument(
  message: { type?: unknown; from?: unknown; body?: unknown },
  type: typeof REMOVAL_NOTICE | typeof SUBMIT_RECEIPT,
  personaDid: string,
  now = Date.now()
): { doc: Document } | { reason: string } {
  const doc = message.body as Document | undefined
  if (!doc || typeof doc !== 'object' || !doc.payload || typeof doc.payload !== 'object')
    return { reason: 'not a signed Trust Task document' }
  if (doc.type !== type) return { reason: 'the document is of another type' }
  if (typeof doc.id !== 'string' || !doc.id || doc.id.length > 256) return { reason: 'no document id' }
  if (typeof message.from !== 'string' || doc.issuer !== message.from)
    return { reason: 'its issuer is not the community that sent it' }
  if (doc.recipient !== personaDid) return { reason: 'addressed to someone else' }
  const issuedAt = Date.parse(String(doc.issuedAt ?? ''))
  if (!Number.isFinite(issuedAt) || issuedAt > now + FUTURE_SKEW_MS || now - issuedAt > MAX_AGE_MS[type])
    return { reason: 'too old, or dated in the future' }
  if (doc.expiresAt !== undefined && !(Date.parse(String(doc.expiresAt)) > now)) return { reason: 'expired' }
  return { doc }
}

const DISPOSITIONS = ['purge', 'tombstone', 'historical'] as const
const CODES = ['adminRemoved', 'purged'] as const

function removalOf(doc: Document): VtiRemoval | undefined {
  const p = doc.payload ?? {}
  if (!CODES.includes(p.code as (typeof CODES)[number])) return undefined
  if (!DISPOSITIONS.includes(p.disposition as (typeof DISPOSITIONS)[number])) return undefined
  if (typeof p.decidedBy !== 'string' || !p.decidedBy) return undefined
  if (!Number.isFinite(Date.parse(String(p.decidedAt ?? '')))) return undefined
  if (p.reason !== undefined && (typeof p.reason !== 'string' || p.reason.length > 1024)) return undefined
  return {
    code: p.code as VtiRemoval['code'],
    reason: typeof p.reason === 'string' && p.reason ? p.reason : undefined,
    decidedBy: p.decidedBy,
    decidedAt: String(p.decidedAt),
    disposition: p.disposition as VtiRemoval['disposition'],
    noticeId: String(doc.id),
  }
}

/**
 * Apply a community's removal notice or submit receipt to what this phone
 * holds for `personaDid`. Returns undefined for any other message, so the
 * caller goes on to its other handlers.
 */
export async function receiveCommunityNotice(
  agent: Agent,
  store: VtiCommunityStore,
  personaDid: string,
  message: { type?: unknown; from?: unknown; body?: unknown },
  options: {
    now?: number
    /** The proof check; by default the community's `authentication` key. */
    verify?: (doc: Document, issuer: string) => Promise<boolean>
  } = {}
): Promise<VtiNoticeOutcome | undefined> {
  const type = message.type
  if (type !== REMOVAL_NOTICE && type !== SUBMIT_RECEIPT) return undefined
  const log = (why: string) => {
    agent.config?.logger?.warn?.(
      `[VTI] ignored a ${type === REMOVAL_NOTICE ? 'removal notice' : 'join receipt'} (${why})`,
      {
        from: String(message.from ?? ''),
      }
    )
    return 'ignored' as const
  }
  const checked = operationalDocument(message, type, personaDid, options.now)
  if ('reason' in checked) return log(checked.reason)
  const { doc } = checked
  const community = String(message.from)
  const verify =
    options.verify ??
    ((d: Document, issuer: string) => verifyDocumentProof(agent, d, issuer, { proofPurpose: 'authentication' }))
  if (!(await verify(doc, community))) return log('its proof does not verify under the community')

  if (type === REMOVAL_NOTICE) {
    const removal = removalOf(doc)
    if (!removal) return log('malformed')
    if (doc.payload?.did !== personaDid) return log('about someone else')
    const membership = await store.getMembership(community)
    if (!membership || membership.personaDid !== personaDid) return log('no membership for it')
    if (membership.removal) return log('already removed')
    // Decided before this membership was granted: about an earlier one.
    if (Date.parse(removal.decidedAt) < Date.parse(membership.grantedAt)) return log('about an earlier membership')
    await store.saveMembership({ ...membership, removal })
    agent.config?.logger?.info?.(`[VTI] applied a removal notice from ${didPrefix(community)} (${removal.code})`)
    DeviceEventEmitter.emit(VTI_REMOVED_EVENT, { communityDid: community, reason: removal.reason })
    return 'removed'
  }

  const requestId = doc.payload?.requestId
  const status = doc.payload?.status
  if (typeof requestId !== 'string' || !requestId || typeof status !== 'string' || !status) return log('malformed')
  const recorded = await recordStatus(store, community, { requestId, status })
  if (!recorded) return log('no join request for it')
  agent.config?.logger?.info?.(`[VTI] applied a join receipt from ${didPrefix(community)} (${status})`)
  return 'acknowledged'
}
