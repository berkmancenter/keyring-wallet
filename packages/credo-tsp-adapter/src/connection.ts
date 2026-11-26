/**
 * Opening a TSP envelope that arrived on a DIDComm connection — the receive
 * rule every Keyring party applies (the wallet's TspCarriage and the
 * witness-server), whichever DIDComm version delivered the envelope.
 *
 * - **Our identity** is the DID the envelope was sealed to among the
 *   connection's current and previous DIDs. A reusable DIDComm v2 invitation
 *   rotates the inviter's DID on first contact (`from_prior`), and the
 *   invitee keeps addressing the invitation DID until the rotation reaches it.
 * - **The sender** must be the connection's counterparty: its current DID or
 *   one it previously held. This still authenticates a DID the connection has
 *   actually held; it only stops a rotation in flight from reading as forgery.
 *
 * Measured in `tsp-reference/ref-19` (didcomm_v2_subtask.md V2T, change 3).
 *
 * @module credo-tsp-adapter/connection
 */
import type { Agent } from '@credo-ts/core'
import { tsp } from '@bifold/trust-tasks'

import { identityFromDid } from './identity'

/** The slice of a Credo `DidCommConnectionRecord` this needs. */
export interface TspConnectionDids {
  id: string
  did?: string
  theirDid?: string
  previousDids?: string[]
  previousTheirDids?: string[]
}

export interface UnpackedForConnection {
  unpacked: tsp.UnpackedMessage
  /** Which of our DIDs the envelope was sealed to. */
  receivedAs: string
}

export async function unpackForConnection(
  agent: Agent,
  envelope: Uint8Array,
  connection: TspConnectionDids,
  resolver: tsp.VidResolver
): Promise<UnpackedForConnection> {
  const ours = [connection.did, ...(connection.previousDids ?? [])].filter((d): d is string => !!d)
  if (ours.length === 0) throw new Error(`credo-tsp-adapter: connection ${connection.id} has no DID of ours`)

  let unpacked: tsp.UnpackedMessage | undefined
  let receivedAs: string | undefined
  let lastError: unknown
  for (const did of ours) {
    try {
      unpacked = await tsp.unpack(envelope, await identityFromDid(agent, did), resolver)
      receivedAs = did
      break
    } catch (error) {
      lastError = error
    }
  }
  if (!unpacked || !receivedAs) {
    throw new Error(
      `credo-tsp-adapter: envelope on connection ${connection.id} opens with none of our ${ours.length} DID(s): ${
        (lastError as Error)?.message ?? 'unknown error'
      }`
    )
  }

  if (unpacked.receiver !== receivedAs) {
    throw new Error(
      `credo-tsp-adapter: envelope names receiver ${unpacked.receiver} but was sealed to ${receivedAs} on connection ${connection.id}`
    )
  }
  const theirs = [connection.theirDid, ...(connection.previousTheirDids ?? [])].filter((d): d is string => !!d)
  if (!theirs.includes(unpacked.sender)) {
    throw new Error(
      `credo-tsp-adapter: envelope's claimed sender (${unpacked.sender}) is not a DID of connection ${connection.id}'s counterparty (${connection.theirDid})`
    )
  }
  return { unpacked, receivedAs }
}
