/**
 * The HCP demo's types and task URIs (step 7.27 track C). Hand-written: Keyring has no `hcp/*` types package. The
 * `detail` shapes are those the VTA puts on the five effects of the consent request it sends for an HCP grant.
 *
 * @module connected-agents/hcp/types
 */

/** A read HCP connect link: `https://link.trustoverip.org/t#_from=<clientVid>&_id=<uuid>&_type=/vti/flow/hcp-connect/0.1`. */
export interface HcpConnectLink {
  /** The CLI's VID, an Ed25519 `did:key`. */
  clientVid: string
  /** The request's thread, a lower-case v4 UUID. */
  uuid: string
  /** `urn:uuid:` followed by `uuid`: the `grants/request` document's `threadId`. */
  threadId: string
}

/** `detail` of the `hcpGrantClient` effect. */
export interface HcpGrantClientDetail {
  clientVid: string
  clientName: string
  operator: { id: string; name: string }
  threadId: string
  grantId: string
}

/** `detail` of the `hcpGrantAccess` effect. */
export interface HcpGrantAccessDetail {
  access: { actions: string[]; categories: string[]; purposes: { code: string; description: string }[] }[]
}

/** `detail` of the `hcpGrantUseUntil` effect. */
export interface HcpGrantUseUntilDetail {
  maxUseSeconds: number
}

/** `detail` of the `hcpGrantTerm` effect. */
export interface HcpGrantTermDetail {
  grantType: 'temporary'
  expiresInSeconds: number
}

/** What the approve screen shows (part 2): copy keys and parameters, never formatted text. */
export type HcpApprovalView = {
  /** "Connect "<name>"?" */
  title: { key: 'ApproveTitle'; params: { name: string } }
  /** The five effects' summaries, verbatim, in order. */
  rows: string[]
  /** "Only continue if you ran the command…" */
  warning: { key: 'ApproveOwnTerminal' }
  approve: { key: 'Approve' }
  clientVid: string
  grantId: string
  threadId: string
  expiresInSeconds: number
}

/** Whether the client has been told of a revoke (part 3). Times are ISO-8601 instants. */
export type HcpNoticeState =
  | { state: 'telling'; lastPolledAt?: string }
  /** `at`: `usableUntil` from the summary, the time of delivery. */
  | { state: 'told'; at: string }
  | { state: 'notTold'; usableUntil: string }

/** The record Keyring keeps of an approved HCP grant (part 3). Times are ISO-8601 instants. */
export type HcpConnection = {
  /** The client's VID. */
  id: string
  /** The name the person gave. */
  name: string
  grantId: string
  threadId: string
  /** When `decide(approve)` resolved. */
  approvedAt: string
  /** `approvedAt` + `expiresInSeconds`. */
  expiresAt: string
  revokedAt?: string
  notice?: HcpNoticeState
}

// version-pinned: the hcp suite is pinned at 0.1 (suite 4e2dd42fa); the VTA serves this version only
export const HCP_GRANTS_REQUEST = 'https://trusttasks.org/spec/hcp/grants/request/0.1'
// version-pinned: the hcp suite is pinned at 0.1 (suite 4e2dd42fa); the VTA serves this version only
export const HCP_ENTRIES_CREATE = 'https://trusttasks.org/spec/hcp/entries/create/0.1'
// version-pinned: the hcp suite is pinned at 0.1 (suite 4e2dd42fa); the VTA serves this version only
export const HCP_GRANTS_REVOKE = 'https://trusttasks.org/spec/hcp/grants/revoke/0.1'
// version-pinned: the hcp suite is pinned at 0.1 (suite 4e2dd42fa); the VTA serves this version only
export const HCP_DISCLOSURES_SUMMARY = 'https://trusttasks.org/spec/hcp/disclosures/summary/0.1'

/** The five effect kinds of an HCP grant's consent request, in the order the VTA sends them. */
export const HCP_EFFECT_KINDS = [
  'hcpGrantClient',
  'hcpGrantAccess',
  'hcpGrantUseUntil',
  'hcpGrantTerm',
  'hcpGrantNotSignIn',
] as const

export type HcpEffectKind = (typeof HCP_EFFECT_KINDS)[number]
