/**
 * relaunch-keys-fetched-on-use (gate efficiency item 5): the Jest guard for
 * bifold #336's plain relaunch, so the gate's relaunch leg can fold into the
 * update leg. The device case: a phone linked to two agents, an identity under
 * the one that is NOT current, the app killed and started again (every key copy
 * gone from memory), then that identity used. Here the real in-memory backend
 * and the real agent controller meet, as they do on the phone: the use fetches
 * the copy through the identity's own agent, logs the line the gate's leg reads
 * (`grep -cE "fetched .*keys through its agent.*on use"`), and never fails with
 * TestFlight 239's "not found in backend".
 */
import { EphemeralKeyManagementService } from '../module/EphemeralKeyManagementService'
import type { VtiPersona } from '../module/VtiIdentityStore'
import { VtaAgentController } from '../module/vtaAgent'

jest.mock('@openwallet-foundation/askar-shared', () => {
  const actual = jest.requireActual('@openwallet-foundation/askar-shared')
  return {
    ...actual,
    Store: {
      provision: jest.fn(async () => {
        const keys = new Map<string, unknown>()
        return {
          session: () => ({
            open: async () => ({
              fetchKey: async ({ name }: { name: string }) => (keys.has(name) ? { key: keys.get(name) } : null),
              insertKey: async ({ name, key }: { name: string; key: unknown }) => void keys.set(name, key),
              close: async () => undefined,
            }),
          }),
          close: async () => undefined,
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
      return (await this.fetchAskarKey(ctx, keyId)) ? { kid: keyId } : null
    }
    /** Credo's Askar KMS fails a key it does not hold, naming the backend (TestFlight 239's message). */
    public async sign(ctx: unknown, options: { keyId: string }) {
      if (!(await this.fetchAskarKey(ctx, options.keyId))) {
        throw new Error(`Key with key id '${options.keyId}' not found in backend '${this.backend}'`)
      }
      return { signature: new Uint8Array([1]) }
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

// The current agent's own session never opens in this test: every call on its
// client hangs, and is recorded, so a fetch routed through it would show.
const mockCurrentSessionCalls: string[] = []
jest.mock('../module/VtaClient', () => {
  const actual = jest.requireActual('../module/VtaClient')
  return {
    ...actual,
    VtaClient: jest.fn().mockImplementation(
      () =>
        new Proxy(
          {},
          {
            get: (_target, prop) =>
              prop === 'then'
                ? undefined
                : (..._args: unknown[]) => {
                    mockCurrentSessionCalls.push(String(prop))
                    return new Promise(() => undefined)
                  },
          }
        )
    ),
  }
})

/** The pattern the gate's relaunch leg greps logcat for (e2e/gate/legs/relaunch-android.sh). */
const LEG_FETCHED_LINE = /fetched .*keys through its agent.*on use/

const MAIN = 'did:webvh:QmFarm:farm.example:main' // linked first; holds the identity
const SECOND = 'did:webvh:QmFarm:farm.example:second' // added after, and current
const ctx = {} as never

const persona: VtiPersona = {
  vtaDid: MAIN,
  did: 'did:webvh:QmP:dids.example:tiger-silver',
  communityDid: 'did:webvh:QmC:community-c',
  vtaKeyIds: {
    signing: 'did:webvh:QmP:dids.example:tiger-silver#key-0',
    keyAgreement: 'did:webvh:QmP:dids.example:tiger-silver#key-1',
  },
  kmsKeyIds: {
    signing: `vta-copy:${MAIN}:did:webvh:QmP:dids.example:tiger-silver#key-0`,
    keyAgreement: `vta-copy:${MAIN}:did:webvh:QmP:dids.example:tiger-silver#key-1`,
  },
} as unknown as VtiPersona
const signingKey = persona.kmsKeyIds?.signing as string

const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }
const logged = () =>
  [logger.info, logger.warn, logger.debug, logger.error].flatMap((f) => f.mock.calls.map((c) => String(c[0])))

/** The phone as it starts again: the stores on disk survive; memory, and so the backend, is empty. */
function relaunchedPhone() {
  const kms = new EphemeralKeyManagementService()
  const agent = {
    config: { logger },
    dids: { resolveDidDocument: jest.fn(async () => Promise.reject(new Error('no resolver in this test'))) },
    dependencyManager: { resolve: () => ({ backends: [{ backend: 'askar' }, kms] }) },
  } as never
  const links = {
    get: async () => ({ vtaDid: SECOND, label: 'second', linkedAt: '2026-10-13T10:05:00Z', owner: true }),
    set: async () => undefined,
    clear: async () => undefined,
    list: async () => [
      { vtaDid: MAIN, label: 'main', linkedAt: '2026-10-13T10:00:00Z' },
      { vtaDid: SECOND, label: 'second', linkedAt: '2026-10-13T10:05:00Z' },
    ],
  }
  const identities = {
    getManager: jest.fn(async () => undefined),
    setManager: jest.fn(async () => undefined),
    forgetManager: jest.fn(async () => undefined),
    listPersonas: jest.fn(async () => [persona]),
  }
  // The identity's own agent: its short session hands the copy over, as the VTA does.
  const main = {
    holdPersonaKeys: jest.fn(async (p: VtiPersona) => {
      for (const kid of Object.values(p.kmsKeyIds ?? {})) await kms.importKey(ctx, { privateJwk: { kid } } as never)
      return true
    }),
    disconnect: jest.fn(async () => undefined),
  }
  const keyClient = jest.fn(() => main)
  const vta = new VtaAgentController()
  vta.configure({ linkStore: () => links as never, identityStore: () => identities as never, keyClient } as never)
  return { kms, agent, vta, main, keyClient }
}

beforeEach(() => {
  // No timer fires: the current agent's retries and looks stay parked, so the
  // only work is the use and the fetch it starts.
  jest.useFakeTimers()
  jest.clearAllMocks()
  mockCurrentSessionCalls.length = 0
})
afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
})

describe('relaunch-keys-fetched-on-use: a plain relaunch, then an identity of the non-current agent is used', () => {
  it('before the app hands its agent over, the use fails as on TestFlight 239 (the case this guards)', async () => {
    const { kms } = relaunchedPhone()
    await expect(kms.sign(ctx, { keyId: signingKey } as never)).rejects.toThrow(
      `Key with key id '${signingKey}' not found in backend 'ephemeral'`
    )
  })

  it("signs: the copy is fetched through that identity's own agent, never the current agent's session", async () => {
    const { kms, agent, vta, main, keyClient } = relaunchedPhone()
    await vta.restore(agent)
    expect(await kms.isHeld(signingKey)).toBe(false)

    const signed = await kms.sign(ctx, { keyId: signingKey } as never)

    expect(signed).toEqual({ signature: new Uint8Array([1]) })
    expect(await kms.isHeld(signingKey)).toBe(true)
    expect(keyClient).toHaveBeenCalledTimes(1)
    expect((keyClient.mock.calls[0] as unknown[])[1]).toBe(MAIN)
    expect(main.holdPersonaKeys).toHaveBeenCalledWith(persona)
    expect(main.disconnect).toHaveBeenCalledTimes(1)
    expect(mockCurrentSessionCalls).not.toContain('holdPersonaKeys')
  })

  it('logs the line the gate leg reads, and nothing "not found in backend"', async () => {
    const { kms, agent, vta } = relaunchedPhone()
    await vta.restore(agent)

    await kms.sign(ctx, { keyId: signingKey } as never)

    const lines = logged()
    const fetched = lines.filter((line) => LEG_FETCHED_LINE.test(line))
    expect(fetched).toHaveLength(1)
    expect(fetched[0]).toContain(persona.did)
    expect(lines.filter((line) => line.includes('not found in backend'))).toEqual([])
  })

  it('a second use goes straight on: one fetch per relaunch', async () => {
    const { kms, agent, vta, keyClient } = relaunchedPhone()
    await vta.restore(agent)

    await kms.sign(ctx, { keyId: signingKey } as never)
    await kms.sign(ctx, { keyId: signingKey } as never)

    expect(keyClient).toHaveBeenCalledTimes(1)
  })
})
