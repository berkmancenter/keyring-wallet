import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'

import { VtiMediatorSession, type VtiClientIdentity, type VtiMediatorEndpoints } from '../module/VtiMediatorTransport'

// `VtiMediatorSession.ask`: a signed Trust Task to the mediator itself, answered by the frame threaded to it. The
// mailbox uses it for its account at the mediator (walletMailbox.ts): measured against affinidi-messaging-mediator
// v0.53.0 in the lab; here the frame handling is the shipping one, with the decrypt step standing in.

const identity: VtiClientIdentity = {
  did: 'did:peer:2.mailbox-of-this-phone',
  kid: 'did:peer:2.mailbox-of-this-phone#key-2',
  senderKey: {} as never,
}
const mediator: VtiMediatorEndpoints = {
  did: 'did:peer:2:mediator',
  authEndpoint: 'https://mailbox.example/mediator/v1',
  wsEndpoint: 'wss://mailbox.example/mediator/v1/ws',
  publicJwk: {} as never,
  kid: 'did:peer:2:mediator#key-1',
}
const agent = {
  config: { logger: { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined } },
} as never
const ENVELOPE = 'https://trusttasks.org/binding/didcomm/0.1/envelope'
const PROBLEM_REPORT = 'https://didcomm.org/report-problem/2.0/problem-report'
const document = { id: 'urn:uuid:d-1', type: 'https://trusttasks.org/spec/messaging/account/update/0.1', payload: {} }

function sessionAsking() {
  const onMessage = jest.fn()
  const session = new VtiMediatorSession(agent, identity, mediator, { onMessage })
  const sent: DidCommV2PlaintextMessage[] = []
  session['send'] = jest.fn(async (plaintext: DidCommV2PlaintextMessage) => {
    sent.push(plaintext)
  })
  session['acknowledge'] = jest.fn(async (_ids: string[]) => undefined)
  /** A frame from the socket whose decrypt step yields `plaintext`. */
  const frame = (plaintext: Record<string, unknown>) => {
    session['unpack'] = async () => plaintext as DidCommV2PlaintextMessage
    return session['handleFrame'](JSON.stringify({ protected: 'e30', ciphertext: 'x' }))
  }
  return { session, sent, frame, onMessage }
}

describe('asking the mediator', () => {
  test('the document goes in the binding envelope, from this identity to the mediator, and the frame threaded to it is the answer', async () => {
    const { session, sent, frame, onMessage } = sessionAsking()
    const asked = session.ask(document)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ type: ENVELOPE, from: identity.did, to: [mediator.did], body: document })
    await frame({
      type: ENVELOPE,
      from: mediator.did,
      thid: sent[0].id,
      body: { type: `${document.type}#response`, payload: { acl: { sendForwarded: true } } },
    })
    await expect(asked).resolves.toMatchObject({ body: { payload: { acl: { sendForwarded: true } } } })
    // The answer is the asker's: not handed on, not acknowledged.
    expect(onMessage).not.toHaveBeenCalled()
    expect(session['acknowledge']).not.toHaveBeenCalled()
    await session.stop()
  })

  test('the mediator’s problem-report threaded to the ask refuses it, with its words', async () => {
    const { session, sent, frame } = sessionAsking()
    const asked = session.ask(document)
    await frame({
      type: PROBLEM_REPORT,
      from: mediator.did,
      thid: sent[0].id,
      body: { code: 'authorization.permission', comment: 'admin access is required to add accounts' },
    })
    await expect(asked).rejects.toThrow(/refused: authorization\.permission/)
    await session.stop()
  })

  test('CONTROL: a frame threaded to something else is no answer; a peer’s message still goes to the consumer, and the ask waits', async () => {
    const { session, sent, frame, onMessage } = sessionAsking()
    const asked = session.ask(document)
    await frame({
      type: 'https://didcomm.org/basicmessage/2.0/message',
      from: 'did:peer:2.a-peer',
      thid: 'urn:uuid:other',
      body: {},
    })
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(sent).toHaveLength(1)
    // Stopping the session is what ends a wait with no answer.
    await session.stop()
    await expect(asked).rejects.toThrow(/session stopped/)
  })

  test('no answer within the bound: the ask fails, and nothing is left waiting', async () => {
    const { session } = sessionAsking()
    await expect(session.ask(document, 20)).rejects.toThrow(/did not answer within 20 ms/)
    expect(session['asks'].size).toBe(0)
    await session.stop()
  })

  test('the socket refusing to carry it fails the ask at once, and nothing is left waiting', async () => {
    const { session } = sessionAsking()
    session['send'] = jest.fn(async () => {
      throw new Error('socket is not open')
    })
    await expect(session.ask(document)).rejects.toThrow('socket is not open')
    expect(session['asks'].size).toBe(0)
    await session.stop()
  })
})

describe('after an ask gave up', () => {
  test('a late answer is the mediator’s own frame, dropped unsaid: not handed on, not acknowledged, nothing waiting', async () => {
    const { session, sent, frame, onMessage } = sessionAsking()
    await expect(session.ask(document, 20)).rejects.toThrow(/did not answer within 20 ms/)
    await frame({ type: ENVELOPE, from: mediator.did, thid: sent[0].id, body: { payload: { late: true } } })
    expect(onMessage).not.toHaveBeenCalled()
    expect(session['acknowledge']).not.toHaveBeenCalled()
    expect(session['asks'].size).toBe(0)
    await session.stop()
  })

  test('CONTROL: a frame threaded to a live ask but not from the mediator is not its answer', async () => {
    const { session, sent, frame, onMessage } = sessionAsking()
    const asked = session.ask(document)
    await frame({ type: ENVELOPE, from: 'did:peer:2.a-peer', thid: sent[0].id, body: { payload: { forged: true } } })
    expect(onMessage).toHaveBeenCalledTimes(1)
    await session.stop()
    await expect(asked).rejects.toThrow(/session stopped/)
  })
})
