/**
 * This phone's holder identity as a small KERI controller: one transferable AID with one P-256 key and one
 * pre-rotated next key, both made and kept in the agent's key store (its KMS; the private keys never leave it), and
 * its KEL kept on this phone. A state office issues the Guardian card to this AID (its "holder code"), and the same AID
 * issues the Social Authorization to the person it cares for, anchored here with {@link appendInteraction}.
 *
 * The interface (stable; the S2 issuer builds on it):
 * - {@link holderCodeOf}: the AID, made the first time it is asked for, then always the same one;
 * - {@link holderKel}: the KEL so far, as the CESR stream a verifier replays (inception, then each interaction);
 * - {@link holderSign}: the current key's raw signature (ECDSA P-256 over SHA-256, r || s, 64 bytes);
 * - {@link appendInteraction}: sign and keep an interaction event anchoring the given seals; returns its sn and SAID.
 *
 * Every event is replayed with this package's own KEL replay (sedi/guardian/kel) before it is kept, so the phone never
 * keeps a KEL a verifier would refuse. The record is made once and only ever extended (overwritten with the longer
 * KEL), never deleted. Software keys, not the phone's secure hardware: screens say "kept on this phone".
 *
 * Behind the switches: with trusted approvers or state-verified approvers off (the SEDI/KERI kill included) every call
 * throws {@link HolderSwitchedOff} and nothing is made, signed or kept.
 *
 * @module sedi/holder/controller
 */
import type { Agent } from '@credo-ts/core'

import { digest, replayKel } from '../guardian/kel'
import {
  compressP256,
  inceptionBody,
  indexedP256Sig,
  interactionBody,
  nextKeyDigest,
  p256KeyQb64,
  signedEvent,
} from '../identity/keriEvents'
import { phoneCodesOn } from '../identity/phoneCodesOn'

/** genericRecords recordType of this phone's holder identity (one record, made once, extended, never deleted). */
export const HOLDER_IDENTITY = 'keyring.sedi-holder-identity'

/** The parts of the agent the controller uses: its records and its key store. */
export type ControllerAgent = Pick<Agent, 'genericRecords' | 'kms'>

/** What the record keeps. */
export interface HolderIdentity {
  aid: string
  /** The KMS key that signs now, and the one the inception committed to as next. */
  keyId: string
  nextKeyId: string
  /** The KEL as a CESR text stream. */
  kel: string
  /** The last event's sn and SAID, for the next interaction. */
  sn: number
  said: string
  createdAt: string
}

/** Thrown by every call while the switches are off: nothing is made, signed or kept. */
export class HolderSwitchedOff extends Error {
  constructor() {
    super('trusted approvers and state-verified approvers must both be on')
    this.name = 'HolderSwitchedOff'
  }
}

const te = new TextEncoder()

const on = () => {
  if (!phoneCodesOn()) throw new HolderSwitchedOff()
}

async function recordOf(agent: Pick<Agent, 'genericRecords'>) {
  const [record] = (await agent.genericRecords.findAllByQuery({ recordType: HOLDER_IDENTITY })) ?? []
  const content = record?.content as unknown as HolderIdentity | undefined
  return record && content && typeof content.aid === 'string' && typeof content.kel === 'string'
    ? { record, identity: content }
    : undefined
}

async function p256Key(agent: ControllerAgent): Promise<{ keyId: string; qb64: string }> {
  const key = await agent.kms.createKey({ type: { kty: 'EC', crv: 'P-256' } })
  const jwk = key.publicJwk as { x?: unknown; y?: unknown }
  if (typeof jwk.x !== 'string' || typeof jwk.y !== 'string') throw new Error('the key store gave no P-256 public key')
  return { keyId: key.keyId, qb64: p256KeyQb64(compressP256(jwk.x, jwk.y)) }
}

const signWith = async (agent: ControllerAgent, keyId: string, data: Uint8Array) =>
  (await agent.kms.sign({ keyId, algorithm: 'ES256', data })).signature

/** The KEL replays here and ends at `sn` with `said`, or this throws: nothing that fails is ever kept. */
function mustReplay(kel: string, pre: string, sn: number, said: string) {
  const replay = replayKel(digest, te.encode(kel))
  if (!replay.ok || replay.state.pre !== pre || replay.state.sn !== sn || replay.state.said !== said)
    throw new Error(`the holder KEL does not replay${replay.ok ? '' : `: ${replay.reason}`}`)
}

async function make(agent: ControllerAgent): Promise<HolderIdentity> {
  const now = await p256Key(agent)
  const next = await p256Key(agent)
  const body = inceptionBody(now.qb64, nextKeyDigest(next.qb64))
  const kel = signedEvent(body, [indexedP256Sig(await signWith(agent, now.keyId, body.raw), 0)])
  mustReplay(kel, body.pre, 0, body.said)
  const identity: HolderIdentity = {
    aid: body.pre,
    keyId: now.keyId,
    nextKeyId: next.keyId,
    kel,
    sn: 0,
    said: body.said,
    createdAt: new Date().toISOString(),
  }
  await agent.genericRecords.save({ content: { ...identity }, tags: { recordType: HOLDER_IDENTITY } })
  return identity
}

// One change at a time: two callers at once must not make two identities or fork the KEL.
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

async function identityOf(agent: ControllerAgent): Promise<HolderIdentity> {
  on()
  const kept = await recordOf(agent)
  if (kept) return kept.identity
  return serial(async () => (await recordOf(agent))?.identity ?? make(agent))
}

/** This phone's holder code: the AID a state issues a Guardian card to. Made once, then always the same. */
export async function holderCodeOf(agent: ControllerAgent): Promise<string> {
  return (await identityOf(agent)).aid
}

/** The holder KEL so far, as the CESR stream a verifier replays. */
export async function holderKel(agent: ControllerAgent): Promise<Uint8Array> {
  return te.encode((await identityOf(agent)).kel)
}

/** The current key's raw signature over `bytes`: ECDSA P-256 over SHA-256, r || s (64 bytes). */
export async function holderSign(agent: ControllerAgent, bytes: Uint8Array): Promise<Uint8Array> {
  const identity = await identityOf(agent)
  on()
  return signWith(agent, identity.keyId, bytes)
}

/**
 * Sign and keep an interaction event anchoring `seals` (each `{ i, s, d }`: a registry's or a credential's event), as
 * the next event of the holder KEL. The extended KEL is replayed before it is kept; on any failure nothing changes.
 */
export async function appendInteraction(
  agent: ControllerAgent,
  seals: Array<{ i: string; s: string; d: string }>
): Promise<{ sn: number; said: string }> {
  await identityOf(agent)
  return serial(async () => {
    on()
    const kept = await recordOf(agent)
    if (!kept) throw new Error('no holder identity')
    const { record, identity } = kept
    const body = interactionBody(
      identity.aid,
      identity.sn + 1,
      identity.said,
      seals.map((s) => ({ i: s.i, s: s.s, d: s.d }))
    )
    const kel = identity.kel + signedEvent(body, [indexedP256Sig(await signWith(agent, identity.keyId, body.raw), 0)])
    mustReplay(kel, identity.aid, body.sn, body.said)
    on()
    record.content = { ...identity, kel, sn: body.sn, said: body.said }
    await agent.genericRecords.update(record)
    return { sn: body.sn, said: body.said }
  })
}
