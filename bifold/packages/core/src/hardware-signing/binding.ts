/**
 * Content binding for hardware evidence (G33, Stage 1).
 *
 * Hardware evidence claims that the device key signed *this* content. That
 * holds only if the verifier recomputes the hash of the content it holds. A
 * hash carried inside the evidence is chosen by the evidence author, so it may
 * be compared against the recomputation but never stands in for it.
 *
 * `@noble/hashes` is pure JS (no `node:crypto`, which Hermes lacks) and is the
 * same SHA-256 `trust-tasks/deviceLocality.ts` uses on device.
 *
 * @module hardware-signing/binding
 */

import { sha256 } from '@noble/hashes/sha2.js'

import type { HardwareAttestationEvidence } from './types'

/** Stable prefix of the error the natives and this gate share. */
export const CONTENT_BINDING_MISMATCH = 'contentBindingMismatch'

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += BASE64[(n >> 18) & 63] + BASE64[(n >> 12) & 63]
    out += i + 1 < bytes.length ? BASE64[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? BASE64[n & 63] : '='
  }
  return out
}

/** base64(SHA-256(UTF-8(content))): the value the natives compare against and sign over. */
export function contentHashBase64(content: string): string {
  return toBase64(sha256(new TextEncoder().encode(content)))
}

/**
 * Compare the evidence's embedded `signature.signedContentHash`, when present,
 * with the hash of the content the verifier holds.
 */
export function checkEmbeddedContentHash(
  evidence: Pick<HardwareAttestationEvidence, 'signature'>,
  content: string
): { ok: true } | { ok: false; error: string } {
  const embedded = evidence.signature?.signedContentHash
  if (embedded === undefined || embedded === null || embedded === '') return { ok: true }
  if (embedded.replace(/\s+/g, '') === contentHashBase64(content)) return { ok: true }
  return {
    ok: false,
    error: `${CONTENT_BINDING_MISMATCH}: embedded signedContentHash does not equal SHA-256 of the credential content`,
  }
}
