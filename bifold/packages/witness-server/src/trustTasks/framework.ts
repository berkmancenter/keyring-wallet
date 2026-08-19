/**
 * Minimal Trust Task consume/respond helpers for the witness — local because
 * `@openvtc/trust-tasks` ships ESM-only (`exports` with `import` conditions
 * exclusively) and this package runs as CommonJS under ts-node. The WALLET
 * side consumes through the real framework runtime — that is where full §7.2
 * conformance lives; the witness needs the core items only: the identity
 * cross-check (in-band `issuer` must be the transport-authenticated sender,
 * binding §4.8.1), the proof-presence gate for REQUIRED specs, a proof
 * verifier hook, and §8.2-shaped error documents. Replace with the real
 * runtime when it grows a CJS entry (recorded debt beside the documentProof
 * duplication).
 */

import { randomUUID } from 'node:crypto'

export const TRUST_TASK_ERROR_TYPE = 'https://trusttasks.org/spec/trust-task-error/0.3'

export interface ErrorPayload {
  code: string
  message: string
  retryable: boolean
  inResponseTo?: { typeUri: string; id?: string }
}

/** Build the success response: type + '#response', parties swapped, thread continued. */
export function respondWith(
  request: Record<string, unknown>,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const bare = String(request.type ?? '').split('#')[0]
  const response: Record<string, unknown> = {
    id: randomUUID(),
    threadId: request.threadId ?? request.id,
    type: `${bare}#response`,
    issuer: request.recipient,
    recipient: request.issuer,
    issuedAt: new Date().toISOString(),
    payload,
  }
  if (request.parentThreadId) response.parentThreadId = request.parentThreadId
  return response
}

/** Build a §8.2 trust-task-error naming the document it reports on. */
export function errorDocument(
  request: Record<string, unknown>,
  code: string,
  message: string
): Record<string, unknown> {
  const payload: ErrorPayload = {
    code,
    message,
    retryable: false,
    inResponseTo: { typeUri: String(request.type ?? ''), id: String(request.id ?? '') },
  }
  const response: Record<string, unknown> = {
    id: randomUUID(),
    threadId: request.threadId ?? request.id,
    type: TRUST_TASK_ERROR_TYPE,
    issuer: request.recipient,
    recipient: request.issuer,
    issuedAt: new Date().toISOString(),
    payload,
  }
  if (request.parentThreadId) response.parentThreadId = request.parentThreadId
  return response
}

export interface ConsumeOptions {
  document: Record<string, unknown>
  /** The transport-authenticated sender (the connection's theirDid). */
  senderDid: string
  /** Whether the spec declares the request proof REQUIRED. */
  proofRequired: boolean
  /** Verify the document's proof; consulted when a proof is present. */
  verifyProof?: (document: Record<string, unknown>) => Promise<boolean>
  /** Business handler; returns the reply document (success or error). */
  handler: (document: Record<string, unknown>) => Promise<Record<string, unknown>>
}

/**
 * The witness's consume: identity cross-check, proof presence for REQUIRED
 * specs, proof verification when present, then the handler. Every failure
 * produces an error document to send back — nothing goes silent.
 */
export async function consume(options: ConsumeOptions): Promise<Record<string, unknown>> {
  const { document, senderDid, proofRequired, verifyProof, handler } = options

  // Binding §4.8.1: never trust the in-band issuer over the transport identity.
  if (String(document.issuer ?? '') !== senderDid) {
    return errorDocument(document, 'identityMismatch', 'in-band issuer disagrees with the authenticated sender')
  }
  if (proofRequired && document.proof === undefined) {
    return errorDocument(document, 'proofRequired', 'specification declares proof REQUIRED but the document carries none')
  }
  if (document.proof !== undefined && verifyProof) {
    if (!(await verifyProof(document))) {
      return errorDocument(document, 'proofInvalid', 'the document proof did not verify')
    }
  }
  return handler(document)
}
