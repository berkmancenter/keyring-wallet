import { VtiMediatorSession, type VtiClientIdentity, type VtiMediatorEndpoints } from '../module/VtiMediatorTransport'

// A message the mediator holds for someone else lives until the forward's
// `expires_time`. A community's VTC is listen-only: when it misses a live push
// it collects its inbox again only when it reconnects, about every 12 minutes.
// A forward that expired in 5 minutes was therefore lost for good whenever that
// one push was missed — measured on the lab on 2026-09-27, where a vetting
// Apply was stored, never collected, and dropped by the mediator's expiry
// sweep 300 s later.

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

type Sent = { type: string; created_time: number; expires_time: number }

/** A session whose socket is replaced by a list of what it would have sent. */
function capturing() {
  const session = new VtiMediatorSession(agent, identity, mediator, { onMessage: jest.fn() })
  const sent: Sent[] = []
  ;(session as unknown as { send: (m: Sent) => Promise<void> }).send = async (m) => void sent.push(m)
  return { session, sent }
}

const lifetime = (m: Sent) => m.expires_time - m.created_time
const VTC_CATCH_UP_SECS = 12 * 60

describe('how long the mediator holds what we send', () => {
  it('a forward for a peer outlives the VTC catching up after a missed push', async () => {
    const { session, sent } = capturing()
    await session.forward('did:webvh:example:vtc', { protected: 'e30', ciphertext: 'x' })
    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe('https://didcomm.org/routing/2.0/forward')
    expect(lifetime(sent[0])).toBeGreaterThan(VTC_CATCH_UP_SECS)
  })

  it('a message the mediator answers at once keeps a short life', async () => {
    const { session, sent } = capturing()
    await (session as unknown as { acknowledge: (ids: string[]) => Promise<void> }).acknowledge(['queued-1'])
    expect(sent).toHaveLength(1)
    expect(lifetime(sent[0])).toBeLessThanOrEqual(300)
  })
})
