/**
 * sharedConnectCeremony — the document-level pieces of the shared-connect
 * sequence that need no connection (plan WP7): the challenge-shaped
 * `propose.id`, the `ceremony` member every step carries, and the proof.
 *
 * Six documents travel (the plan's table): 1 `propose` (scanner), 2
 * `propose#response` (inviter), 3 `issue` (inviter), 4 `issue#response`
 * receipt (scanner), 5 `issue` (scanner), 6 `issue#response` receipt (inviter).
 * All carry `threadId` equal to the `propose` id and a `ceremony` member whose
 * `enactment` is the link's `_id`; all are signed. `issuer` and `recipient`
 * are the encounter VIDs, in band.
 *
 * Pure apart from {@link signSharedConnectDocument}, which asks the agent's
 * KMS for the signature. The `ceremony` member is `{enactment, step}`, `step` a
 * string naming the request and its response (registry framework 0.5/0.6:
 * `step` is a string, and `definition` requires `definitionDigest`), so no
 * `definition` is sent until a published one has a digest (plan D7).
 *
 * @module trust-tasks/module/sharedConnectCeremony
 */

import { TypedArrayEncoder, type Agent } from '@credo-ts/core'

import { signDocumentProof } from '../documentProof'

import { SHARED_CONNECT_PROOF_SIGNER } from './sharedConnectDecisions'

/** The six steps, numbered as in the plan's table. */
export type SharedConnectStep = 1 | 2 | 3 | 4 | 5 | 6

/**
 * The step each document belongs to, as the `ceremony` member names it: a
 * request and its response share one step (Trust Tasks SPEC §4.11.2), so the
 * six documents are three steps, the names the in-process rungs' independent
 * inviter uses.
 */
export const SHARED_CONNECT_STEP_NAMES: Record<SharedConnectStep, string> = {
  1: 'propose',
  2: 'propose',
  3: 'issue-inviter',
  4: 'issue-inviter',
  5: 'issue-responder',
  6: 'issue-responder',
}

export interface CeremonyMember {
  enactment: string
  step: string
}

const B64URL = /^[A-Za-z0-9_-]{22}$/

/**
 * A 16-byte challenge as 22 characters of unpadded base64url: what `propose.id` is in this ceremony.
 * Credo's encoder, not `Buffer#toString('base64url')`: the app's Buffer is the `buffer` package, which
 * has no base64url and throws `TypeError: Unknown encoding` (Node's has it, so jest never saw this).
 */
export function newProposeId(randomBytes: (length: number) => Uint8Array): string {
  const bytes = randomBytes(16)
  if (bytes.length !== 16) throw new Error('newProposeId needs 16 random bytes')
  return TypedArrayEncoder.toBase64Url(bytes)
}

export const isChallengeShaped = (value: unknown): value is string => typeof value === 'string' && B64URL.test(value)

export function ceremonyMember(enactment: string, step: SharedConnectStep): CeremonyMember {
  return { enactment, step: SHARED_CONNECT_STEP_NAMES[step] }
}

export interface SharedConnectDocumentInput {
  /** The document's own id: the propose id for step 1, a fresh id for the rest. */
  id: string
  /** The type URI, e.g. `propose.TYPE_URI`, or that plus `#response`. */
  type: string
  /** The propose id, on every document. */
  threadId: string
  issuer: string
  recipient: string
  /** The link's `_id`. */
  enactment: string
  step: SharedConnectStep
  payload: Record<string, unknown>
  issuedAt?: string
}

/** An unsigned document with its thread and `ceremony` member in place. */
export function buildSharedConnectDocument(input: SharedConnectDocumentInput): Record<string, unknown> {
  return {
    id: input.id,
    type: input.type,
    threadId: input.threadId,
    issuer: input.issuer,
    recipient: input.recipient,
    issuedAt: input.issuedAt ?? new Date().toISOString(),
    ceremony: ceremonyMember(input.enactment, input.step),
    payload: input.payload,
  }
}

/** Why an inbound document does not belong to this encounter, or undefined when it does. */
export function encounterMismatch(
  document: Record<string, unknown>,
  expected: { enactment: string; threadId: string; myVid: string; theirVid: string }
): string | undefined {
  const ceremony = document.ceremony as Partial<CeremonyMember> | undefined
  if (!ceremony || ceremony.enactment !== expected.enactment) return 'enactment'
  if (document.threadId !== expected.threadId) return 'thread'
  if (document.recipient !== expected.myVid) return 'recipient'
  if (document.issuer !== expected.theirVid) return 'issuer'
  return undefined
}

/**
 * The DID that signs a document's proof, per decision 3: the issuer VID by
 * default. `relationshipDid` is used only when the decision is switched.
 */
export function proofSignerFor(document: Record<string, unknown>, relationshipDid?: string): string {
  if (SHARED_CONNECT_PROOF_SIGNER === 'relationship-did') {
    if (!relationshipDid) throw new Error('the relationship DID signs this document and none was given')
    return relationshipDid
  }
  return String(document.issuer)
}

/**
 * The DIDs whose proof an inbound document may carry: either key is accepted
 * inbound (plan D3), the issuer VID or the relationship DID if one is known.
 */
export function acceptableProofSigners(document: Record<string, unknown>, relationshipDid?: string): string[] {
  return [String(document.issuer), ...(relationshipDid ? [relationshipDid] : [])]
}

/**
 * The purpose every shared-connect STEP proof is made for, signed and verified alike. The encounter VID is a
 * did:peer:2 with a `.V` segment only, which lists its key under `authentication` and nowhere else, and a
 * counterpart's verifier checks the method is listed under the proof's purpose; they sign their own steps this
 * way. The VRC credential inside `issue` is a different proof (its issuer lists the key under `assertionMethod`)
 * and keeps that purpose: sharedConnectCredential.ts.
 */
export const SHARED_CONNECT_STEP_PROOF_PURPOSE = 'authentication' as const

/** Sign a document (every step carries a proof, receipts included) for `authentication`. Returns a new document with its `proof` (whole-second timestamps, as a verifier rebuilds them). */
export async function signSharedConnectDocument(
  agent: Agent,
  document: Record<string, unknown>,
  relationshipDid?: string
): Promise<Record<string, unknown>> {
  return signDocumentProof(agent, document, proofSignerFor(document, relationshipDid), {
    proofPurpose: SHARED_CONNECT_STEP_PROOF_PURPOSE,
  })
}
