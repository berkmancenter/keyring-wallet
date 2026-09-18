/**
 * vtiInbox — what a community sends a persona that is not the answer to a
 * question: credentials.
 *
 * Measured on VTI-Eucalyptus-RC-0: after `allow`, the VTC no longer relies on
 * the verdict to carry the card. It sends the membership credential and the
 * role endorsement as two separate `credential-exchange/issue/0.1` messages
 * from a durable outbox (retried until acknowledged). A vetter's grant and a
 * vetter's statement arrive the same way. The payload is an OID4VCI
 * Credential Response carried verbatim (`credential_response.credential`, or
 * `credentials[]`), or `sealed` for a holder the issuer cannot name.
 *
 * This module classifies what arrived and keeps it; it never sends.
 *
 * @module trust-tasks/module/vtiInbox
 */

import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'

import type { VtiCommunityStore, VtiMembership } from './VtiCommunityStore'

export const CREDENTIAL_EXCHANGE_ISSUE = 'https://trusttasks.org/spec/credential-exchange/issue/0.1'
export const IDENTITY_VETTING_ENDORSEMENT_TYPE = 'https://firstperson.network/endorsements/identity-vetting/0.1'
export const COMMUNITY_ROLE_ENDORSEMENT_TYPE = 'CommunityRole'

export type VtiCredentialKind = 'membership' | 'role' | 'vetter-grant' | 'vetting-statement' | 'other'

export interface VtiReceivedCredential {
  kind: VtiCredentialKind
  /** The community that issued it (or, for a statement, the vetter's community). */
  communityDid: string
  /** Who it is about. */
  subjectDid: string
  credential: Record<string, unknown>
  receivedAt: string
}

const types = (vc: Record<string, unknown>): string[] =>
  Array.isArray(vc.type) ? vc.type.map(String) : vc.type ? [String(vc.type)] : []
const issuerOf = (vc: Record<string, unknown>): string =>
  typeof vc.issuer === 'string' ? vc.issuer : String((vc.issuer as { id?: string })?.id ?? '')
const subjectOf = (vc: Record<string, unknown>) => vc.credentialSubject as Record<string, unknown> | undefined

/** Pull the credentials out of a `credential-exchange/issue` document body. */
export function credentialsOfIssue(body: unknown): Record<string, unknown>[] {
  // The body is the Trust Task document (payload inside) when the message is
  // the binding envelope, and — measured on the train, where the VTC types the
  // message as the task itself — may also be the document or the bare payload.
  const b = (body ?? {}) as Record<string, unknown>
  const payload = ((b.payload as Record<string, unknown> | undefined) ?? b) as Record<string, unknown>
  const response = (payload.credential_response ?? payload.credentialResponse) as Record<string, unknown> | undefined
  if (!response) return []
  const out: Record<string, unknown>[] = []
  if (response.credential && typeof response.credential === 'object') out.push(response.credential as Record<string, unknown>)
  if (Array.isArray(response.credentials)) {
    for (const entry of response.credentials) {
      const c = (entry as { credential?: unknown })?.credential
      if (c && typeof c === 'object') out.push(c as Record<string, unknown>)
    }
  }
  return out
}

/** Say what a credential is, from its type and its endorsement body. */
export function classifyCredential(vc: Record<string, unknown>): VtiReceivedCredential {
  const t = types(vc)
  const subject = subjectOf(vc)
  const endorsement = subject?.endorsement as Record<string, unknown> | undefined
  let kind: VtiCredentialKind = 'other'
  let communityDid = issuerOf(vc)
  if (t.includes('MembershipCredential')) kind = 'membership'
  else if (t.includes('EndorsementCredential') && endorsement) {
    const et = String(endorsement.type ?? '')
    if (et === IDENTITY_VETTING_ENDORSEMENT_TYPE) {
      kind = 'vetting-statement'
      communityDid = String(endorsement.community ?? communityDid)
    } else if (et === COMMUNITY_ROLE_ENDORSEMENT_TYPE || endorsement.role !== undefined) {
      kind = String(endorsement.role ?? '') === 'vetter' ? 'vetter-grant' : 'role'
      communityDid = String(endorsement.communityDid ?? endorsement.community ?? communityDid)
    }
  }
  return {
    kind,
    communityDid,
    subjectDid: String(subject?.id ?? ''),
    credential: vc,
    receivedAt: new Date().toISOString(),
  }
}

/**
 * Keep what a community delivered. A membership credential becomes (or
 * completes) the membership record; a role endorsement fills in the role;
 * grants and statements are held as credentials in their own right.
 */
export async function receiveIssue(
  store: VtiCommunityStore,
  personaDid: string,
  plaintext: DidCommV2PlaintextMessage,
  options: { via?: VtiMembership['via'] } = {}
): Promise<VtiReceivedCredential[]> {
  const body = plaintext.body as { type?: string } | undefined
  const isIssue = plaintext.type === CREDENTIAL_EXCHANGE_ISSUE || body?.type === CREDENTIAL_EXCHANGE_ISSUE
  if (!isIssue) return []
  const received = credentialsOfIssue(body).map(classifyCredential)
  for (const item of received) {
    if (item.subjectDid && item.subjectDid !== personaDid) continue
    if (item.kind === 'membership') {
      const existing = await store.getMembership(item.communityDid)
      await store.saveMembership({
        communityDid: item.communityDid,
        personaDid,
        role: existing?.role ?? 'member',
        vmc: item.credential,
        roleVec: existing?.roleVec,
        grantedAt:
          typeof item.credential.validFrom === 'string' ? (item.credential.validFrom as string) : new Date().toISOString(),
        validUntil: typeof item.credential.validUntil === 'string' ? (item.credential.validUntil as string) : undefined,
        via: existing?.via ?? options.via ?? 'unknown',
      })
    } else if (item.kind === 'role') {
      const existing = await store.getMembership(item.communityDid)
      const role = String(((item.credential.credentialSubject as Record<string, unknown>)?.endorsement as Record<string, unknown>)?.role ?? 'member')
      if (existing) await store.saveMembership({ ...existing, role, roleVec: item.credential })
      else await store.saveHeldCredential({ ...item, kind: 'role' })
    } else {
      await store.saveHeldCredential({ ...item, kind: item.kind })
    }
  }
  return received
}
