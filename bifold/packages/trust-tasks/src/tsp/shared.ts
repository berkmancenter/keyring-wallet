/**
 * Types and byte helpers shared by the two revision codecs (`./rev2`,
 * `./rev3`) and the dispatcher (`./direct`).
 *
 * @module trust-tasks/tsp/shared
 */

import type { MessageType } from '@openvtc/vti-tsp-js'

export type { MessageType }

/** The wire revision a message was framed with. */
export type TspRevision = 'rev2' | 'rev3'

/** The application layouts this package packs. A relationship-forming
 *  control message (`XRFI`/`XRFA`/`XRFD`) is not one of them. */
export type ApplicationKind = 'direct' | 'nested' | 'routed'

export interface PackedMessage {
  /** Raw wire bytes. */
  bytes: Uint8Array
  /** The TSP thread digest: SHA-256 of the plaintext payload frame. */
  threadDigest: Uint8Array
  /** Which revision the bytes were framed with. */
  revision: TspRevision
}

export interface UnpackedMessage {
  /** The decrypted message body. */
  payload: Uint8Array
  /** Sender VID (from the cleartext envelope). */
  sender: string
  /** Receiver VID (from the cleartext envelope). */
  receiver: string
  /** The message kind recovered from the payload frame. */
  messageType: MessageType
  /** Remaining route for a Routed message (empty for Direct/Nested). */
  hops: string[]
  /** SHA-256 of the decrypted payload frame — the TSP thread digest. */
  threadDigest: Uint8Array
  /** Which revision framed this message. A caller that records what a peer
   *  speaks (`tsp_rev3_subtask.md` §2.2) reads it here; nothing in this
   *  package selects a packer from it. */
  revision: TspRevision
}

export const utf8 = new TextEncoder()

/**
 * Strict UTF-8 decode (rejects malformed input rather than silently
 * replacing it) — needed so a corrupted or attacker-crafted routing hop
 * can't decode into a garbled-but-plausible-looking VID string. `TextDecoder`
 * with `{ fatal: true }` gives this for free on Node and browsers, but React
 * Native's Hermes runtime implements `TextDecoder` without the `fatal`
 * option and throws just constructing it — feature-detect once at module
 * load and fall back to a decode/re-encode round-trip check, which gives
 * the same strictness without relying on that option.
 */
export function makeStrictUtf8Decode(): (bytes: Uint8Array) => string {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    return (bytes) => decoder.decode(bytes)
  } catch {
    const lenient = new TextDecoder('utf-8')
    return (bytes) => {
      const text = lenient.decode(bytes)
      if (!bytesEqual(utf8.encode(text), bytes)) {
        throw new TypeError('invalid UTF-8')
      }
      return text
    }
  }
}

export const decodeUtf8Strict = makeStrictUtf8Decode()

export function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
