import { VtiMediatorSession, type VtiClientIdentity, type VtiMediatorEndpoints } from '../module/VtiMediatorTransport'

// message-protection-plan M1. After it drops a live push, the mediator sends a
// Pickup 3.0 `status` carrying the inbox's live `message_count` (tdk-rs #830).
// It answers nothing we sent, so it has no `thid`. This transport used to drop
// every pickup frame on arrival, which left a missed message waiting for the
// backstop poll — and made that poll the only thing standing between a dropped
// push and a message that never arrives.

const identity: VtiClientIdentity = {
  did: 'did:peer:2:applicant',
  kid: 'did:peer:2:applicant#key-2',
  senderKey: {} as never,
}
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

/** A session whose decrypt step returns `plaintext`, with delivery-requests counted. */
function sessionOpening(plaintext: Record<string, unknown>) {
  const onMessage = jest.fn()
  const session = new VtiMediatorSession(agent, identity, mediator, { onMessage })
  const internals = session as unknown as {
    unpack: () => Promise<unknown>
    requestDelivery: () => Promise<void>
    acknowledge: (ids: string[]) => Promise<void>
    handleFrame: (raw: string) => Promise<void>
    lastDeliveryRequestAt: number
  }
  internals.unpack = async () => plaintext
  const requestDelivery = jest.fn(async () => {
    internals.lastDeliveryRequestAt = Date.now()
  })
  internals.requestDelivery = requestDelivery
  const acknowledge = jest.fn(async () => undefined)
  internals.acknowledge = acknowledge
  const receive = () => internals.handleFrame(JSON.stringify({ protected: 'e30', ciphertext: 'x' }))
  return { receive, requestDelivery, acknowledge, onMessage, internals }
}

const resync = (count: number) => ({
  type: STATUS,
  from: mediator.did,
  body: { recipient_did: identity.did, message_count: count, live_delivery: true },
})

describe('the mediator resync signal', () => {
  it('an unsolicited status with messages waiting asks for delivery', async () => {
    const { receive, requestDelivery, acknowledge, onMessage } = sessionOpening(resync(3))
    await receive()
    expect(requestDelivery).toHaveBeenCalledTimes(1)
    // Bookkeeping: never handed to the agent, never acknowledged.
    expect(onMessage).not.toHaveBeenCalled()
    expect(acknowledge).not.toHaveBeenCalled()
  })

  it('a status answering our own request keeps its meaning', async () => {
    const { receive, requestDelivery } = sessionOpening({ ...resync(0), thid: 'our-delivery-request' })
    await receive()
    expect(requestDelivery).not.toHaveBeenCalled()
  })

  it('a solicited status is not read as a resync even when it counts messages', async () => {
    // The answer to live-delivery-change reports the backlog; the drain that
    // follows it is already on its way, so this must not start a second one.
    const { receive, requestDelivery } = sessionOpening({ ...resync(4), thid: 'our-live-delivery-change' })
    await receive()
    expect(requestDelivery).not.toHaveBeenCalled()
  })

  it('an empty inbox asks for nothing', async () => {
    const { receive, requestDelivery } = sessionOpening(resync(0))
    await receive()
    expect(requestDelivery).not.toHaveBeenCalled()
  })

  it('does not drain twice in the same second', async () => {
    const { receive, requestDelivery } = sessionOpening(resync(2))
    await receive()
    await receive()
    expect(requestDelivery).toHaveBeenCalledTimes(1)
  })
})
