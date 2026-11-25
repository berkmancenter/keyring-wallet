/**
 * One TSP frame, handed to the wallet once — however many times the mediator
 * delivers it.
 *
 * Measured 2026-09-25: a vetter's desk answered one request twice, two
 * acceptances on one thread 90 ms apart. One way that happens is here: a frame
 * pushed live was handed to the consumer and acknowledged, but never recorded
 * as seen, so the same frame in a pickup `delivery` (a backstop poll, a
 * resync, before the ack landed) was handed over again. The DIDComm path has
 * always recorded its queue ids; the live TSP path did not
 * (`VtiMediatorSession.handleTspFrame`). The rule from #120 holds: a frame is
 * remembered only after its consumer settled, so a consumer that failed gets
 * the redelivery afresh.
 */
import { tsp } from '@bifold/trust-tasks'

import { VtiMediatorSession, type VtiClientIdentity, type VtiMediatorEndpoints } from '../module/VtiMediatorTransport'

const identity: VtiClientIdentity = {
  did: 'did:peer:2:vetter',
  kid: 'did:peer:2:vetter#key-2',
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
const DELIVERY = 'https://didcomm.org/messagepickup/3.0/delivery'

/** A TSP frame as the mediator delivers it: base64url(qb2) text. */
const FRAME = '-EABXAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

function session(onTspFrame: (bytes: Uint8Array) => Promise<void>) {
  const s = new VtiMediatorSession(agent, identity, mediator, { onTspFrame, onMessage: jest.fn() })
  const internals = s as unknown as {
    acknowledge: (ids: string[]) => Promise<void>
    handleFrame: (raw: string) => Promise<void>
    handleDelivery: (d: unknown) => Promise<void>
  }
  const acknowledge = jest.fn(async (_ids: string[]) => undefined)
  internals.acknowledge = acknowledge
  const live = () => internals.handleFrame(FRAME)
  // The mediator's attachment id for a queued message is its queue id.
  const pickup = () =>
    internals.handleDelivery({
      type: DELIVERY,
      attachments: [{ id: tsp.tspFrameQueueId(FRAME), data: { base64: FRAME } }],
    })
  return { live, pickup, acknowledge }
}

describe('a TSP frame delivered live and again by pickup', () => {
  it('is handed to the consumer once, and both copies are acknowledged', async () => {
    expect(tsp.isTspFrameText(FRAME)).toBe(true)
    const consumer = jest.fn(async () => undefined)
    const s = session(consumer)
    await s.live()
    await s.pickup()
    expect(consumer).toHaveBeenCalledTimes(1)
    expect(s.acknowledge).toHaveBeenCalledTimes(2)
    expect(s.acknowledge.mock.calls.every(([ids]) => ids[0] === tsp.tspFrameQueueId(FRAME))).toBe(true)
  })

  it('pushed live twice, is handed over once', async () => {
    const consumer = jest.fn(async () => undefined)
    const s = session(consumer)
    await s.live()
    await s.live()
    expect(consumer).toHaveBeenCalledTimes(1)
  })

  it('is not remembered when its consumer failed: the redelivery is taken afresh', async () => {
    let attempts = 0
    const consumer = jest.fn(async () => {
      attempts++
      if (attempts === 1) throw new Error('store unavailable')
    })
    const s = session(consumer)
    await s.live()
    expect(s.acknowledge).not.toHaveBeenCalled()
    await s.pickup()
    expect(consumer).toHaveBeenCalledTimes(2)
    expect(s.acknowledge).toHaveBeenCalledTimes(1)
  })
})
