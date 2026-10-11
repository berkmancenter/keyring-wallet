/**
 * TEMPORARY STUB — REPLACE BEFORE MERGE.
 *
 * The sign-in steps after the claim (identify, prove, approve) are written in
 * `oobSignIn.ts` / `oobSignInAgent.ts` on another branch. This file declares
 * their shapes so the sign-in screen compiles and is tested against fakes; every
 * body throws. Only `signInSteps.ts` imports it: swap that one import for the
 * real module and delete this file.
 *
 * @module trust-tasks/module/oobSignInAgentStub
 */
import type { Agent } from '@credo-ts/core'

import type { ClaimedSignIn, SignInDeps } from './oobSignIn'

/** The reasons the later steps add to `SignInFailure`, worded by the sign-in screen. */
export type SignInLaterFailure = 'wrongNumber' | 'noVaultEntry' | 'uvRequired' | 'notEnrolled' | 'replayed'

/** What the community reported about the browser asking to sign in. Its words, not checked by Keyring. */
export type SignInRequester = {
  browser?: string
  os?: string
  location?: string
  sameNetwork?: boolean
  createdAt?: string
}

/** A sign-in the person has matched by number and the community has accepted the proof for. */
export type ProvedSignIn = {
  claimed: ClaimedSignIn
  step2: Record<string, unknown>
  sessionKey: unknown
  requester: SignInRequester
  identifiedAs: string
  persona: { did: string; entryId: string }
}

/** The deps the later steps take: sign-in's own, and the agent that holds the persona. */
export type SignInAgentDeps = SignInDeps & { agent: Agent }

export async function identifyAndProve(
  _claimed: ClaimedSignIn,
  _enteredNumber: string,
  _deps: SignInAgentDeps
): Promise<ProvedSignIn> {
  throw new Error('not implemented')
}

export async function approveSignIn(_proved: ProvedSignIn, _deps: SignInAgentDeps): Promise<{ status: 'approved' }> {
  throw new Error('not implemented')
}

export async function ensureSignInVaultEntry(
  _vtcDid: string,
  _persona: { did: string; entryId: string },
  _deps: SignInAgentDeps
): Promise<string> {
  throw new Error('not implemented')
}
