/**
 * Test support for the phone's own KERI identifiers: an in-memory record store (genericRecords) that throws on any
 * delete, and a fake KMS over @noble/curves that signs as Askar does (ES256: raw r || s over SHA-256 of the data).
 */
import { p256 } from '@noble/curves/nist.js'
import { ed25519 } from '@noble/curves/ed25519.js'

const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url')

/** An in-memory record store (genericRecords), throwing on any delete. */
export function fakeRecords() {
  const records: { id: string; content: Record<string, unknown>; tags: Record<string, string> }[] = []
  let n = 0
  const store = {
    records,
    findAllByQuery: jest.fn(async (q: Record<string, string>) =>
      records.filter((r) => Object.entries(q).every(([k, v]) => r.tags[k] === v))
    ),
    save: jest.fn(async ({ content, tags }: { content: Record<string, unknown>; tags: Record<string, string> }) => {
      const r = { id: `r${++n}`, content: { ...content }, tags: { ...tags } }
      records.push(r)
      return r
    }),
    update: jest.fn(async (r: { id: string; content: Record<string, unknown> }) => {
      const kept = records.find((x) => x.id === r.id)
      if (!kept) throw new Error('no such record')
      kept.content = { ...r.content }
    }),
    delete: jest.fn(async () => {
      throw new Error('a record was deleted')
    }),
    deleteById: jest.fn(async () => {
      throw new Error('a record was deleted')
    }),
  }
  return store
}

/** A fake KMS: P-256 and Ed25519 keys, ES256 signatures as raw r || s over SHA-256 of the data. */
export function fakeKms() {
  const keys = new Map<string, { crv: 'P-256' | 'Ed25519'; secret: Uint8Array }>()
  let n = 0
  return {
    keys,
    createKey: jest.fn(async ({ type }: { type: { kty: string; crv: 'P-256' | 'Ed25519' } }) => {
      const keyId = `k${++n}`
      if (type.crv === 'P-256') {
        const secret = p256.utils.randomSecretKey()
        const pub = p256.getPublicKey(secret, false)
        keys.set(keyId, { crv: 'P-256', secret })
        return { keyId, publicJwk: { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33)) } }
      }
      const secret = ed25519.utils.randomSecretKey()
      keys.set(keyId, { crv: 'Ed25519', secret })
      return { keyId, publicJwk: { kty: 'OKP', crv: 'Ed25519', x: b64u(ed25519.getPublicKey(secret)) } }
    }),
    sign: jest.fn(async ({ keyId, algorithm, data }: { keyId: string; algorithm: string; data: Uint8Array }) => {
      const key = keys.get(keyId)
      if (!key || algorithm !== 'ES256' || key.crv !== 'P-256') throw new Error('cannot sign')
      return { signature: p256.sign(data, key.secret, { prehash: true }) }
    }),
  }
}

