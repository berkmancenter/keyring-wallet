/**
 * Signature checks for the key codes in ./codes.ts, with @noble/curves v2 (already a core dependency). P-256 as
 * cesr-ts 2.0.0 does it (verfer.js): ECDSA over SHA-256 of the message (prehash), and high-S signatures accepted
 * (lowS false), since keripy does not normalise S.
 *
 * @module sedi/cesr/signatures
 */
import { ed25519 } from '@noble/curves/ed25519.js'
import { p256 } from '@noble/curves/nist.js'

import { INDEXED_SIGS, KEYS } from './codes'
import { keyCode, rawOf } from './qb64'
import type { IndexedSig } from './reader'

/** True when `sig` is a valid signature by the key `keyQb64` over `message`. False for any code this reader lacks. */
export function verifySignature(keyQb64: string, sig: IndexedSig, message: Uint8Array): boolean {
  const code = keyCode(keyQb64)
  const sigKind = INDEXED_SIGS[sig.code]
  if (!code || !sigKind || KEYS[code].curve !== sigKind.curve) return false
  const key = rawOf(keyQb64, code.length)
  try {
    return KEYS[code].curve === 'p256'
      ? p256.verify(sig.raw, message, key, { lowS: false, prehash: true })
      : ed25519.verify(sig.raw, message, key)
  } catch {
    return false
  }
}
