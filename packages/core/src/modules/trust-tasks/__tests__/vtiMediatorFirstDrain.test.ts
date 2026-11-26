import { VtiMediatorSession, type VtiClientIdentity, type VtiMediatorEndpoints } from '../module/VtiMediatorTransport'

// When has the mediator handed over what it had queued? A session's start sends one delivery-request; the mediator
// answers with a `delivery` (what it held) or a `status` threaded to that request (it held nothing). `firstDrained`
// resolves on either, and on nothing else, so a connect can stop waiting there (connectDrainSwitch).

const identity: VtiClientIdentity = { did: 'did:peer:2:phone', kid: 'did:peer:2:phone#key-2', senderKey: {} as never }
const mediator: VtiMediatorEndpoints = {
  did: 'did:peer:2:mediator',
  authEndpoint: 'https://mediator.example/mediator/v1',
  wsEndpoint: 'wss://mediator.example/mediator/v1/ws',
  publicJwk: {} as never,
  kid: 'did:peer:2:mediator#key-1',
}
const agent = {
  config: { logger: { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined } },
} as never

const STATUS = 'https://didcomm.org/messagepickup/3.0/status'
const DELIVERY = 'https://didcomm.org/messagepickup/3.0/delivery'

/** A session past its start's delivery-request, with the frames it then receives chosen by the test. */
function started() {
  const session = new VtiMediatorSession(agent, identity, mediator, { onMessage: jest.fn() })
  const internals = session as unknown as {
    armFirstDrain: () => string
    unpack: () => Promise<unknown>
    handleDelivery: (d: unknown) => Promise<void>
    requestDelivery: () => Promise<void>
    handleFrame: (raw: string) => Promise<void>
  }
  internals.requestDelivery = jest.fn(async () => undefined)
  const id = internals.armFirstDrain()
  let state: 'waiting' | 'answered' = 'waiting'
  void session.firstDrained().then(() => (state = 'answered'))
  const settle = () => new Promise((resolve) => setImmediate(resolve))
  return {
    id,
    session,
    internals,
    state: async () => {
      await settle()
      return state
    },
    /** A frame the mediator sends in the clear. */
    plain: (frame: Record<string, unknown>) => internals.handleFrame(JSON.stringify(frame)),
    /** A frame the mediator authcrypts, opening to `plaintext`. */
    sealed: (plaintext: Record<string, unknown>) => {
      internals.unpack = async () => plaintext
      return internals.handleFrame(JSON.stringify({ protected: 'e30', ciphertext: 'x' }))
    },
  }
}

describe('before any start', () => {
  it('there is nothing to wait for', async () => {
    const session = new VtiMediatorSession(agent, identity, mediator, {})
    await expect(session.firstDrained()).resolves.toBeUndefined()
  })
})

describe('the answer to the start’s delivery-request', () => {
  it('a status threaded to it, in the clear: nothing was queued', async () => {
    const s = started()
    await s.plain({ type: STATUS, thid: s.id, body: { message_count: 0 } })
    expect(await s.state()).toBe('answered')
  })

  it('a status threaded to it, authcrypted', async () => {
    const s = started()
    await s.sealed({ type: STATUS, thid: s.id, from: mediator.did, body: { message_count: 0 } })
    expect(await s.state()).toBe('answered')
  })

  it('a delivery, only once what it carried has been handed on', async () => {
    const s = started()
    let handedOn: () => void = () => undefined
    s.internals.handleDelivery = jest.fn(() => new Promise<void>((resolve) => (handedOn = resolve)))
    const receiving = s.sealed({ type: DELIVERY, from: mediator.did, attachments: [{ id: 'a' }] })
    expect(await s.state()).toBe('waiting')
    handedOn()
    await receiving
    expect(await s.state()).toBe('answered')
  })

  it('a delivery whose handling throws still counts: the wait does not hang on it', async () => {
    const s = started()
    s.internals.handleDelivery = jest.fn(async () => {
      throw new Error('one attachment would not open')
    })
    await s.sealed({ type: DELIVERY, from: mediator.did, attachments: [{ id: 'a' }] }).catch(() => undefined)
    expect(await s.state()).toBe('answered')
  })
})

describe('CONTROL: what is not that answer', () => {
  it.each([
    ['a status threaded to another request (the live-delivery change)', { type: STATUS, thid: 'urn:uuid:other' }],
    ['a status with no thread (the mediator’s own resync signal)', { type: STATUS, body: { message_count: 0 } }],
    ['a peer’s message', { type: 'https://trusttasks.org/binding/didcomm/0.1/envelope', from: 'did:webvh:agent' }],
  ])('%s', async (_name, frame) => {
    const s = started()
    await s.sealed({ from: mediator.did, ...frame }).catch(() => undefined)
    await s.plain(frame).catch(() => undefined)
    expect(await s.state()).toBe('waiting')
  })

  it('a new start waits for its own request, not the last one’s answer', async () => {
    const s = started()
    const second = s.internals.armFirstDrain()
    let state = 'waiting'
    void s.session.firstDrained().then(() => (state = 'answered'))
    await s.plain({ type: STATUS, thid: s.id, body: { message_count: 0 } })
    await new Promise((resolve) => setImmediate(resolve))
    expect(state).toBe('waiting')
    await s.plain({ type: STATUS, thid: second, body: { message_count: 0 } })
    await new Promise((resolve) => setImmediate(resolve))
    expect(state).toBe('answered')
  })
})
