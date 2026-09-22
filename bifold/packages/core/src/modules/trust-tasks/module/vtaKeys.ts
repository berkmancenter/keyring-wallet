/**
 * vtaKeys — borrowing a key the VTA holds.
 *
 * Upstream's reference client does exactly this: a persona's keys live in the
 * VTA, and a client that must sign or seal as the persona fetches the private
 * half over its authenticated session (`keys/export-secret/0.1`), uses it, and
 * treats "no VTA session" as "this persona is unavailable". Keyring does the
 * same, importing the borrowed key into its own KMS so Credo's envelope service
 * can seal with it — and never writing it anywhere else.
 *
 * The VTA hands keys back as multibase strings. Measured shapes: a Multikey
 * (`z` + base58btc of a two-byte codec prefix + the raw key), which is what the
 * DID-hosting daemon prints at setup, and a bare seed (`z` + base58btc of 32
 * bytes), which is what `vta export-admin` produces. Both are accepted.
 *
 * @module trust-tasks/module/vtaKeys
 */

import type { Agent } from '@credo-ts/core'
import { TypedArrayEncoder } from '@credo-ts/core'

/** What `keys/export-secret/0.1` returns. */
export interface VtaExportedKey {
  keyId: string
  keyType: string
  publicKeyMultibase: string
  privateKeyMultibase: string
}

type Curve = 'Ed25519' | 'X25519'

// Multicodec prefixes, varint-encoded, as they appear at the front of a Multikey.
const CODEC: Record<string, { curve: Curve; secret: boolean }> = {
  'ed01': { curve: 'Ed25519', secret: false },
  'ec01': { curve: 'X25519', secret: false },
  '8026': { curve: 'Ed25519', secret: true },
  '8226': { curve: 'X25519', secret: true },
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** Strip a Multikey prefix if there is one, returning the raw key and the curve it names. */
export function decodeMultibaseKey(multibase: string, fallbackCurve?: Curve): { bytes: Uint8Array; curve: Curve } {
  if (!multibase.startsWith('z')) throw new Error(`vtaKeys: unsupported multibase prefix in ${multibase.slice(0, 4)}`)
  const decoded = TypedArrayEncoder.fromBase58(multibase.slice(1))
  if (decoded.length === 34) {
    const codec = CODEC[hex(decoded.subarray(0, 2))]
    if (codec) return { bytes: decoded.subarray(2), curve: codec.curve }
  }
  if (decoded.length === 32 && fallbackCurve) return { bytes: decoded, curve: fallbackCurve }
  throw new Error(`vtaKeys: cannot read a ${decoded.length}-byte key`)
}

const curveOf = (keyType: string): Curve | undefined => {
  const t = keyType.toLowerCase()
  if (t.includes('ed25519')) return 'Ed25519'
  if (t.includes('x25519')) return 'X25519'
  return undefined
}

/**
 * Import a key the VTA released into the wallet's KMS, returning the KMS key id.
 * The public half comes from the VTA too, so nothing is derived here.
 */
export async function importVtaKey(agent: Agent, exported: VtaExportedKey): Promise<{ keyId: string; curve: Curve }> {
  const fallback = curveOf(exported.keyType)
  const priv = decodeMultibaseKey(exported.privateKeyMultibase, fallback)
  const pub = decodeMultibaseKey(exported.publicKeyMultibase, priv.curve)
  if (pub.curve !== priv.curve) {
    throw new Error(`vtaKeys: public (${pub.curve}) and private (${priv.curve}) halves disagree`)
  }
  const imported = await agent.kms.importKey({
    privateJwk: {
      kty: 'OKP',
      crv: priv.curve,
      d: TypedArrayEncoder.toBase64Url(priv.bytes),
      x: TypedArrayEncoder.toBase64Url(pub.bytes),
    },
  })
  return { keyId: imported.keyId, curve: priv.curve }
}
