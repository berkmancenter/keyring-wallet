/**
 * Whether this phone is a vetter right now — read from the grants it holds,
 * not from the fact that it holds one.
 *
 * A vetter grant is an endorsement with a validity window and a revocation
 * entry on the community's status list. Holding the credential says it was
 * issued; it does not say it still stands. The screens used to seat a phone at
 * the vetter's desk for any grant it had ever received, so a revoked or expired
 * vetter kept reading "You are the vetter" — while the applicants it vetted were
 * told, correctly, that its statements no longer counted.
 *
 * A phone can hold several grants for one community (a grant revoked and
 * issued again is a new credential), so the answer is about the set: one live
 * grant makes it a vetter; otherwise the newest grant says why it is not.
 *
 * @module trust-tasks/module/vtiGrantState
 */

import type { Agent } from '@credo-ts/core'

import type { VtiHeldCredential } from './VtiCommunityStore'
import { checkCredentialStatus } from './vtiStatusList'

export type VetterGrantState =
  /** A grant is inside its window and not revoked. `statusChecked: false` when the list could not be read. */
  | { state: 'active'; validUntil?: string; statusChecked: boolean; reason?: string }
  | { state: 'revoked'; checkedAt: string }
  | { state: 'expired'; validUntil: string }
  | { state: 'notYetValid'; validFrom: string }
  /** No grant held for this community. */
  | { state: 'none' }

type Options = { now?: Date; allowInsecureLocal?: boolean; fetchImpl?: typeof fetch }

const dateOf = (credential: Record<string, unknown>, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = credential[key]
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value
  }
  return undefined
}

const issuerOf = (credential: Record<string, unknown>, fallback: string): string => {
  const issuer = credential.issuer
  if (typeof issuer === 'string') return issuer
  if (issuer && typeof issuer === 'object' && typeof (issuer as { id?: unknown }).id === 'string') {
    return (issuer as { id: string }).id
  }
  return fallback
}

/** The state of one grant: its window first (no network), then its revocation bit. */
export async function grantState(
  agent: Agent,
  held: VtiHeldCredential,
  options: Options = {}
): Promise<Exclude<VetterGrantState, { state: 'none' }>> {
  const now = (options.now ?? new Date()).getTime()
  const credential = held.credential
  const validFrom = dateOf(credential, 'validFrom', 'issuanceDate')
  const validUntil = dateOf(credential, 'validUntil', 'expirationDate')
  if (validFrom && Date.parse(validFrom) > now) return { state: 'notYetValid', validFrom }
  if (validUntil && Date.parse(validUntil) <= now) return { state: 'expired', validUntil }
  const status = await checkCredentialStatus(agent, credential, issuerOf(credential, held.communityDid), {
    allowInsecureLocal: options.allowInsecureLocal,
    fetchImpl: options.fetchImpl,
  })
  if (status.state === 'revoked') return { state: 'revoked', checkedAt: status.checkedAt }
  if (status.state === 'unknown') return { state: 'active', validUntil, statusChecked: false, reason: status.reason }
  return { state: 'active', validUntil, statusChecked: status.state === 'ok' }
}

/**
 * The phone's standing as a vetter for one community, from every grant it holds
 * there. `grants` is what `VtiCommunityStore.listHeldCredentials('vetter-grant',
 * communityDid)` returns; pass only the grants whose subject is this phone's
 * persona.
 */
export async function ownVetterGrantState(
  agent: Agent,
  grants: VtiHeldCredential[],
  options: Options = {}
): Promise<VetterGrantState> {
  return (await pickOwnVetterGrant(agent, grants, options)).state
}

/**
 * Which grant to act under, and what it is — the same choice
 * [`ownVetterGrantState`] reports, so the grant a screen says you hold is the
 * grant the app signs with.
 *
 * A vetter who has been re-granted holds several grants for one community, and
 * "the first one the store returns" is not a choice: it was signing statements
 * under revoked grants while a live one sat beside it, which the community then
 * discounted and the applicant read as "your vetter's grant did not cover the
 * moment they signed" (2026-09-22, keyring-test). Newest first, and an active
 * grant beats any superseded one.
 *
 * When nothing is active this still returns the newest grant with its state, so
 * a caller can say WHY it will not act — "your grant was revoked" is worth more
 * to the person than an empty result.
 */
export async function pickOwnVetterGrant(
  agent: Agent,
  grants: VtiHeldCredential[],
  options: Options = {}
): Promise<{ held?: VtiHeldCredential; state: VetterGrantState }> {
  if (grants.length === 0) return { state: { state: 'none' } }
  const newestFirst = [...grants].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
  const states = await Promise.all(newestFirst.map((g) => grantState(agent, g, options)))
  const active = states.findIndex((s) => s.state === 'active')
  const at = active >= 0 ? active : 0
  return { held: newestFirst[at], state: states[at] }
}
