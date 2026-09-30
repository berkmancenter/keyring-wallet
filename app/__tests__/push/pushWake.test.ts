/**
 * Making this phone wakeable by its agent (push notifications plan §4.4, step
 * 1.5): off unless a gateway is configured, then token → push/register →
 * device/set-wake.
 */
import { type PushRegistration } from '@/push/pushGateway'
import { enablePushWake, type PushWakeDeps } from '@/push/pushWake'

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
