/**
 * How the wallet routes DIDComm v2 invitations it accepts (acceptConfigForInvitation), and what is left of its
 * Coordinate Mediation 2.0 client.
 *
 * Wallet-to-wallet v2 goes through the wallet mailbox (module/walletMailbox.ts, didcomm_v2_subtask.md §7.2): the
 * Affinidi mediator has no Coordinate Mediation 2.0 by design, so the second-mediation-record design that used to
 * live here (a v2 record beside the v1 one, its own Pickup 4.0 loop) has nothing to talk to there. Its entry points
 * are retired in three steps, each green on its own: this one keeps provisionV2Mediation, startV2MessagePickup and
 * setV2MediationEnabled as wrappers with unchanged signatures, so the pinned wallet compiles; the wallet then stops
 * calling them; and a last bifold change removes them once the wallet pin in force no longer does.
 *
 * What stays: findV2MediationRecord (the wallet's already-provisioned guard reads it), getRoutingForV2 (unmediated
 * routing for a v2 invitation accepted without an open mailbox: the v1 default mediator cannot route a did:peer:2,
 * tsp-reference/ref-17 finding 1), routingForInvitation and acceptConfigForInvitation.
 */

import type { Agent } from '@credo-ts/core'
import type { DidCommMediationRecord, DidCommRouting } from '@credo-ts/didcomm'
import { DidCommMediationState } from '@credo-ts/didcomm'

import { mintContactDid, walletMailboxOf } from './module/walletMailbox'

const LOG_PREFIX = '[TrustTasks:V2Mediation]'

/**
 * The v2 mailbox switch, as the wallet app sets it at start-up from its saved setting. Nothing in this package reads
 * it any more: minting v2 depends on an open wallet mailbox (canMintV2Invitation), and the Coordinate Mediation 2.0
 * provisioning and Pickup 4.0 loop it used to gate are retired (provisionV2Mediation, startV2MessagePickup). Kept,
 * with its signature, so the pinned wallet compiles; step 3 of the retirement removes it once the wallet pin in force
 * no longer calls it.
 */
let v2MediationEnabled = false

export function setV2MediationEnabled(enabled: boolean): void {
  v2MediationEnabled = enabled
}

export function isV2MediationEnabled(): boolean {
  return v2MediationEnabled
}

/** The granted Coordinate Mediation 2.0 record, if this wallet has one. */
export async function findV2MediationRecord(agent: Agent): Promise<DidCommMediationRecord | undefined> {
  const records = await agent.modules.didcomm.mediationRecipient.getMediators()
  return records.find(
    (record: DidCommMediationRecord) =>
      record.protocolVersion === 'v2' && record.state === DidCommMediationState.Granted
  )
}

/**
 * Routing for a v2 invitation (created or accepted): through the v2 mediator
 * when one is provisioned, otherwise unmediated — never the v1 default.
 */
export async function getRoutingForV2(agent: Agent): Promise<DidCommRouting> {
  const v2 = await findV2MediationRecord(agent)
  if (v2) return agent.modules.didcomm.mediationRecipient.getRouting({ mediatorId: v2.id })
  return agent.modules.didcomm.mediationRecipient.getRouting({ useDefaultMediator: false })
}

/**
 * The routing to accept an invitation with: for an out-of-band/2.0 invitation, {@link getRoutingForV2}, because the
 * default (v1) mediator cannot route a did:peer:2 and Credo throws "DIDComm v2 OOB with mediated routing requires
 * Coordinate Mediation 2.0" (tsp-reference/ref-17 finding 1); for a v1 invitation, undefined, so Credo routes through
 * the default mediator exactly as before. Every path that accepts an invitation goes through this.
 */
export async function routingForInvitation(
  agent: Agent,
  invitation: { v2Invitation?: unknown } | null | undefined
): Promise<DidCommRouting | undefined> {
  return invitation?.v2Invitation ? getRoutingForV2(agent) : undefined
}

/**
 * How to accept an invitation. For an out-of-band/2.0 invitation with this phone's mailbox open (walletMailbox.ts),
 * answer from a fresh contact DID that names the mailbox (`ourDid`), so the peer's replies reach this phone through
 * it; without a mailbox, {@link routingForInvitation}'s routing, as before. A v1 invitation: nothing, so Credo routes
 * through the default mediator. Spread into `receiveInvitation`'s config.
 */
export async function acceptConfigForInvitation(
  agent: Agent,
  invitation: { v2Invitation?: unknown } | null | undefined
): Promise<{ routing?: DidCommRouting; ourDid?: string }> {
  if (!invitation?.v2Invitation) return {}
  const mailbox = walletMailboxOf(agent)
  if (mailbox) return { ourDid: await mintContactDid(agent, mailbox) }
  const routing = await getRoutingForV2(agent)
  return routing ? { routing } : {}
}

/**
 * RETIRED (step 1 of 3): Coordinate Mediation 2.0 provisioning with the mediator whose out-of-band/2.0 invitation is
 * `invitationUrl`. See the body for what the caller sees.
 */
export async function provisionV2Mediation(
  agent: Agent,
  invitationUrl: string,
  label = 'Keyring'
): Promise<DidCommMediationRecord> {
  // RETIRED (step 1 of 3). Coordinate Mediation 2.0 has nothing to talk to on the Affinidi mediator, which the wallet
  // uses for v2 (no Coordinate Mediation by design, upstream issue #755); the wallet mailbox replaces it
  // (module/walletMailbox.ts). What the caller sees: this throws, and the wallet's only caller
  // (provisionV2MediationIfConfigured) logs "provisioning failed, continuing on v1 only: <this message>" and carries on.
  // It is reached only with MEDIATOR_V2_URL set, which no store, OTA or test build carries. Kept, with its signature,
  // so the pinned wallet compiles: step 2 (the wallet) stops calling it, and step 3 removes it once the wallet pin in
  // force no longer calls it.
  void agent
  void invitationUrl
  void label
  throw new Error(`${LOG_PREFIX} Coordinate Mediation 2.0 is retired in this build; the wallet mailbox replaces it`)
}

/**
 * RETIRED (step 1 of 3): the Pickup 4.0 loop for a Coordinate Mediation 2.0 record. What the caller sees: `false`, its
 * meaning since it was written ("no loop started"), and nothing else happens; both wallet call sites discard it. No
 * phone holds such a record: provisioning needed MEDIATOR_V2_URL, which no store, OTA or test build carries. Kept, with
 * its signature, so the pinned wallet compiles; step 2 (the wallet) stops calling it, and step 3 removes it once the
 * wallet pin in force no longer calls it. Collection for v2 contacts is the wallet mailbox's session
 * (module/walletMailbox.ts).
 */
export async function startV2MessagePickup(agent: Agent): Promise<boolean> {
  void agent
  return false
}
