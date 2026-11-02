/**
 * The in-memory backend for persona key copies (#10, plan part C): its own
 * store, in memory, opened only when a key arrives and gone when cleared. The
 * crypto is Credo's own Askar KMS; the TSP adapter's test shows key agreement
 * finding a held key, and the lab run shows the phone signing with one.
 */
type Provisioned = {
  uri: string
  closed: boolean
  /** Sessions open now, and what each close and the store's close did, in order. */
  open: number
  log: string[]
  /** The next session opens fail with this, as Askar's do. */
  failOpen?: string
  /** Held open before failing: a use that started on this store and hears only later. */
  failsLate?: Promise<void>
}
const provisioned: Provisioned[] = []

jest.mock('@openwallet-foundation/askar-shared', () => {
  const actual = jest.requireActual('@openwallet-foundation/askar-shared')
  return {
    ...actual,
    Store: {
      provision: jest.fn(async ({ uri }: { uri: string }) => {
        const entry: Provisioned = { uri, closed: false, open: 0, log: [] }
        provisioned.push(entry)
        const keys = new Map<string, unknown>()
        return {
          session: () => ({
            open: async () => {
              if (entry.failOpen) {
                const late = entry.failsLate
                entry.failsLate = undefined
                await late
                throw new Error(entry.failOpen)
              }
              entry.open++
              return {
                fetchKey: async ({ name }: { name: string }) => (keys.has(name) ? { key: keys.get(name) } : null),
                insertKey: async ({ name, key }: { name: string; key: unknown }) => void keys.set(name, key),
                close: async () => {
                  entry.open--
                  entry.log.push('session closed')
                },
              }
            },
          }),
          close: async () => {
            entry.closed = true
            entry.log.push('store closed')
          },
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
        ? this.withSession(ctx, async (s) =>
            (s as { fetchKey: (o: { name: string }) => Promise<unknown> }).fetchKey({ name: keyId })
          )
        : null
    }
    public async getPublicKey(ctx: unknown, keyId: string) {
      return this.withSession!(ctx, async (s) =>
        (await (s as { fetchKey: (o: { name: string }) => Promise<unknown> }).fetchKey({ name: keyId }))
          ? { kid: keyId }
          : null
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
    public async decrypt(
      ctx: unknown,
      options: { key?: { keyAgreement?: { keyId: string } }; keyAgreement?: { keyId: string } }
    ) {
      await this.need(ctx, (options.key?.keyAgreement ?? options.keyAgreement)?.keyId as string)
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

import {
  EphemeralKeyManagementService,
  FETCH_RETRY_MS,
  KeyCopyUnavailable,
} from '../module/EphemeralKeyManagementService'

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

// An in-memory database lasts while a connection to it is open, and the pool closes one left idle: every session then
// failed "no such table: profiles", until a relaunch (SFSP-52TJ).
describe('the in-memory database stays, and comes back if it goes', () => {
  const GONE = 'Error pinging session\nCaused by: error returned from database: (code: 1) no such table: profiles'
  const ctx = {} as never
  const KEY = 'vta-copy:one'
  const sign = (kms: EphemeralKeyManagementService) =>
    kms.sign(ctx, { keyId: KEY, algorithm: 'EdDSA', data: new Uint8Array([1]) } as never)
  const importKey = (kms: EphemeralKeyManagementService) =>
    kms.importKey(ctx, { privateJwk: { kid: KEY, kty: 'OKP', crv: 'Ed25519', x: 'x', d: 'd' } } as never)
  const fetcherFor = (kms: EphemeralKeyManagementService) => {
    const fetch = jest.fn(async () => void (await importKey(kms)))
    kms.setMissingKeyFetcher(fetch)
    return fetch
  }
  let warn: jest.SpyInstance

  beforeEach(() => {
    provisioned.length = 0
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => warn.mockRestore())

  it('keeps one session open for the store, past every use', async () => {
    const kms = new EphemeralKeyManagementService()
    await importKey(kms)
    await importKey(kms).catch(() => undefined)
    expect(provisioned[0].open).toBe(1)
  })

  it('closes that session, then the store, when cleared', async () => {
    const kms = new EphemeralKeyManagementService()
    await importKey(kms)
    provisioned[0].log.length = 0
    await kms.clear()
    expect(provisioned[0].log).toEqual(['session closed', 'store closed'])
    expect(provisioned[0].open).toBe(0)
  })

  it('leaves nothing open when cleared while the store is still being made', async () => {
    const kms = new EphemeralKeyManagementService()
    const importing = importKey(kms).catch(() => undefined)
    await kms.clear()
    await importing
    await kms.clear()
    expect(provisioned.every((p) => p.open === 0 && p.closed)).toBe(true)
  })

  it('works without that session if it cannot open', async () => {
    const kms = new EphemeralKeyManagementService()
    const { Store } = jest.requireMock('@openwallet-foundation/askar-shared') as {
      Store: { provision: jest.Mock }
    }
    const real = Store.provision.getMockImplementation()!
    Store.provision.mockImplementationOnce(async (options: unknown) => {
      const store = await real(options)
      const session = store.session
      let first = true
      store.session = () => {
        if (!first) return session()
        first = false
        return { open: async () => Promise.reject(new Error('busy')) }
      }
      return store
    })
    await importKey(kms)
    expect(await kms.isHeld(KEY)).toBe(true)
  })

  it('a database gone is made again, the key fetched again, and the use goes on', async () => {
    const kms = new EphemeralKeyManagementService()
    const fetch = fetcherFor(kms)
    await sign(kms)
    expect(fetch).toHaveBeenCalledTimes(1)
    provisioned[0].failOpen = GONE

    await expect(sign(kms)).resolves.toBeTruthy()
    expect(provisioned).toHaveLength(2)
    expect(provisioned[0].closed).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(provisioned[1].open).toBe(1)
  })

  it('is made again once however many uses find it gone', async () => {
    const kms = new EphemeralKeyManagementService()
    fetcherFor(kms)
    await sign(kms)
    provisioned[0].failOpen = GONE

    await Promise.all([sign(kms), sign(kms), sign(kms), sign(kms)])
    expect(provisioned).toHaveLength(2)
  })

  it('a use that hears late about the old store leaves the new one alone', async () => {
    const kms = new EphemeralKeyManagementService()
    fetcherFor(kms)
    await sign(kms)
    let release: () => void = () => undefined
    provisioned[0].failsLate = new Promise((resolve) => (release = resolve))
    provisioned[0].failOpen = GONE
    const late = sign(kms)
    await Promise.resolve()

    await sign(kms)
    expect(provisioned).toHaveLength(2)
    release()
    await late

    expect(provisioned).toHaveLength(2)
    expect(provisioned[1].closed).toBe(false)
  })

  it('a key that failed to fetch a moment ago is asked for again once the database is back', async () => {
    const kms = new EphemeralKeyManagementService()
    await kms.importKey(ctx, {
      privateJwk: { kid: 'vta-copy:other', kty: 'OKP', crv: 'Ed25519', x: 'x', d: 'd' },
    } as never)
    const fetch = jest.fn(async () => {
      throw new Error('the agent is offline')
    })
    kms.setMissingKeyFetcher(fetch)
    await expect(sign(kms)).rejects.toThrow('the agent is offline')
    fetch.mockImplementation(async () => void (await importKey(kms)))
    provisioned[0].failOpen = GONE

    await expect(sign(kms)).resolves.toBeTruthy()
  })

  it('says in the Release log that it happened, naming no key', async () => {
    const kms = new EphemeralKeyManagementService()
    fetcherFor(kms)
    await sign(kms)
    provisioned[0].failOpen = GONE
    await sign(kms)
    const said = warn.mock.calls.map((c) => String(c[0])).join('\n')
    expect(said).toContain('in-memory key store')
    expect(said).not.toContain(KEY)
  })

  it('without a way to fetch, the use fails as any missing key does, and does not loop', async () => {
    const kms = new EphemeralKeyManagementService()
    await importKey(kms)
    provisioned[0].failOpen = GONE
    await expect(sign(kms)).rejects.toThrow(/not found in backend/)
    expect(provisioned).toHaveLength(2)
  })

  it('leaves any other failure alone: the store and its keys stay', async () => {
    const kms = new EphemeralKeyManagementService()
    fetcherFor(kms)
    await sign(kms)
    provisioned[0].failOpen = 'Error acquiring pool connection'

    await expect(sign(kms)).rejects.toThrow('Error acquiring pool connection')
    expect(provisioned).toHaveLength(1)
    expect(provisioned[0].closed).toBe(false)
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
      // Credo 0.7.1's shape, as the app ships it.
      (kms: EphemeralKeyManagementService) => kms.decrypt(ctx, { key: { keyAgreement: { keyId: KEY } } } as never),
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

  it('a fetch that fails makes the use fail saying why (#422), and is not asked again at once', async () => {
    const kms = new EphemeralKeyManagementService()
    const fetch = jest.fn(async () => {
      throw new Error('did:webvh:agent did not come online within 20 s')
    })
    kms.setMissingKeyFetcher(fetch)
    // Not the bare "not found in backend 'ephemeral'", which said the same for
    // every cause: the fetcher's own reason, in a typed error.
    const failure = await kms.sign(ctx, { keyId: KEY } as never).catch((e) => e)
    expect(failure).toBeInstanceOf(KeyCopyUnavailable)
    expect(failure.keyId).toBe(KEY)
    expect(failure.reason).toMatch(/did not come online/)
    await expect(kms.decrypt(ctx, { keyAgreement: { keyId: KEY } } as never)).rejects.toThrow(/did not come online/)
    expect(fetch).toHaveBeenCalledTimes(1)
    // Routing still asks every backend for a key: getPublicKey answers null, never throws.
    await expect(kms.getPublicKey(ctx, KEY)).resolves.toBeNull()
  })

  it('a key whose fetch failed is asked for again after the pause, within the inbox look', async () => {
    const kms = new EphemeralKeyManagementService()
    let fail = true
    const fetch = jest.fn(async (keyId: string) => {
      if (fail) throw new Error('the agent is not reachable')
      await importer(kms)(keyId)
    })
    kms.setMissingKeyFetcher(fetch)
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    await expect(kms.sign(ctx, { keyId: KEY } as never)).rejects.toThrow(/could not be fetched/)
    fail = false
    now.mockReturnValue(1_000_000 + FETCH_RETRY_MS)
    await expect(kms.sign(ctx, { keyId: KEY } as never)).resolves.toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(FETCH_RETRY_MS).toBeLessThan(30_000)
    now.mockRestore()
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
