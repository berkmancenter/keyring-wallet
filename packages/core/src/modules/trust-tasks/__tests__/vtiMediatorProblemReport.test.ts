import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'

import { VtiMediatorSession, type VtiClientIdentity, type VtiMediatorEndpoints } from '../module/VtiMediatorTransport'

// IN-617: three problem-reports reached a tester's report as a bare type, each
// just after the socket closed. They came from the mediator, which the
// transport drops on arrival: said nowhere, so nothing told what they were about.

const identity: VtiClientIdentity = {
  did: 'did:webvh:QmApplicantScid1234567890:host.example:applicant',
  kid: 'did:webvh:QmApplicantScid1234567890:host.example:applicant#key-2',
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

const PROBLEM_REPORT = 'https://didcomm.org/report-problem/2.0/problem-report'

/** A session whose decrypt step returns `plaintext`, with what it hands on and acknowledges recorded. */
function sessionOpening(plaintext: Record<string, unknown>) {
  const onMessage = jest.fn()
  const session = new VtiMediatorSession(agent, identity, mediator, { onMessage })
  // The decrypt step and the acknowledgement stand in; the frame handling is the shipping one.
  session['unpack'] = async () => plaintext as DidCommV2PlaintextMessage
  const acknowledge = jest.fn(async (_ids: string[]) => undefined)
  session['acknowledge'] = acknowledge
  const receive = () => session['handleFrame'](JSON.stringify({ protected: 'e30', ciphertext: 'x' }))
  return { receive, acknowledge, onMessage }
}

describe("the mediator's own problem-report", () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => warn.mockRestore())
  const warned = () => warn.mock.calls.map((call) => String(call[0]))

  it('is said with its code, words and thread, naming the identity by prefix only', async () => {
    const { receive, acknowledge, onMessage } = sessionOpening({
      type: PROBLEM_REPORT,
      from: mediator.did,
      thid: 'b3c1f0de-0000-4000-8000-000000000001',
      body: { code: 'e.p.msg.forwarding', comment: `no session for ${identity.did}`, args: [identity.did] },
    })
    await receive()
    expect(warned()).toEqual([
      '[TrustTasks:VtiMediatorTransport] mediator.example sent a problem-report for did:webvh:QmApplicantSci…: ' +
        'e.p.msg.forwarding — no session for did:webvh:QmApplicantSci… (thread b3c1f0de-0000-4000-8000-000000000001)',
    ])
    expect(warned().join('\n')).not.toContain(identity.did)
    // As before: the mediator's own message is neither handed on nor acknowledged.
    expect(onMessage).not.toHaveBeenCalled()
    expect(acknowledge).not.toHaveBeenCalled()
  })

  it('says only a problem-report: any other message of the mediator stays unsaid', async () => {
    const { receive, onMessage } = sessionOpening({
      type: 'https://didcomm.org/trust-ping/2.0/ping',
      from: mediator.did,
      body: {},
    })
    await receive()
    expect(warned()).toEqual([])
    expect(onMessage).not.toHaveBeenCalled()
  })

  it("leaves a peer's problem-report to the agent, which says it", async () => {
    const { receive, onMessage } = sessionOpening({
      type: PROBLEM_REPORT,
      from: 'did:webvh:QmCommunityScid:host.example:community',
      thid: 'urn:uuid:a-request',
      body: { code: 'e.p.msg.bad-request' },
    })
    await receive()
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(warned()).toEqual([])
  })
})
