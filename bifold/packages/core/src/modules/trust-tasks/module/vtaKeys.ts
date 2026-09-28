/**
 * vtaKeys — borrowing a key the VTA holds.
 *
 * Upstream's reference client does exactly this: a persona's keys live in the
 * VTA, and a client that must sign or seal as the persona fetches the private
 * half over its authenticated session (`keys/export-secret/0.1`), uses it, and
 * treats "no VTA session" as "this persona is unavailable". Keyring does the
 * same, importing the borrowed key into its KMS so Credo's envelope service can
 * seal with it. A persona's copy goes to the in-memory backend only
 * (EphemeralKeyManagementService, #10): it is fetched again each session and
 * never written to the wallet's store.
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
 * The public half comes from the VTA too, so nothing is derived here. With
 * `into`, the key goes to that backend under that id — a persona's copy goes
 * to the in-memory backend under an id derived from the agent's own key id, so
 * the same key has the same id every session and a copy fetched again replaces
 * the last one.
 */
export async function importVtaKey(
  agent: Agent,
  exported: VtaExportedKey,
  into?: { backend: string; keyId: string }
): Promise<{ keyId: string; curve: Curve }> {
  const fallback = curveOf(exported.keyType)
  const priv = decodeMultibaseKey(exported.privateKeyMultibase, fallback)
  const pub = decodeMultibaseKey(exported.publicKeyMultibase, priv.curve)
  if (pub.curve !== priv.curve) {
    throw new Error(`vtaKeys: public (${pub.curve}) and private (${priv.curve}) halves disagree`)
  }
  if (into) {
    await Promise.resolve()
      .then(() => agent.kms.deleteKey({ keyId: into.keyId, backend: into.backend }))
      .catch(() => false)
  }
  const imported = await agent.kms.importKey({
    ...(into ? { backend: into.backend } : {}),
    privateJwk: {
      kty: 'OKP',
      crv: priv.curve,
      d: TypedArrayEncoder.toBase64Url(priv.bytes),
      x: TypedArrayEncoder.toBase64Url(pub.bytes),
      ...(into ? { kid: into.keyId } : {}),
    },
  })
  return { keyId: imported.keyId, curve: priv.curve }
}

/** The KMS backend holding persona key copies in memory only (EphemeralKeyManagementService). */
export const EPHEMERAL_KMS_BACKEND = 'ephemeral'

const IN_MEMORY_PREFIX = 'vta-copy:'

/** The in-memory KMS id of this phone's copy of the agent's key `vtaKeyId`. */
export function inMemoryKeyId(vtaDid: string, vtaKeyId: string): string {
  return `${IN_MEMORY_PREFIX}${vtaDid}:${vtaKeyId}`
}

/** Whether a KMS key id names an in-memory copy (as opposed to a key in the wallet's store). */
export function isInMemoryKeyId(keyId: string): boolean {
  return keyId.startsWith(IN_MEMORY_PREFIX)
}

/**
 * Delete this phone's copy of a key, wherever it is held: an in-memory copy
 * from the in-memory backend, anything else from the wallet's store (Credo
 * deletes from its first backend unless told which). Never throws.
 */
export async function forgetKeyCopy(agent: Agent, keyId: string): Promise<void> {
  const backend = isInMemoryKeyId(keyId) ? EPHEMERAL_KMS_BACKEND : undefined
  await Promise.resolve()
    .then(() => agent.kms.deleteKey({ keyId, ...(backend ? { backend } : {}) }))
    .catch(() => undefined)
}
