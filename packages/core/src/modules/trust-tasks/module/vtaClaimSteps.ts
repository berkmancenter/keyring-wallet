/**
 * The steps the Farm-claim screen runs (`vta-claim`), over the Credo agent and
 * the phone's link machine — and the scanned code held for that screen. The
 * screen takes them as a prop, so its tests run against fakes.
 *
 * @module trust-tasks/module/vtaClaimSteps
 */
import type { Agent } from '@credo-ts/core'

import { signDocumentProof } from '../documentProof'

import { agentDidResolver } from './oobSignIn'
import { confirmOwner, deviceCanOwn } from './ownerConfirm'
import { readTrigger, triggerAction, type TriggerAccept } from './triggerLink'
import { vtaAgent } from './vtaAgent'
import {
  claimVta,
  farmPost,
  redeemVta,
  VtaClaimError,
  type ClaimedVta,
  type RedeemedVta,
  type RedeemState,
} from './vtaClaim'
import type { OwnerConfirmation } from './vtaOwner'

/** A scanned code, read offline: the Farm it is from, or why it can't be used. */
export function vtaClaimOf(link: string): TriggerAccept | VtaClaimError {
  const action = triggerAction(readTrigger(link, { channel: 'scan' }))
  if (action.kind === 'proceed' && action.flow === 'vta-claim') return action.trigger
  if (action.kind === 'say' && action.ui === 'expired') return new VtaClaimError('expired', 'the code has expired')
  return new VtaClaimError('invalidCode', action.kind === 'say' ? action.ui : action.flow)
}

/** How the agent link ended once the Farm handed the agent over. */
export type ClaimLinkOutcome = { kind: 'linked'; vtaDid: string } | { kind: 'failed'; detail?: string }

export type VtaClaimSteps = {
  /** Whether this phone can be an agent's owner (a screen lock or biometrics). */
  canOwn: () => Promise<boolean>
  /** Face ID, fingerprint or the passcode: the person acting as owner. */
  confirmOwner: (reason: string) => Promise<OwnerConfirmation>
  /** Make the key and claim the code's reservation; the claim check comes back. */
  claim: (trigger: TriggerAccept) => Promise<ClaimedVta>
  /** Ask until the Farm hands the agent over. */
  redeem: (
    claimed: ClaimedVta,
    options: { onState: (state: RedeemState) => void; shouldStop: () => boolean }
  ) => Promise<RedeemedVta>
  /** Link to the agent handed over, as the manual link does once its code was added. */
  finish: (claimed: ClaimedVta, redeemed: RedeemedVta) => Promise<ClaimLinkOutcome>
}

/** The production steps. */
export function agentVtaClaimSteps(agent: Agent): VtaClaimSteps {
  const depsFor = (walletDid: string) => ({
    resolveDid: agentDidResolver(agent),
    post: farmPost,
    walletDid,
    sign: (document: Record<string, unknown>) =>
      signDocumentProof(agent, document, walletDid, { proofPurpose: 'authentication' }),
  })
  return {
    canOwn: () => deviceCanOwn(),
    confirmOwner: (reason) => confirmOwner(reason),
    claim: async (trigger) => {
      const walletDid = await vtaAgent.createClaimKey(agent)
      return claimVta(trigger, depsFor(walletDid))
    },
    redeem: (claimed, options) => redeemVta(claimed, depsFor(claimed.walletDid), options),
    finish: async (claimed, redeemed) => {
      await vtaAgent.finishClaimedLink(agent, redeemed.vtaDid, claimed.walletDid, claimed.farmDid)
      // The Farm hands over once the administrator is in place, but the agent
      // can take a moment to answer as it: check again a few times, as the
      // manual link's "Check again" would.
      for (let i = 0; i < 4; i++) {
        const link = vtaAgent.getState().link
        if (link.kind === 'linked' && link.vtaDid === redeemed.vtaDid)
          return { kind: 'linked', vtaDid: redeemed.vtaDid }
        if (link.kind !== 'showingKey') break
        await new Promise((resolve) => setTimeout(resolve, 3000))
        await vtaAgent.checkManualGrant(agent)
      }
      const link = vtaAgent.getState().link
      if (link.kind === 'linked' && link.vtaDid === redeemed.vtaDid) return { kind: 'linked', vtaDid: redeemed.vtaDid }
      return {
        kind: 'failed',
        detail: link.kind === 'notLinked' ? (link.lastError?.detail ?? link.lastError?.reason) : link.kind,
      }
    },
  }
}
