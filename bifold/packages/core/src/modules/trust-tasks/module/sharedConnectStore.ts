/**
 * sharedConnectStore — keeping a VRC received over the shared-connect path,
 * deduplicated by digest so a redelivery stores nothing twice.
 *
 * @module trust-tasks/module/sharedConnectStore
 */

import { JsonTransformer, W3cCredentialRecord } from '@credo-ts/core'
import type { Agent } from '@credo-ts/core'

import { digestMultibase } from '../documentProof'

/** Record metadata key holding the VRC exactly as it was received (the document its issuer signed). */
export const RECEIVED_VRC_METADATA_KEY = '_keyring/sharedConnectReceivedVrc'

/**
 * The credential a record holds, as signed. Credo's round trip (`JsonTransformer.toJSON(firstCredential)`) drops
 * a JCS proof's `@context` and reorders its keys, so a stored copy rebuilt that way no longer digests or verifies
 * as what was received. A record stored by `storeReceivedVrc` keeps the received JSON beside the credo credential
 * and that copy is returned; any other record falls back to the credo form.
 */
export function receivedVrcJson(record: W3cCredentialRecord): Record<string, unknown> {
  const kept = record.metadata.get<Record<string, unknown>>(RECEIVED_VRC_METADATA_KEY)
  return kept ?? (JsonTransformer.toJSON(record.firstCredential) as Record<string, unknown>)
}

/** Store `vc` unless a credential with the same digest is already held. True when it was stored. */
export async function storeReceivedVrc(agent: Agent, vc: Record<string, unknown>): Promise<boolean> {
  const digest = digestMultibase(vc)
  const existing = await agent.w3cCredentials.getAll()
  const held = existing.some((record) => {
    try {
      return digestMultibase(receivedVrcJson(record)) === digest
    } catch {
      return false
    }
  })
  if (held) return false
  const record = new W3cCredentialRecord({ credentialInstances: [{ credential: vc as never }] })
  record.metadata.set(RECEIVED_VRC_METADATA_KEY, vc)
  await agent.w3cCredentials.store({ record })
  return true
}
