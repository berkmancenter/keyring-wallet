/**
 * The HCP demo's types and task URIs (step 7.27 track C). Hand-written: Keyring has no `hcp/*` types package. The
 * `detail` shapes are those the VTA puts on the effects of the consent request it sends for an HCP grant: the V0
 * contract published in VTI `docs/05-design-notes/hcp.md` §5.1.
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

/**
 * The Client Operator as the VTA reports it in the `hcpClient` effect (VTI hcp.md §5.1: "from VTA configuration"). Kept
 * as received and shown only; never derived on the phone. Its source is replaceable: today the VTA's configuration, later
 * (V1) the community that vouches for the client, or the VTC that hosts the person's VTA. hcp.md does not fix its shape,
 * so a text value or an object with an `id` and/or a `name` is read.
 */
export type HcpOperator = string | { id?: string; name?: string }

/** `detail` of the `hcpClient` effect (one per request; VTI hcp.md §5.1). */
export interface HcpClientDetail {
  /** The client VID. */
  clientId: string
  /** The client's name as the request gives it (Keyring shows the name the person typed, never this). */
  name: string
  operator: HcpOperator
  /** Not in the §5.1 contract: read only if a VTA sends it, as the grant's id known before approval. */
  grantId?: string
  /** Not in the §5.1 contract: read only if a VTA sends it, as a second way to match the scanned thread. */
  threadId?: string
}

/** `detail` of an `hcpCategory` effect (one per requested category). */
export interface HcpCategoryDetail {
  /** A slug or a URI. */
  category: string
  description: string
  /** The HCP actions asked for this category. */
  actions: string[]
}

/** `detail` of an `hcpPurpose` effect (one per requested purpose; `choose: true` when the request names none). */
export interface HcpPurposeDetail {
  /** The purpose IRI. */
  purpose: string
  description: string
  choose?: boolean
}

/** `detail` of the `hcpUseUntil` effect. */
export interface HcpUseUntilDetail {
  /** The longest `useUntil` a disclosure may carry, in seconds. */
  maxUseSeconds: number
}

/** `detail` of the `hcpGrantTerm` effect. */
export interface HcpGrantTermDetail {
  /** `temporary` in V0. */
  persistence: string
  /** RFC 3339. */
  expiresAt: string
}

/** `detail` of the `hcpDirectives` effect. */
export interface HcpDirectivesDetail {
  followsDirectives: boolean
}

/** What the approve screen shows (part 2): copy keys and parameters, never formatted text. */
export type HcpApprovalView = {
  /** "Connect "<name>"?" */
  title: { key: 'ApproveTitle'; params: { name: string } }
  /** Every effect's summary, verbatim, in the order the VTA sent them (an unknown kind included). */
  rows: string[]
  /** "Only continue if you ran the command…" */
  warning: { key: 'ApproveOwnTerminal' }
  /**
   * "Approving gives access. It is not signing in." Keyring's own line, on every HCP consent whatever effects arrive:
   * never an effect (the old `hcpGrantNotSignIn` kind is gone), as the VTA maintainer confirmed.
   */
  notSignIn: { key: 'ApproveNotSignIn' }
  approve: { key: 'Approve' }
  clientVid: string
  /** The grant's id, when the request carried one; otherwise learnt after approval (see `./grantId.ts`). */
  grantId?: string
  /** The scanned thread, the request's `threadId`, which the consent request names as `parentThreadId`. */
  threadId: string
  /** The grant's expiry, from the `hcpGrantTerm` effect. */
  expiresAt: string
  /** The Client Operator as the VTA reported it (`hcpClient`), display-only. */
  operator: HcpOperator
  /** `hcpGrantTerm.persistence` (`temporary` in V0): nothing may offer or imply a persistent grant unless it says so. */
  persistence: string
  /**
   * Present when the request names no purpose: the `hcpPurpose` effects with `choose: true` are options the person
   * picks from, not facts, so they are not among `rows`. Approve needs a choice first ({@link chosenPurpose}).
   */
  purposeChoice?: { key: 'ApproveChoosePurpose'; options: { purpose: string; description: string; summary: string }[] }
  /** The purpose IRI the person chose among `purposeChoice.options`. */
  chosenPurpose?: string
}

/**
 * Whether the client has been told of a revoke (part 3). Times are ISO-8601 instants. Read from the audit log by our
 * grant (`revoke.ts`), else from the summary. Every state but `telling` is final.
 */
export type HcpNoticeState =
  | { state: 'telling'; lastPolledAt?: string }
  /** `at`: the `revocation.notified` event's `timestamp`, else the summary's `usableUntil` (the time of delivery). */
  | { state: 'told'; at: string }
  /** `usableUntil`: the last time anything disclosed under the grant stays usable. */
  | { state: 'notTold'; usableUntil: string }
  /**
   * Nothing was disclosed to the client under this grant, so no notice is due (HCP 6.2.2): no `context.read` for the
   * grant with a non-empty `disclosed`, or, from the summary, no entry for the client or this `grantId` not in its
   * `grants`. The line reads only "Revoked.". The "Telling…" proposal calls this state `nothingToTell`; #1125's name
   * and copy key (`RevokeNothingDisclosed`) are kept.
   */
  | { state: 'nothingDisclosed' }
  /** The grant had expired before the revoke reached the VTA: no `grant.revoked` event for it, so no notice. */
  | { state: 'ended' }
  /** The client had relinquished the grant itself (`grant.revoked` initiated by the context client): no notice. */
  | { state: 'disconnected' }

/** The record Keyring keeps of an approved HCP grant (part 3). Times are ISO-8601 instants. */
export type HcpConnection = {
  /** The client's VID. */
  id: string
  /** The name the person gave. */
  name: string
  /**
   * The grant's id. Absent until it is learnt when the request carried none (VTI hcp.md §5.1 pre-assigns none): read
   * from the client's `grant.issued` audit event (`./grantId.ts`), then kept here.
   */
  grantId?: string
  threadId: string
  /** When `decide(approve)` resolved. */
  approvedAt: string
  /** The `hcpGrantTerm` effect's `expiresAt`. */
  expiresAt: string
  /** The purpose the person chose, when the request named none. */
  chosenPurpose?: string
  revokedAt?: string
  notice?: HcpNoticeState
  /**
   * The newest `usableUntil` a notice poll read for this client, kept beside `notice` so that the 24-hour stop settles
   * a notice with the same time whether or not the app restarted while it was polling.
   */
  lastUsableUntil?: string
  /**
   * The summary fallback's first answer for the client after the revoke (its `notification` and `usableUntil`): an
   * `abandoned` notice still the same is taken to be stale, from before the revoke, and keeps `telling`.
   */
  summaryAtRevoke?: { notification: 'delivered' | 'abandoned' | 'none'; usableUntil: string | null }
}

/**
 * An HCP approval in flight (part 3): written before `decide(approve)` is called, under its own kind in the same
 * store and keyed by `grantId`, so an existing connection for the client, and an earlier approval in flight for it,
 * are left as they are until the new one is confirmed. It names the grant the approval would create: if the approval
 * fails, or the app stops before the connection is written, the reconcile completes it or revokes the grant by
 * `grantId`. Times are ISO-8601 instants.
 */
export type HcpApprovalInFlight = {
  /** The client's VID. */
  id: string
  /** The name the person gave. */
  name: string
  /** The grant the approval creates, when the request named it; else learnt later. */
  grantId?: string
  /** The scanned thread: this record's key, since it names exactly one request and so one grant. */
  threadId: string
  /** The consent request being approved. */
  approvalId: string
  /** The consent request's own `expiresAt`: it cannot be approved after this. */
  approvalExpiresAt: string
  /** The grant's expiry, from the `hcpGrantTerm` effect. */
  expiresAt: string
  /** The purpose the person chose, when the request named none. */
  chosenPurpose?: string
  /** When this record was written, just before `decide(approve)`. */
  startedAt: string
}

/**
 * A grant whose connection a newer approval for the same client replaced while the grant may still be live (part 3):
 * written in the same step as the new connection, under its own kind, keyed by `grantId`; the reconcile revokes it.
 * Times are ISO-8601 instants.
 */
export type HcpRetiringGrant = {
  /** The client's VID. */
  id: string
  name: string
  /** As on the connection it was: absent if never learnt. */
  grantId?: string
  threadId: string
  /** The grant's expiry, when known: once passed there is nothing left to revoke. */
  expiresAt?: string
  /** When it was approved: where its `grantId` is looked for if never learnt. */
  approvedAt?: string
  /** When the newer connection replaced it. */
  retiredAt: string
}

// version-pinned: the hcp suite is pinned at 0.1 (suite 4e2dd42fa); the VTA serves this version only
export const HCP_GRANTS_REQUEST = 'https://trusttasks.org/spec/hcp/grants/request/0.1'
// version-pinned: the hcp suite is pinned at 0.1 (suite 4e2dd42fa); the VTA serves this version only
export const HCP_ENTRIES_CREATE = 'https://trusttasks.org/spec/hcp/entries/create/0.1'
// version-pinned: the hcp suite is pinned at 0.1 (suite 4e2dd42fa); the VTA serves this version only
export const HCP_GRANTS_REVOKE = 'https://trusttasks.org/spec/hcp/grants/revoke/0.1'
// version-pinned: the hcp suite is pinned at 0.1 (suite 4e2dd42fa); the VTA serves this version only
export const HCP_DISCLOSURES_SUMMARY = 'https://trusttasks.org/spec/hcp/disclosures/summary/0.1'

/**
 * The effect kinds of an HCP grant's consent request: the V0 contract of VTI `docs/05-design-notes/hcp.md` §5.1, as at
 * VTI commit 216fd014b (blob 06537e4f6f8579a993996d6def00440b3fb10fe0). Against the earlier five: `hcpClient` and
 * `hcpUseUntil` rename `hcpGrantClient` and `hcpGrantUseUntil`; `hcpGrantTerm` keeps its name with the detail
 * `{ persistence, expiresAt }`; `hcpGrantAccess` splits into one `hcpCategory` per category and one `hcpPurpose` per
 * purpose; `hcpDirectives` is new; `hcpGrantNotSignIn` is gone. Any other kind is shown by its `summary`.
 */
export const HCP_EFFECT_KINDS = [
  'hcpClient',
  'hcpCategory',
  'hcpPurpose',
  'hcpUseUntil',
  'hcpGrantTerm',
  'hcpDirectives',
] as const

export type HcpEffectKind = (typeof HCP_EFFECT_KINDS)[number]
