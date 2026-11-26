/**
 * The bundled registry `v1` context is the real, byte-frozen document, not a
 * stand-in. dtgwg-cred-spec (`spec/body.md`, Context Versions) pins its
 * SHA-256; this asserts the bytes we ship still match that digest, so an edit
 * to the bundled copy (or a re-serialization of it) turns this suite red.
 * Source of truth for the digest: dtgwg-cred-spec 94af2d8, registry bytes at
 * dtgwg-vsc-registry eb29484 (vsc-migration-plan D7 / G26).
 */
import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'

import {
  REGISTRY_DTG_CONTEXT_DIGEST_MULTIBASE,
  REGISTRY_DTG_CONTEXT_DOCUMENT,
  REGISTRY_DTG_CONTEXT_SHA256_HEX,
  REGISTRY_DTG_CONTEXT_SOURCE,
  REGISTRY_DTG_CONTEXT_URL,
} from '@bifold/vrc-contexts'

import { CUSTOM_CONTEXTS } from '../../jsonLdDocumentLoader'

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function base58btc(bytes: Buffer): string {
  let n = BigInt('0x' + bytes.toString('hex'))
  let out = ''
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out
    n /= 58n
  }
  for (const b of bytes) {
    if (b !== 0) break
    out = '1' + out
  }
  return out
}

describe('registry v1 context pin', () => {
  test('bundled bytes hash to the digest the spec pins (hex)', () => {
    const hex = createHash('sha256').update(Buffer.from(REGISTRY_DTG_CONTEXT_SOURCE, 'utf8')).digest('hex')
    expect(hex).toBe('3e1376acf401016a0162c1cdb31e44a85a7dd56749caed94a1dc0a0be6cbb448')
    expect(hex).toBe(REGISTRY_DTG_CONTEXT_SHA256_HEX)
  })

  test('bundled bytes hash to the digest the spec pins (multihash, multibase base58btc)', () => {
    const digest = createHash('sha256').update(Buffer.from(REGISTRY_DTG_CONTEXT_SOURCE, 'utf8')).digest()
    const multihash = Buffer.concat([Buffer.from([0x12, 0x20]), digest])
    expect('z' + base58btc(multihash)).toBe('zQmSWyCagdx8oPfXn3piSUx6yqVy5MZ7ZG7nW1TC64QvKZh')
    expect(REGISTRY_DTG_CONTEXT_DIGEST_MULTIBASE).toBe('zQmSWyCagdx8oPfXn3piSUx6yqVy5MZ7ZG7nW1TC64QvKZh')
  })

  test('the exported document is exactly the parsed bytes', () => {
    expect(REGISTRY_DTG_CONTEXT_DOCUMENT).toEqual(JSON.parse(REGISTRY_DTG_CONTEXT_SOURCE))
    expect(Object.keys(REGISTRY_DTG_CONTEXT_DOCUMENT['@context']).length).toBeGreaterThan(18)
  })

  test('matches the pinned upstream clone byte for byte when external/ is present', () => {
    const p = path.resolve(__dirname, '../../../../../../../../external/dtgwg-vsc-registry/contexts/v1.jsonld')
    if (!fs.existsSync(p)) return // external/ is gitignored and not present in every checkout
    expect(fs.readFileSync(p, 'utf8')).toBe(REGISTRY_DTG_CONTEXT_SOURCE)
  })

  test('the bundled CUSTOM_CONTEXTS map (used by the other loaders) serves the pinned document', () => {
    expect(CUSTOM_CONTEXTS[REGISTRY_DTG_CONTEXT_URL]).toBe(REGISTRY_DTG_CONTEXT_DOCUMENT)
  })
})
