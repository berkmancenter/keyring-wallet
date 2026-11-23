/**
 * What the "Show a code" screen reads about one code this phone shows (Keyring as the inviter, plan WP9): the
 * contract between the inviter core and the screen, agreed with the screen's lane. Types only.
 *
 * @module trust-tasks/module/sharedConnectInviteTypes
 */

export type SharedConnectInviteState =
  /** Minting the encounter DID and opening its relay session. */
  | 'minting'
  /** The code is live: show it. */
  | 'waiting'
  /** A valid propose arrived; the consent sheet (RelationshipProposalModal, root-mounted) is asking. */
  | 'proposed'
  /** Accepted; the documents are in flight. May run past `_exp`, up to the same grace the scanner side keeps. */
  | 'connecting'
  | 'connected'
  /** `_exp` passed with nothing accepted. Set by the core, never by the screen. */
  | 'expired'
  /** See `failure`. A decline is `failed` with `declined`: one code, one answer. */
  | 'failed'
  /** `cancel()` ran, or the screen unmounted. */
  | 'cancelled'

/**
 * Why a code failed. `exhausted`: the code took as many frames as one code may (§2.8's work budget) and stopped
 * answering. `rejected`: the scanner it accepted sent a proposal that could not be used, and the code's one
 * acceptance is spent on it. Either way a new code is what the person needs.
 */
export type SharedConnectInviteFailure = 'declined' | 'relay' | 'send' | 'exhausted' | 'rejected' | 'unknown'

export interface SharedConnectInvite {
  /** The full trigger link; set from `waiting`. */
  link?: string
  /** `_exp`, epoch seconds, at most ten minutes ahead. */
  expiresAt?: number
  state: SharedConnectInviteState
  /** Set only when `state` is `failed`. */
  failure?: SharedConnectInviteFailure
  /** Idempotent and safe in every state; also run when the screen unmounts. */
  cancel(): Promise<void>
  /** A fresh code (a new DID and `_id`); the old one is torn down first. */
  renew(): void
}
