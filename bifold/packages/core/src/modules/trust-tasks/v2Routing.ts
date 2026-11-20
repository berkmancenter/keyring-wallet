/**
 * DIDComm v2 mediation for the wallet (didcomm_v2_subtask.md V2 step 4 /
 * §7.1): a SECOND mediation record beside the v1 one, never a replacement.
 *
 * Why two records: Coordinate Mediation 1.0 and 2.0 are different protocols
 * on different connections, and Credo keeps ONE default mediator. Every v1
 * invitation and every existing contact keeps routing through the v1 default
 * (the production mediator, never upgraded in place — §7.1), while v2
 * invitations name the v2 record explicitly via `getRouting({ mediatorId })`.
 * tsp-reference/ref-17 proved the two records and their two pickup loops
 * coexist on one agent (part 3, "carol").
 *
 * The provisioning order matters and is encoded here rather than left to a
 * caller: `provision()` makes the newest grant the default mediator, so the
 * previous (v1) default is restored right after, and a v2 invitation is
 * accepted with `useDefaultMediator: false` routing because the v1 default
 * cannot route a did:peer:2 (ref-17 part 3, "carol probe").
 */

import type { Agent } from '@credo-ts/core'
import type { DidCommMediationRecord, DidCommRouting } from '@credo-ts/didcomm'
import { DidCommMediationState, DidCommMediatorPickupStrategy } from '@credo-ts/didcomm'

const LOG_PREFIX = '[TrustTasks:V2Mediation]'

/**
 * The v2 mailbox switch: whether this phone uses Coordinate Mediation 2.0 at all (provisions it, runs its Pickup 4.0
 * loop, and mints out-of-band/2.0 invitations through it). OFF by default, and independent of accepting DIDComm v2:
 * a phone accepts v2 by default, but a v2 invitation it mints must name a mailbox a peer can deliver to, and a phone
 * has outbound transports only (tsp-reference/ref-17). Without a v2 mailbox the phone mints v1. The wallet app sets
 * it at start-up from its saved setting.
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
 * Provision Coordinate Mediation 2.0 with the mediator whose out-of-band/2.0
 * invitation is `invitationUrl`, once: an existing granted v2 record is
 * returned untouched, so this is safe on every agent start. The v1 default
 * mediator stays the default.
 */
export async function provisionV2Mediation(
  agent: Agent,
  invitationUrl: string,
  label = 'Keyring'
): Promise<DidCommMediationRecord> {
  const existing = await findV2MediationRecord(agent)
  if (existing) return existing

  const recipient = agent.modules.didcomm.mediationRecipient
  const previousDefault = await recipient.findDefaultMediator()

  const invitation = await agent.modules.didcomm.oob.parseInvitation(invitationUrl)
  if (!invitation.v2Invitation) throw new Error(`${LOG_PREFIX} MEDIATOR_V2_URL is not an out-of-band/2.0 invitation`)

  agent.config.logger.info(
    `${LOG_PREFIX} accepting the v2 mediator invitation ${invitation.v2Invitation.from.slice(0, 40)}…`
  )
  const { connectionRecord } = await agent.modules.didcomm.oob.receiveInvitation(invitation, {
    label,
    routing: await recipient.getRouting({ useDefaultMediator: false }),
  })
  if (!connectionRecord) throw new Error(`${LOG_PREFIX} the v2 mediator invitation produced no connection`)

  const record = await recipient.provision(connectionRecord)
  if (previousDefault && previousDefault.id !== record.id) {
    // provision() made the v2 grant the default; the v1 mediator keeps that role.
    await recipient.setDefaultMediator(previousDefault)
  }
  agent.config.logger.info(
    `${LOG_PREFIX} Coordinate Mediation 2.0 granted (record ${record.id}, routing DID ${record.routingDid?.slice(0, 40)}…); default mediator ${previousDefault ? 'unchanged (v1)' : 'is now v2'}`
  )
  return record
}

/**
 * Start the Pickup 4.0 polling loop for the v2 mediator, if provisioned.
 * Call AFTER the v1 loop is started: the patched v1/v2 pickup start stops
 * every running loop first (the anti-stacking guard), the v4 start does not.
 */
export async function startV2MessagePickup(agent: Agent): Promise<boolean> {
  // Off, no second loop runs, even on a phone that provisioned a v2 record while the switch was on. That strands what
  // reaches its v2 connections: their mail waits uncollected in the v2 mailbox until the switch is on again. Accepted
  // (Alberto, 2026-11-20: no Pickup 4.0 loop for anyone with the switch off); only a phone that turned the switch on
  // has such connections, and no store build ships a v2 mailbox.
  if (!v2MediationEnabled) return false
  const record = await findV2MediationRecord(agent)
  if (!record) return false
  await agent.modules.didcomm.mediationRecipient.initiateMessagePickup(record, DidCommMediatorPickupStrategy.PickUpV4)
  agent.config.logger.info(`${LOG_PREFIX} Pickup 4.0 polling started for mediation record ${record.id}`)
  return true
}
