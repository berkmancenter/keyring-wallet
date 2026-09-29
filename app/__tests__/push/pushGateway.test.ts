/**
 * Registering this phone's push token with a push wake-up gateway
 * (push notifications plan §4.4): the request it sends, and how it reads the
 * gateway's answers. The shapes are vti-push-gateway e542a9d7's (src/api.rs,
 * handle_register; src/types.rs, PushRegistration).
 */
import { PUSH_REGISTER_TASK, PushGatewayRefusal, registerWithGateway } from '@/push/pushGateway'

const AGENT = 'did:webvh:QmAgent:agent.example.org'
const GATEWAY_DID = 'did:webvh:QmGateway:push.example.org:gateway'

function gatewayAnswering(status: number, body: unknown) {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = []
  const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, init })
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }
  }
  return { fetchImpl, calls }
}

describe('registering with the push gateway', () => {
  it('posts push/register 0.2 naming the token and the agent, and returns the wake handle', async () => {
    const { fetchImpl, calls } = gatewayAnswering(200, {
      type: `${PUSH_REGISTER_TASK}#response`,
      payload: { wakeHandle: { gateway: GATEWAY_DID, handle: 'zHandle' } },
    })
    const handle = await registerWithGateway(
      'https://push.example.org/',
      { platform: 'fcm', token: 'fcm-token' },
      AGENT,
      fetchImpl
    )
    expect(handle).toEqual({ gateway: GATEWAY_DID, handle: 'zHandle' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://push.example.org/trust-tasks')
    expect(calls[0].init.method).toBe('POST')
    const doc = JSON.parse(calls[0].init.body)
    expect(doc.type).toBe('https://trusttasks.org/spec/push/register/0.2')
    expect(doc.id).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(doc.payload).toEqual({ registration: { platform: 'fcm', token: 'fcm-token' }, controllerVtaDid: AGENT })
    // Registration is anonymous: the phone signs nothing at the gateway.
    expect(doc.proof).toBeUndefined()
  })

  it('carries an APNs token with its topic and environment', async () => {
    const { fetchImpl, calls } = gatewayAnswering(200, {
      payload: { wakeHandle: { gateway: GATEWAY_DID, handle: 'h' } },
    })
    await registerWithGateway(
      'https://push.example.org',
      { platform: 'apns', token: 'ab'.repeat(32), topic: 'asml.bkc.harvard.wallet.pushtest', environment: 'sandbox' },
      AGENT,
      fetchImpl
    )
    expect(JSON.parse(calls[0].init.body).payload.registration).toEqual({
      platform: 'apns',
      token: 'ab'.repeat(32),
      topic: 'asml.bkc.harvard.wallet.pushtest',
      environment: 'sandbox',
    })
  })

  it('throws a refusal with the gateway code when the agent is not served', async () => {
    const { fetchImpl } = gatewayAnswering(200, {
      type: 'https://trusttasks.org/spec/trust-task-error/0.1',
      payload: { code: 'permissionDenied', message: 'permission denied: controller VTA is not served by this gateway' },
    })
    const attempt = registerWithGateway('https://push.example.org', { platform: 'fcm', token: 't' }, AGENT, fetchImpl)
    await expect(attempt).rejects.toBeInstanceOf(PushGatewayRefusal)
    await expect(attempt).rejects.toMatchObject({ code: 'permissionDenied' })
  })

  it('throws a refusal when the gateway has no sender for the platform', async () => {
    const { fetchImpl } = gatewayAnswering(200, {
      type: 'https://trusttasks.org/spec/trust-task-error/0.1',
      payload: { code: 'taskFailed', message: 'no sender configured for this platform' },
    })
    await expect(
      registerWithGateway('https://push.example.org', { platform: 'fcm', token: 't' }, AGENT, fetchImpl)
    ).rejects.toMatchObject({ code: 'taskFailed' })
  })

  it('fails plainly on an answer with no wake handle or no document', async () => {
    const noHandle = gatewayAnswering(200, { payload: {} })
    await expect(
      registerWithGateway('https://push.example.org', { platform: 'fcm', token: 't' }, AGENT, noHandle.fetchImpl)
    ).rejects.toThrow('without a wake handle')

    const notJson = async () => ({ ok: false, status: 502, text: async () => '<html>Bad Gateway</html>' })
    await expect(
      registerWithGateway('https://push.example.org', { platform: 'fcm', token: 't' }, AGENT, notJson)
    ).rejects.toThrow('502 with no Trust Task document')
  })
})
