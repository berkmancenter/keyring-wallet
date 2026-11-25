/**
 * vtiInvitation — an invitation as it reaches the phone.
 *
 * A community's admin issues an `InvitationCredential` to a DID
 * (`POST /v1/invitations`, or the `vtc/invitations/issue/0.1` task). Upstream
 * has no channel that delivers it to the invitee — the operator copies it.
 * Keyring's stand-in is a link the admin's console can show as a QR or send:
 *
 *   keyring://vti/invitation?c=<base64url(JSON InvitationCredential)>
 *
 * The phone opens the link (scan or tap), keeps the credential as a pending
 * invitation, and presents it when the person chooses to join. The link IS
 * the ask to upstream (§9 request 3): "push the invitation to the invitee's
 * DID over DIDComm", which would make this file unnecessary.
 *
 * @module trust-tasks/module/vtiInvitation
 */

import { TypedArrayEncoder } from '@credo-ts/core'

import type { VtiInvitation } from './VtiCommunityStore'

export const VTI_INVITATION_PATH = 'vti/invitation'

export function isVtiInvitationLink(url: string): boolean {
  return /^keyring:\/\/vti\/invitation(\?|$)/.test(url)
}

/** Build the link an admin console would show; the inverse of `parseVtiInvitationLink`. */
export function buildVtiInvitationLink(credential: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(credential))
  return `keyring://${VTI_INVITATION_PATH}?c=${TypedArrayEncoder.toBase64Url(bytes)}`
}

/** Read the credential out of the link and describe it as a pending invitation. */
export function parseVtiInvitationLink(url: string): VtiInvitation {
  if (!isVtiInvitationLink(url)) throw new Error('vtiInvitation: not an invitation link')
  const query = url.slice(url.indexOf('?') + 1)
  const encoded = new URLSearchParams(query).get('c')
  if (!encoded) throw new Error('vtiInvitation: the link carries no credential')
  // The link is base64url (no padding, URL-safe alphabet); the decoder wants base64.
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (encoded.length % 4)) % 4)
  const json = TypedArrayEncoder.toUtf8String(TypedArrayEncoder.fromBase64(base64))
  const credential = JSON.parse(json) as Record<string, unknown>
  return describeInvitation(credential)
}

/** What a person needs to know about an `InvitationCredential`, from the credential itself. */
export function describeInvitation(credential: Record<string, unknown>): VtiInvitation {
  const types = Array.isArray(credential.type) ? credential.type.map(String) : [String(credential.type)]
  if (!types.includes('InvitationCredential')) {
    throw new Error(`vtiInvitation: not an InvitationCredential (${types.join(',')})`)
  }
  const issuer = credential.issuer
  const communityDid = typeof issuer === 'string' ? issuer : String((issuer as { id?: string })?.id ?? '')
  const subject = credential.credentialSubject as { id?: string; scopes?: string[] } | undefined
  const subjectDid = String(subject?.id ?? '')
  if (!communityDid || !subjectDid) throw new Error('vtiInvitation: the credential names no issuer or subject')
  const role = (subject?.scopes ?? []).map((s) => s.replace(/^role:/, ''))[0] ?? 'member'
  return {
    id: String(credential.id ?? `urn:invitation:${communityDid}:${subjectDid}`),
    communityDid,
    subjectDid,
    role,
    credential,
    receivedAt: new Date().toISOString(),
    validUntil: typeof credential.validUntil === 'string' ? credential.validUntil : undefined,
    status: 'pending',
  }
}
