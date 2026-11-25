/**
 * enablePushWake's two mailbox additions (pushWake.ts): the wallet mailbox's mediator suggested to the agent as a
 * trigger, so the gateway admits that mediator's push/wake for mail waiting at the mailbox; and the handle left at
 * that mediator (`messaging/wake/set`), reported in the outcome and never in the way of the agent's own wake.
 */
import { enablePushWake, type PushWakeDeps } from './pushWake'

const GATEWAY = 'did:web:gateway.example'
const MAILBOX_MEDIATOR = 'did:webvh:QmMailbox:mailbox.example:mediator'
const handle = { gateway: GATEWAY, handle: 'wh_1' }

function deps(extra: Partial<PushWakeDeps> = {}) {
  const setWake = jest.fn(async () => ({ pushCapable: true, allowedTriggers: [GATEWAY] }))
  const register = jest.fn(async () => handle)
  const d: PushWakeDeps = {
    gatewayUrl: 'https://gateway.example',
    agentDid: () => 'did:webvh:QmAgent:host.example:agent',
    pushRegistration: async () => ({ platform: 'apns', token: 'a-token' } as never),
    setWake,
    register: register as never,
    ...extra,
  }
  return { d, setWake }
}

describe('the wallet mailbox and the push wake', () => {
  test('with a mailbox mediator configured, it is suggested to the agent as a trigger beside the gateway', async () => {
    const { d, setWake } = deps({ mailboxMediatorDid: MAILBOX_MEDIATOR })
    const outcome = await enablePushWake(d)
    expect(outcome.status).toBe('wakeable')
    expect(setWake).toHaveBeenCalledWith(handle, {
      pushPlatform: 'apns',
      suggestedTriggers: [GATEWAY, MAILBOX_MEDIATOR],
    })
  })

  test('CONTROL: with none configured, only the gateway is suggested, as before', async () => {
    const { d, setWake } = deps()
    await enablePushWake(d)
    expect(setWake).toHaveBeenCalledWith(handle, { pushPlatform: 'apns', suggestedTriggers: [GATEWAY] })
  })

  test('the handle is left at the mailbox’s mediator once the agent has made the phone wakeable; its answer is the outcome’s', async () => {
    const setMailboxWake = jest.fn(async () => true)
    const { d } = deps({ mailboxMediatorDid: MAILBOX_MEDIATOR, setMailboxWake })
    const outcome = await enablePushWake(d)
    expect(setMailboxWake).toHaveBeenCalledWith(handle)
    expect(outcome).toMatchObject({ status: 'wakeable', mailbox: 'set' })
  })

  test('the mailbox’s mediator refusing, or not holding it: reported as failed, and the agent’s wake stands', async () => {
    const refused = await enablePushWake(
      deps({ setMailboxWake: jest.fn(async () => Promise.reject(new Error('no mailbox'))) }).d
    )
    expect(refused).toMatchObject({ status: 'wakeable', mailbox: 'failed' })
    const notCapable = await enablePushWake(deps({ setMailboxWake: jest.fn(async () => false) }).d)
    expect(notCapable).toMatchObject({ status: 'wakeable', mailbox: 'failed' })
  })

  test('CONTROL: the agent refusing the wake stops everything: the mailbox is not asked', async () => {
    const setMailboxWake = jest.fn(async () => true)
    const { d } = deps({ setMailboxWake, setWake: jest.fn(async () => ({ pushCapable: false })) })
    const outcome = await enablePushWake(d)
    expect(outcome.status).toBe('notWakeable')
    expect(setMailboxWake).not.toHaveBeenCalled()
  })
})
