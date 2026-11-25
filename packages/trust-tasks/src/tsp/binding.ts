/**
 * The Trust Tasks **TSP transport binding** (`bindings/tsp/0.1`): a Trust
 * Task document rides a TSP message as the JSON serialisation of a small,
 * self-describing envelope object, so a receiver can tell a Trust Task
 * payload from anything else TSP might carry.
 *
 *   { "type": "https://trusttasks.org/binding/tsp/0.1/envelope",
 *     "document": { ...the Trust Task document... } }
 *
 * The authenticated `VID_sndr` of the TSP message is the framework's
 * transport-authenticated sender; a document's in-band `issuer`/`recipient`,
 * when present, must equal the transport's sender/receiver by exact string
 * comparison (binding §3, framework §4.8.1). That comparison is the caller's
 * — it is policy, and this module only frames.
 *
 * @module trust-tasks/tsp/binding
 */

import { decodeUtf8Strict, utf8 } from './shared'

export const TSP_BINDING_URI = 'https://trusttasks.org/binding/tsp/0.1'
export const TSP_BINDING_ENVELOPE_TYPE = 'https://trusttasks.org/binding/tsp/0.1/envelope'

/** The bytes TSP seals for a Trust Task document. */
export function encodeTrustTaskEnvelope(document: Record<string, unknown>): Uint8Array {
  return utf8.encode(JSON.stringify({ type: TSP_BINDING_ENVELOPE_TYPE, document }))
}

/**
 * Read a Trust Task document out of a decrypted TSP payload. Returns
 * `undefined` for a payload that is valid TSP but not a Trust Task envelope —
 * per binding §2 that is not an error, it is simply not dispatched here.
 * Throws on a payload that claims the envelope type but is malformed.
 */
export function decodeTrustTaskEnvelope(payload: Uint8Array): Record<string, unknown> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeUtf8Strict(payload))
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const envelope = parsed as { type?: unknown; document?: unknown }
  if (envelope.type !== TSP_BINDING_ENVELOPE_TYPE) return undefined
  const document = envelope.document
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('tsp binding: envelope carries no document object')
  }
  return document as Record<string, unknown>
}
