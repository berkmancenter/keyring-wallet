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
    /** Credo's Askar KMS fails a key it does not hold, naming the backend (TestFlight 239's message). */
    private async need(ctx: unknown, keyId: string) {
      const held = this.withSession
        ? await this.withSession(ctx, async (s) =>
            (s as { fetchKey: (o: { name: string }) => Promise<unknown> }).fetchKey({ name: keyId })
          )
        : null
      if (!held) throw new Error(`Key with key id '${keyId}' not found in backend '${this.backend}'`)
    }
    public async sign(ctx: unknown, options: { keyId: string }) {
      await this.need(ctx, options.keyId)
      return { signature: new Uint8Array([1]) }
    }
    public async decrypt(ctx: unknown, options: { keyAgreement: { keyId: string } }) {
      await this.need(ctx, options.keyAgreement.keyId)
      return { data: new Uint8Array([2]) }
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

describe('a copy not held when it is used is fetched first (TestFlight 239)', () => {
  const KEY = 'vta-copy:did:webvh:agent-b:did:webvh:tiger-silver#key-1'
  const importer = (kms: EphemeralKeyManagementService) => async (keyId: string) => {
    // The fetch asks whether the key is held, as holdPersonaKeys does, and must not wait on itself.
    await kms.getPublicKey(ctx, keyId)
    await kms.importKey(ctx, { privateJwk: { kid: keyId } } as never)
  }

  it('without a fetcher, a use fails as before, naming the in-memory backend', async () => {
    const kms = new EphemeralKeyManagementService()
    await expect(kms.sign(ctx, { keyId: KEY } as never)).rejects.toThrow(
      `Key with key id '${KEY}' not found in backend 'ephemeral'`
    )
  })

  it('sign, decrypt, getPublicKey (signing is routed by it) and withKey (TSP) each fetch, then go on', async () => {
    for (const use of [
      (kms: EphemeralKeyManagementService) => kms.sign(ctx, { keyId: KEY } as never),
      (kms: EphemeralKeyManagementService) => kms.decrypt(ctx, { keyAgreement: { keyId: KEY } } as never),
      (kms: EphemeralKeyManagementService) => kms.getPublicKey(ctx, KEY),
      (kms: EphemeralKeyManagementService) => kms.withKey(KEY, (key) => key),
    ]) {
      const kms = new EphemeralKeyManagementService()
      const fetch = jest.fn(importer(kms))
      kms.setMissingKeyFetcher(fetch)
      await expect(use(kms)).resolves.toBeTruthy()
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(fetch).toHaveBeenCalledWith(KEY)
    }
  })

  it('a key already held is not fetched again', async () => {
    const kms = new EphemeralKeyManagementService()
    await kms.importKey(ctx, { privateJwk: { kid: KEY } } as never)
    const fetch = jest.fn(importer(kms))
    kms.setMissingKeyFetcher(fetch)
    await kms.sign(ctx, { keyId: KEY } as never)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses at the same moment wait on one fetch', async () => {
    const kms = new EphemeralKeyManagementService()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const fetch = jest.fn(async (keyId: string) => {
      await gate
      await importer(kms)(keyId)
    })
    kms.setMissingKeyFetcher(fetch)
    const uses = [kms.sign(ctx, { keyId: KEY } as never), kms.decrypt(ctx, { keyAgreement: { keyId: KEY } } as never)]
    release()
    await expect(Promise.all(uses)).resolves.toHaveLength(2)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('a fetch that fails lets the use fail as before, and is not asked again at once', async () => {
    const kms = new EphemeralKeyManagementService()
    const fetch = jest.fn(async () => {
      throw new Error('the agent is not reachable')
    })
    kms.setMissingKeyFetcher(fetch)
    await expect(kms.sign(ctx, { keyId: KEY } as never)).rejects.toThrow(/not found in backend 'ephemeral'/)
    await expect(kms.sign(ctx, { keyId: KEY } as never)).rejects.toThrow(/not found/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('a wallet key never reaches the fetcher', async () => {
    const kms = new EphemeralKeyManagementService()
    const fetch = jest.fn(importer(kms))
    kms.setMissingKeyFetcher(fetch)
    await expect(kms.getPublicKey(ctx, 'wallet-connection-key')).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('isHeld answers without fetching', async () => {
    const kms = new EphemeralKeyManagementService()
    const fetch = jest.fn(importer(kms))
    kms.setMissingKeyFetcher(fetch)
    await expect(kms.isHeld(KEY)).resolves.toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})
