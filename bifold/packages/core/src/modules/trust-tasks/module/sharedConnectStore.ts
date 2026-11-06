/**
 * sharedConnectStore — keeping a VRC received over the shared-connect path,
 * deduplicated by digest so a redelivery stores nothing twice.
 *
 * @module trust-tasks/module/sharedConnectStore
 */

import { JsonTransformer, W3cCredentialRecord } from '@credo-ts/core'
import type { Agent } from '@credo-ts/core'

import { digestMultibase } from '../documentProof'

/** Store `vc` unless a credential with the same digest is already held. True when it was stored. */
export async function storeReceivedVrc(agent: Agent, vc: Record<string, unknown>): Promise<boolean> {
  const digest = digestMultibase(vc)
  const existing = await agent.w3cCredentials.getAll()
  const held = existing.some((record) => {
    try {
      return digestMultibase(JsonTransformer.toJSON(record.firstCredential)) === digest
    } catch {
      return false
    }
  })
  if (held) return false
  await agent.w3cCredentials.store({
    record: new W3cCredentialRecord({ credentialInstances: [{ credential: vc as never }] }),
  })
  return true
}
