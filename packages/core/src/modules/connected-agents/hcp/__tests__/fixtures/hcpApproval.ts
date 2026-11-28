/**
 * A well-formed HCP grant consent request, as `vtaAgent` lists it, for the link of the match-number vectors' first
 * case. Tests change one thing at a time from it.
 */
import type { VtiApproval } from '../../../../trust-tasks/module/vtaAgent'
import { HCP_GRANTS_REQUEST, type HcpConnectLink } from '../../types'

export const CLIENT_VID = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
export const OTHER_VID = 'did:key:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp'
export const UUID = '7c2a9e41-5b3d-4f6a-8e1c-0a9b8d7c6e51'
export const THREAD = `urn:uuid:${UUID}`
export const OTHER_THREAD = 'urn:uuid:0f8c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f'
export const GRANT = 'urn:uuid:3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b'
/** The match number of THREAD and CLIENT_VID (the vectors' first case). */
export const NUMBER = '2644'

export const LINK: HcpConnectLink = { clientVid: CLIENT_VID, uuid: UUID, threadId: THREAD }

/** The instant the fixture's VTA held the request; the approval expires 5 minutes later. */
export const HELD_AT = Date.parse('2026-11-27T10:00:00.000Z')

/** The grant's expiry the fixture's `hcpGrantTerm` names: 4 hours after the hold. */
export const GRANT_EXPIRES_AT = '2026-11-27T14:00:00Z'

/** The summaries of {@link hcpEffects}, in order: the approve view's rows. */
export const ROWS = [
  'Run by Example Labs.',
  'It can read your general preferences.',
  'To tailor its answers.',
  'It can keep what it reads for up to 10 minutes after reading it.',
  'For 4 hours from when you approve.',
  'It follows the instructions you give it about answering.',
]

/** A consent request's effects as VTI hcp.md §5.1 (VTI 216fd014b) has the VTA write them: no `grantId`. */
export function hcpEffects(): Record<string, unknown>[] {
  return [
    {
      kind: 'hcpClient',
      summary: ROWS[0],
      detail: { clientId: CLIENT_VID, name: 'hcp-cli', operator: { id: 'did:web:labs.example', name: 'Example Labs' } },
    },
    {
      kind: 'hcpCategory',
      summary: ROWS[1],
      detail: { category: 'general_preferences', description: 'General preferences', actions: ['read'] },
    },
    {
      kind: 'hcpPurpose',
      summary: ROWS[2],
      detail: {
        purpose: 'https://registry.trustoverip.org/dtg/purpose/personalisation/1',
        description: 'tailor its answers',
      },
    },
    { kind: 'hcpUseUntil', summary: ROWS[3], detail: { maxUseSeconds: 600 } },
    { kind: 'hcpGrantTerm', summary: ROWS[4], detail: { persistence: 'temporary', expiresAt: GRANT_EXPIRES_AT } },
    { kind: 'hcpDirectives', summary: ROWS[5], detail: { followsDirectives: true } },
  ]
}

export function hcpApproval(change: Partial<VtiApproval> = {}): VtiApproval {
  return {
    id: 'consent-1',
    receivedAt: new Date(HELD_AT).toISOString(),
    status: 'pending',
    challenge: 'challenge-1',
    taskType: HCP_GRANTS_REQUEST,
    payloadDigest: 'digest-1',
    requester: CLIENT_VID,
    approverSet: 'owner',
    minApprovals: 1,
    expiresAt: new Date(HELD_AT + 5 * 60 * 1000).toISOString(),
    effects: hcpEffects(),
    // The document's parentThreadId, which vtaAgent keeps: the held grants/request's threadId.
    parentThreadId: THREAD,
    ...change,
  }
}
