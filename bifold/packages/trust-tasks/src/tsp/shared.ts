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

/**
 * Can this codec form a TSP relationship — that is, send the introduction a
 * Rev 3 peer requires before it will accept anything?
 *
 * **Yes, since `packInviteRev3`.** What follows is why it has to be asked at
 * all, because the failure it prevents is silent. TSP Rev 3 makes the introduction
 * mandatory: two parties exchange one before any real traffic, and without it
 * traffic is **dropped rather than refused** — no answer, no error, nothing on
 * the wire to read. `decodePayloadFrameRev3` recognises the relationship-forming
 * control frames (`XRFI`/`XRFA`/`XRFD`) and refuses them by name; nothing here
 * emits one.
 *
 * Measured 2026-09-21: with the community VTC advertising `TSPTransport`, the
 * vetting ceremony ran the whole way through — card sent, statement issued,
 * requirements met — and then died at *Apply*, the one leg that talks to the
 * community. Silently, exactly as the revision specifies.
 *
 * Envelope selection reads this so it never chooses a transport it cannot
 * complete a handshake on. Wallet-to-wallet TSP is unaffected and still works,
 * because both ends are this codec and neither asks for an introduction — it
 * is a peer running the upstream stack that will not talk to us.
 *
 * Upstream's own `@openvtc/vti-tsp-js` exports `packInvite`, `packNested` and
 * `resolveInviteRace`: that is the shape of the work, and flipping this
 * constant is what switches the ecosystem legs over once it exists.
 */
export const CODEC_FORMS_RELATIONSHIPS = true
