/**
 * Making this phone wakeable by its agent (push notifications plan §4.4, step
 * 1.5): off unless a gateway is configured, then token → push/register →
 * device/set-wake.
 */
import { PushGatewayRefusal, isHandleLimitRefusal, type PushRegistration } from '@/push/pushGateway'
import {
  enablePushWake,
  tokenKeyOf,
  UNCONFIRMED_HANDLE_REUSE_MS,
  type KeptWakeHandle,
  type PushWakeDeps,
} from '@/push/pushWake'

const AGENT = 'did:webvh:QmAgent:agent.example.org'
const GATEWAY_DID = 'did:webvh:QmGateway:push.example.org:gateway'
const FCM: PushRegistration = { platform: 'fcm', token: 'fcm-token' }

function deps(overrides: Partial<PushWakeDeps> = {}) {
  const register = jest.fn(async () => ({ gateway: GATEWAY_DID, handle: 'zHandle' }))
  const setWake = jest.fn(async () => ({ pushCapable: true, allowedTriggers: [AGENT] }))
  const pushRegistration = jest.fn(async () => FCM)
  const d: PushWakeDeps = {
    gatewayUrl: 'https://push.example.org',
    agentDid: () => AGENT,
    pushRegistration,
    setWake,
    register,
    ...overrides,
  }
  return { d, register, setWake, pushRegistration }
}

describe('making this phone wakeable', () => {
  it('registers the token and gives the agent the handle, never the token', async () => {
    const { d, register, setWake } = deps()
    await expect(enablePushWake(d)).resolves.toEqual({
      status: 'wakeable',
      handle: { gateway: GATEWAY_DID, handle: 'zHandle' },
      allowedTriggers: [AGENT],
    })
    expect(register).toHaveBeenCalledWith('https://push.example.org', FCM, AGENT)
    expect(setWake).toHaveBeenCalledWith({ gateway: GATEWAY_DID, handle: 'zHandle' }, { pushPlatform: 'fcm' })
    expect(JSON.stringify(setWake.mock.calls)).not.toContain('fcm-token')
  })

  it('does nothing when the build names no gateway', async () => {
    for (const gatewayUrl of [undefined, '', '   ']) {
      const { d, pushRegistration, register } = deps({ gatewayUrl })
      await expect(enablePushWake(d)).resolves.toEqual({ status: 'off' })
      expect(pushRegistration).not.toHaveBeenCalled()
      expect(register).not.toHaveBeenCalled()
    }
  })

  it('does nothing when the phone is not linked to an agent', async () => {
    const { d, register } = deps({ agentDid: () => undefined })
    await expect(enablePushWake(d)).resolves.toEqual({ status: 'notLinked' })
    expect(register).not.toHaveBeenCalled()
  })

  it('stops when there is no push token (permission denied, no services)', async () => {
    const { d, register } = deps({ pushRegistration: async () => undefined })
    await expect(enablePushWake(d)).resolves.toEqual({ status: 'noToken' })
    expect(register).not.toHaveBeenCalled()
  })

  it('refuses a gateway with no DID, since the agent could never wake through it', async () => {
    const { d, setWake } = deps({
      register: async () => ({ gateway: 'https://push.example.org', handle: 'h' }),
    })
    await expect(enablePushWake(d)).rejects.toThrow('no DID identity')
    expect(setWake).not.toHaveBeenCalled()
  })

  it('reports an agent that did not become able to wake the phone', async () => {
    const { d } = deps({ setWake: async () => ({ pushCapable: false }) })
    await expect(enablePushWake(d)).resolves.toEqual({
      status: 'notWakeable',
      handle: { gateway: GATEWAY_DID, handle: 'zHandle' },
    })
  })

  it('lets a gateway or agent refusal through for the caller to log', async () => {
    const { d } = deps({
      register: async () => {
        throw new Error('permissionDenied')
      },
    })
    await expect(enablePushWake(d)).rejects.toThrow('permissionDenied')
  })
})

// vti-push-gateway mints a new handle at every push/register and keeps four
// per token (e542a9d7 store.rs:89-129): one per agent and token, then given again.
describe('one handle per agent and token', () => {
  const A = 'did:webvh:QmA:agents.example.org:a'
  const B = 'did:webvh:QmB:agents.example.org:b'
  function memoryHandles() {
    const kept = new Map<string, KeptWakeHandle>()
    return {
      kept,
      handles: {
        get: async (agentDid: string) => kept.get(agentDid),
        set: async (agentDid: string, k: KeptWakeHandle) => void kept.set(agentDid, k),
      },
    }
  }

  it('switching A, B, A, B registers twice, and gives each agent its own handle every time', async () => {
    let current = A
    let minted = 0
    const register = jest.fn(async () => ({ gateway: GATEWAY_DID, handle: `h${++minted}` }))
    const { d, setWake } = deps({ agentDid: () => current, register })
    const { handles } = memoryHandles()
    const run = () => enablePushWake({ ...d, handles })
    for (const agent of [A, B, A, B]) {
      current = agent
      await run()
    }
    expect(register).toHaveBeenCalledTimes(2)
    expect(setWake.mock.calls.map((c) => (c as unknown as [{ handle: string }])[0].handle)).toEqual([
      'h1',
      'h2',
      'h1',
      'h2',
    ])
  })

  it('notifications off and on with the same token: no new register', async () => {
    const { d, register, setWake } = deps()
    const { handles } = memoryHandles()
    await enablePushWake({ ...d, handles })
    await enablePushWake({ ...d, handles })
    expect(register).toHaveBeenCalledTimes(1)
    expect(setWake).toHaveBeenCalledTimes(2)
  })

  it('a new token registers again, once', async () => {
    let token = 'fcm-token'
    const { d, register } = deps({ pushRegistration: async () => ({ platform: 'fcm', token }) })
    const { handles, kept } = memoryHandles()
    await enablePushWake({ ...d, handles })
    token = 'fcm-token-2'
    await enablePushWake({ ...d, handles })
    await enablePushWake({ ...d, handles })
    expect(register).toHaveBeenCalledTimes(2)
    expect(kept.get(AGENT)?.tokenKey).toBe(tokenKeyOf({ platform: 'fcm', token: 'fcm-token-2' }))
  })

  it('keeps no token, only a fingerprint of it', async () => {
    const { d } = deps()
    const { handles, kept } = memoryHandles()
    await enablePushWake({ ...d, handles })
    expect(JSON.stringify([...kept.values()])).not.toContain('fcm-token')
  })

  it("knows the gateway's limit by its own words, not every taskFailed", () => {
    expect(
      isHandleLimitRefusal(new PushGatewayRefusal('taskFailed', 'task failed: too many handles for this push token'))
    ).toBe(true)
    expect(
      isHandleLimitRefusal(new PushGatewayRefusal('taskFailed', 'task failed: no sender configured for this platform'))
    ).toBe(false)
    expect(isHandleLimitRefusal(new Error('too many handles for this push token'))).toBe(false)
  })
})

// A handle stored before set-wake can outlive its provisioning: the gateway
// sweeps a handle still unprovisioned an hour after it was minted (e542a9d7
// store.rs:26-30, 528-541). Only a handle the agent confirmed is kept for good.
describe('a handle the agent has not confirmed', () => {
  const MIN = 60 * 1000
  function setup(setWakeImpl: () => Promise<{ pushCapable: boolean }>) {
    let clock = 1_000_000
    let minted = 0
    const register = jest.fn(async () => ({ gateway: GATEWAY_DID, handle: `h${++minted}` }))
    const setWake = jest.fn(setWakeImpl)
    const kept = new Map<string, KeptWakeHandle>()
    const handles = {
      get: async (agentDid: string) => kept.get(agentDid),
      set: async (agentDid: string, k: KeptWakeHandle) => void kept.set(agentDid, k),
    }
    const { d } = deps({ register, setWake, handles, now: () => clock })
    return { d, register, setWake, kept, advance: (ms: number) => (clock += ms) }
  }

  it('after a failed set-wake, a retry within the window gives the same handle: one register', async () => {
    const s = setup(async () => ({ pushCapable: true }))
    s.setWake.mockRejectedValueOnce(new Error('agent unreachable'))
    await expect(enablePushWake(s.d)).rejects.toThrow('agent unreachable')
    expect(s.kept.get(AGENT)?.provisionedAt).toBeUndefined()

    s.advance(20 * MIN)
    await expect(enablePushWake(s.d)).resolves.toMatchObject({ status: 'wakeable', handle: { handle: 'h1' } })
    expect(s.register).toHaveBeenCalledTimes(1)
    expect(s.kept.get(AGENT)?.provisionedAt).toBeDefined()
  })

  it('after a failed set-wake, a retry past the window registers a fresh handle (the old one is swept)', async () => {
    const s = setup(async () => ({ pushCapable: true }))
    s.setWake.mockRejectedValueOnce(new Error('agent unreachable'))
    await expect(enablePushWake(s.d)).rejects.toThrow()

    s.advance(UNCONFIRMED_HANDLE_REUSE_MS + MIN)
    await expect(enablePushWake(s.d)).resolves.toMatchObject({ handle: { handle: 'h2' } })
    expect(s.register).toHaveBeenCalledTimes(2)
  })

  it('a handle the agent confirmed is given again however old it is', async () => {
    const s = setup(async () => ({ pushCapable: true }))
    await enablePushWake(s.d)
    s.advance(30 * 24 * 60 * MIN)
    await enablePushWake(s.d)
    expect(s.register).toHaveBeenCalledTimes(1)
  })

  it('answered not wakeable: not confirmed, so it is replaced only after the window, not at every try', async () => {
    const s = setup(async () => ({ pushCapable: false }))
    await enablePushWake(s.d)
    await enablePushWake(s.d)
    expect(s.register).toHaveBeenCalledTimes(1)
    s.advance(UNCONFIRMED_HANDLE_REUSE_MS + MIN)
    await enablePushWake(s.d)
    expect(s.register).toHaveBeenCalledTimes(2)
  })

  it('a handle kept before this was recorded is given again, not re-registered', async () => {
    const s = setup(async () => ({ pushCapable: true }))
    s.kept.set(AGENT, { tokenKey: tokenKeyOf(FCM), handle: { gateway: GATEWAY_DID, handle: 'legacy' } })
    await expect(enablePushWake(s.d)).resolves.toMatchObject({ handle: { handle: 'legacy' } })
    expect(s.register).not.toHaveBeenCalled()
  })
})
