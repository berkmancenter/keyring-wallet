/**
 * v2Binding — the consumer-side rules of the framework's `binding/didcomm 0.2`
 * that every Keyring party (wallet, witness-server) applies the same way,
 * kept beside the envelope message so both run one implementation:
 *
 *   - thread correlation (§3.1): `thid`/`threadId` and `pthid`/`parentThreadId`
 *     MUST agree when both are present (`malformedRequest`, never
 *     `identityMismatch`); a missing member is never filled from the transport;
 *   - first contact: DIDComm v2 OOB has no handshake. Credo (PR #2704) creates
 *     the inviter's connection when the invitee's first authenticated message
 *     arrives ONLY with `connections.autoCreateConnectionOnFirstMessage: true`
 *     (default false — which is what tsp-reference/ref-15 finding 1 and ref-17
 *     finding 3 observed). Every Keyring party sets that option; this helper
 *     is the fallback for a party that does not, minting the same record
 *     Credo's `DidCommMessageReceiver` would (role Responder: the inviter
 *     answers), through the public `DidCommConnectionService`.
 *
 * Platform-neutral: Credo imports only, as `TrustTaskMessage.ts` already has.
 *
 * @module v2Binding
 */

import type { AgentContext, VerificationMethod } from '@credo-ts/core'
import { getPublicJwkFromVerificationMethod } from '@credo-ts/core'
import type { DidCommConnectionRecord, DidCommOutOfBandRecord } from '@credo-ts/didcomm'
import {
  DidCommConnectionService,
  DidCommDidExchangeRole,
  DidCommDidExchangeState,
  DidCommHandshakeProtocol,
  DidCommOutOfBandRepository,
  DidCommOutOfBandRole,
} from '@credo-ts/didcomm'

export type V2ThreadVerdict = 'ok' | 'malformedRequest:thid' | 'malformedRequest:pthid'

/** Binding §3.1, pure: compare only when BOTH the header and the member are present; never fill. */
export function checkV2ThreadCorrelation(
  message: { thread?: { threadId?: string; parentThreadId?: string } },
  document: Record<string, unknown>
): V2ThreadVerdict {
  // The RAW `~thread.thid` header, not Credo's `message.threadId` getter —
  // that getter defaults to the message `id` whenever `thid` is absent, so
  // reading it here would treat "thid was never set on the wire" the same
  // as "thid was set and disagrees", falsely rejecting a conforming producer
  // that (per this same binding) omits thid and relies on the document's
  // own threadId/id instead.
  const thid = message.thread?.threadId
  const pthid = message.thread?.parentThreadId
  const threadId = document.threadId as string | undefined
  const parentThreadId = document.parentThreadId as string | undefined
  if (thid !== undefined && threadId !== undefined && thid !== threadId) return 'malformedRequest:thid'
  if (pthid !== undefined && parentThreadId !== undefined && pthid !== parentThreadId) return 'malformedRequest:pthid'
  return 'ok'
}

/** The smallest slice of an agent these helpers need (a real `Agent` satisfies it; tests fake it). */
export interface V2BindingAgent {
  context: AgentContext
  dependencyManager: { container: { resolve<T>(token: unknown): T } }
  config: { logger: { info(message: string): void; warn(message: string): void } }
  dids: { resolveDidDocument(did: string): Promise<unknown> }
}

export interface V2FirstContact {
  /**
   * The sender's DID as the PLAINTEXT `from` header claimed it — not itself
   * authenticated. DIDComm v2 first contact has no handshake, so this claim
   * is only trusted once `senderKeyBelongsToClaimedDid` confirms it below.
   */
  from: string
  /** Our DID as the plaintext carried it — must be one of our v2 invitation DIDs. */
  to: string
  /**
   * The key that actually authenticated this envelope (Credo's unpack
   * result — the ECDH-1PU/ECDH-ES sender key, never read from a header).
   * Required to bind `from` to something the sender cryptographically
   * controls before a connection is minted for it.
   */
  senderKey?: unknown
}

/** A verification method's public key, as raw bytes (same nested shape `getPublicJwkFromVerificationMethod` returns everywhere else in this codebase). */
function publicKeyBytesOf(jwkLike: unknown): Uint8Array | undefined {
  const bytes = (jwkLike as { publicKey?: { publicKey?: Uint8Array } } | undefined)?.publicKey?.publicKey
  return bytes instanceof Uint8Array ? bytes : undefined
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** A DID document's keyAgreement verification methods, embedded or referenced by id (same fallback order `documentProof.ts`'s signing-method lookup uses). */
function keyAgreementVerificationMethods(didDocument: {
  keyAgreement?: Array<string | VerificationMethod>
  verificationMethod?: VerificationMethod[]
}): VerificationMethod[] {
  const resolved: VerificationMethod[] = []
  for (const entry of didDocument.keyAgreement ?? []) {
    if (typeof entry === 'object' && entry !== null) {
      resolved.push(entry)
      continue
    }
    const referenced = (didDocument.verificationMethod ?? []).find(
      (vm) => vm.id === entry || (entry.startsWith('#') && vm.id.endsWith(entry))
    )
    if (referenced) resolved.push(referenced)
  }
  return resolved
}

/**
 * Whether `senderKey` — the key that actually authenticated this envelope —
 * is one of the keyAgreement keys `claimedFrom`'s OWN resolved DID document
 * publishes. This is the only cryptographic tie between the plaintext `from`
 * claim and an identity the sender controls: DIDComm v2 first contact has no
 * handshake, and even the "authenticated" fallback this module used to fall
 * back to (`ctx.senderDid`) reads the same unauthenticated plaintext field.
 * A DID that fails to resolve, or a sender key absent from its keyAgreement
 * set, fails closed (false) — never treated as a pass.
 */
export async function senderKeyBelongsToClaimedDid(
  agent: Pick<V2BindingAgent, 'dids'>,
  claimedFrom: string,
  senderKey: unknown
): Promise<boolean> {
  const senderKeyBytes = publicKeyBytesOf(senderKey)
  if (!senderKeyBytes) return false
  let didDocument: { keyAgreement?: Array<string | VerificationMethod>; verificationMethod?: VerificationMethod[] }
  try {
    didDocument = (await agent.dids.resolveDidDocument(claimedFrom)) as typeof didDocument
  } catch {
    return false
  }
  return keyAgreementVerificationMethods(didDocument).some((vm) => {
    const vmBytes = publicKeyBytesOf(getPublicJwkFromVerificationMethod(vm))
    return vmBytes !== undefined && constantTimeEqual(vmBytes, senderKeyBytes)
  })
}

/** Our sender-role OOB record whose v2 invitation was issued from `did`, if any. */
export async function findOwnV2InvitationRecord(
  agent: V2BindingAgent,
  did: string
): Promise<DidCommOutOfBandRecord | undefined> {
  const repository = agent.dependencyManager.container.resolve<DidCommOutOfBandRepository>(DidCommOutOfBandRepository)
  const records = await repository.findByQuery(agent.context, { role: DidCommOutOfBandRole.Sender })
  return records.find((record) => record.outOfBandInvitation.v2Invitation?.from === did)
}

/**
 * The connection for an authenticated v2 message that arrived with none,
 * created when the message is the first contact on one of our invitations.
 * Undefined when `to` is not an invitation of ours — the caller must then
 * treat the message as unassociated.
 */
export async function ensureV2ConnectionForFirstContact(
  agent: V2BindingAgent,
  contact: V2FirstContact
): Promise<DidCommConnectionRecord | undefined> {
  const connectionService =
    agent.dependencyManager.container.resolve<DidCommConnectionService>(DidCommConnectionService)

  const existing = await connectionService.findByDids(agent.context, { ourDid: contact.to, theirDid: contact.from })
  if (existing) return existing

  const invitationRecord = await findOwnV2InvitationRecord(agent, contact.to)
  if (!invitationRecord) return undefined

  // Never mint a connection whose counterparty identity is only a plaintext
  // claim: bind `from` to something the sender cryptographically controls
  // first. Fails closed (refuses) rather than falling back to trusting the
  // claim, on any resolution failure or key mismatch.
  if (!(await senderKeyBelongsToClaimedDid(agent, contact.from, contact.senderKey))) {
    agent.config.logger.warn(
      `[TrustTasks:v2FirstContact] refusing first contact from ${contact.from.slice(0, 32)}… on invitation ${invitationRecord.id} — its DID document does not list the key that authenticated this envelope`
    )
    return undefined
  }

  agent.config.logger.info(
    `[TrustTasks:v2FirstContact] first message from ${contact.from.slice(0, 32)}… on our invitation ${invitationRecord.id} — creating the inviter-side connection`
  )
  return connectionService.createConnection(
    agent.context,
    {
      protocol: DidCommHandshakeProtocol.None,
      // Same as Credo's own first-message creation: the inviter is the responder.
      role: DidCommDidExchangeRole.Responder,
      state: DidCommDidExchangeState.Completed,
      did: contact.to,
      theirDid: contact.from,
      outOfBandId: invitationRecord.id,
      invitationDid: contact.to,
      theirLabel: invitationRecord.outOfBandInvitation.v2Invitation?.body?.goal,
      didcommVersion: 'v2',
    },
    true
  )
}
