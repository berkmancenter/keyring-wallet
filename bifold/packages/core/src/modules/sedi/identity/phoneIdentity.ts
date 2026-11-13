/**
 * This phone's WARD CODE, for the cared-for person's phone: a non-transferable Ed25519 AID ('B' + its key), its key
 * made and kept in the agent's key store (KMS). A state office's Guardian card names it as the ward. Making it does not
 * set this phone's ward: {@link becomeOwnWard} does, on purpose, so the K0 demo's ward (the fallback) is never replaced
 * behind the person's back. The guardian's side, the holder code, is sedi/holder/controller.
 *
 * Software keys, not the phone's secure hardware. Made once, never deleted. Behind the switches: with trusted approvers
 * or state-verified approvers off (the SEDI/KERI kill included), nothing is made and every call answers null or 'off'.
 *
 * @module sedi/identity/phoneIdentity
 */
import type { Agent } from '@credo-ts/core'

import { ed25519NQb64, fromB64url } from './keriEvents'
import { phoneCodesOn } from './phoneCodesOn'

/** genericRecords recordType of this phone's ward identity (one record, made once, never changed or deleted). */
export const WARD_IDENTITY = 'keyring.sedi-ward-identity'

export interface WardIdentity {
  aid: string
  keyId: string
  createdAt: string
}

/** The parts of the agent this module uses: its records and its key store. */
export type IdentityAgent = Pick<Agent, 'genericRecords' | 'kms'>

async function makeWard(agent: IdentityAgent): Promise<WardIdentity> {
  const key = await agent.kms.createKey({ type: { kty: 'OKP', crv: 'Ed25519' } })
  const x = (key.publicJwk as { x?: unknown }).x
  if (typeof x !== 'string') throw new Error('the key store gave no Ed25519 public key')
  const identity: WardIdentity = {
    aid: ed25519NQb64(fromB64url(x)),
    keyId: key.keyId,
    createdAt: new Date().toISOString(),
  }
  await agent.genericRecords.save({ content: { ...identity }, tags: { recordType: WARD_IDENTITY } })
  return identity
}

async function keptWard(agent: Pick<Agent, 'genericRecords'>): Promise<WardIdentity | undefined> {
  const [record] = (await agent.genericRecords.findAllByQuery({ recordType: WARD_IDENTITY })) ?? []
  const content = record?.content as unknown as WardIdentity | undefined
  return content && typeof content.aid === 'string' ? content : undefined
}

// One making at a time: two screens asking at once must not make two ward codes.
let making: Promise<WardIdentity> | undefined

/** This phone's ward code (the AID a Guardian card names as the ward), or null with the switches off. */
export async function wardCodeOf(agent: IdentityAgent): Promise<string | null> {
  if (!phoneCodesOn()) return null
  const kept = await keptWard(agent)
  if (kept) return kept.aid
  making ??= (async () => (await keptWard(agent)) ?? makeWard(agent))().finally(() => {
    making = undefined
  })
  return (await making).aid
}

/**
 * Make this phone's own ward code its ward for Guardian checks, in place of any other (the K0 demo's included): a
 * card from a state office naming this phone then checks as naming its ward. 'off' with the switches off.
 */
export async function becomeOwnWard(agent: IdentityAgent): Promise<'done' | 'off'> {
  const ward = await wardCodeOf(agent)
  if (!ward) return 'off'
  // Reached lazily, as developerTestState does: importing this module must not load the Guardian verifier.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const evidence = require('../../trust-tasks/guardianEvidence') as typeof import('../../trust-tasks/guardianEvidence')
  await evidence.setStateWard(agent, ward)
  return 'done'
}
