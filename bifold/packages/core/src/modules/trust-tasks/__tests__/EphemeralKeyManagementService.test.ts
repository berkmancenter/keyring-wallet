/**
 * The in-memory backend for persona key copies (#10, plan part C): its own
 * store, in memory, opened only when a key arrives and gone when cleared. The
 * crypto is Credo's own Askar KMS; the TSP adapter's test shows key agreement
 * finding a held key, and the lab run shows the phone signing with one.
 */
const provisioned: { uri: string; closed: boolean }[] = []

jest.mock('@openwallet-foundation/askar-shared', () => {
  const actual = jest.requireActual('@openwallet-foundation/askar-shared')
  return {
    ...actual,
    Store: {
      provision: jest.fn(async ({ uri }: { uri: string }) => {
        const entry = { uri, closed: false }
        provisioned.push(entry)
        const keys = new Map<string, unknown>()
        return {
          session: () => ({
            open: async () => ({
              fetchKey: async ({ name }: { name: string }) => (keys.has(name) ? { key: keys.get(name) } : null),
              insertKey: async ({ name, key }: { name: string; key: unknown }) => void keys.set(name, key),
              close: async () => undefined,
            }),
          }),
          close: async () => void (entry.closed = true),
        }
      }),
    },
  }
})

jest.mock('@credo-ts/askar', () => ({
  AskarKeyManagementService: class {
    public backend = 'askar'
    public withSession?: (ctx: unknown, cb: (session: unknown) => Promise<unknown>) => Promise<unknown>
    public isOperationSupported() {
      return true
    }
    public async fetchAskarKey(ctx: unknown, keyId: string) {
      return this.withSession
        ? this.withSession(ctx, async (s) => (s as { fetchKey: (o: { name: string }) => Promise<unknown> }).fetchKey({ name: keyId }))
        : null
    }
    public async getPublicKey(ctx: unknown, keyId: string) {
      return this.withSession!(ctx, async (s) =>
        (await (s as { fetchKey: (o: { name: string }) => Promise<unknown> }).fetchKey({ name: keyId })) ? { kid: keyId } : null
      )
    }
    public async importKey(ctx: unknown, options: { privateJwk: { kid: string } }) {
      await this.withSession!(ctx, (s) =>
        (s as { insertKey: (o: { name: string; key: unknown }) => Promise<void> }).insertKey({
          name: options.privateJwk.kid,
          key: { secret: 'held' },
        })
      )
      return { keyId: options.privateJwk.kid }
    }
  },
}))

import { EphemeralKeyManagementService } from '../module/EphemeralKeyManagementService'

const ctx = {} as never

beforeEach(() => {
  provisioned.length = 0
})

describe('the in-memory key backend', () => {
  it('is named for the in-memory copies, and claims only operations on its own keys', () => {
    const kms = new EphemeralKeyManagementService()
    expect(kms.backend).toBe('ephemeral')
    expect((kms as unknown as { askar: { backend: string } }).askar.backend).toBe('ephemeral')
    const supports = (op: object) => kms.isOperationSupported(ctx, op as never)
    // The wallet's: new keys, its own imports, deletes, random bytes.
    expect(supports({ operation: 'createKey' })).toBe(false)
    expect(supports({ operation: 'importKey', privateJwk: { kid: '3f1c-wallet-uuid' } })).toBe(false)
    expect(supports({ operation: 'importKey', privateJwk: {} })).toBe(false)
    expect(supports({ operation: 'deleteKey' })).toBe(false)
    expect(supports({ operation: 'randomBytes' })).toBe(false)
    // Ours: a copy imported for memory, and key agreement with one of our keys —
    // which Credo routes by backend order, so it must be claimed here.
    expect(supports({ operation: 'importKey', privateJwk: { kid: 'vta-copy:agent:persona#key-1' } })).toBe(true)
    expect(supports({ operation: 'decrypt', keyAgreement: { keyId: 'vta-copy:agent:persona#key-1' } })).toBe(true)
    expect(supports({ operation: 'encrypt', keyAgreement: { keyId: 'vta-copy:agent:persona#key-1' } })).toBe(true)
    expect(supports({ operation: 'decrypt', keyAgreement: { keyId: 'wallet-connection-key' } })).toBe(false)
    expect(supports({ operation: 'encrypt', keyAgreement: {} })).toBe(false)
    // Signing is routed by key id; only our keys are found here.
    expect(supports({ operation: 'sign' })).toBe(true)
  })

  it('opens no store until a key arrives, and then an in-memory one', async () => {
    const kms = new EphemeralKeyManagementService()
    await expect(kms.getPublicKey(ctx, 'vta-copy:a:k')).resolves.toBeNull()
    await expect(kms.withKey('vta-copy:a:k', () => true)).resolves.toBeUndefined()
    expect(provisioned).toEqual([])

    await kms.importKey(ctx, { privateJwk: { kid: 'vta-copy:a:k' } } as never)
    expect(provisioned.map((p) => p.uri)).toEqual(['sqlite://:memory:'])
    await expect(kms.getPublicKey(ctx, 'vta-copy:a:k')).resolves.toEqual({ kid: 'vta-copy:a:k' })
    await expect(kms.withKey('vta-copy:a:k', (key) => key)).resolves.toEqual({ secret: 'held' })
  })

  it('forgets every key when cleared, and starts a fresh store for the next', async () => {
    const kms = new EphemeralKeyManagementService()
    await kms.importKey(ctx, { privateJwk: { kid: 'vta-copy:a:k' } } as never)
    await kms.clear()
    expect(provisioned[0].closed).toBe(true)
    await expect(kms.getPublicKey(ctx, 'vta-copy:a:k')).resolves.toBeNull()
    await expect(kms.withKey('vta-copy:a:k', () => true)).resolves.toBeUndefined()

    await kms.importKey(ctx, { privateJwk: { kid: 'vta-copy:a:k2' } } as never)
    expect(provisioned).toHaveLength(2)
    await expect(kms.getPublicKey(ctx, 'vta-copy:a:k')).resolves.toBeNull()
  })
})
