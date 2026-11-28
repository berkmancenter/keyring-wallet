import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'

import {
  SETTLE_BOUND_MS,
  VtiMediatorSession,
  type VtiClientIdentity,
  type VtiMediatorEndpoints,
} from '../module/VtiMediatorTransport'

// `VtiMediatorSession.sendToSettled` / `forwardSettled`: a forward whose refusal by our mediator rejects the send.
// The mediator answers only a forward it refuses (a problem-report threaded to it by `pthid`) and nothing for one it
// takes (affinidi-messaging-mediator f6ed815, handlers/websocket/connection.rs `on_text`), so a send that is not
// refused ends `fenced` (a pickup status-request after it was answered, with no refusal before) or
// `notRefusedWithin` its bound. Here the frame handling is the shipping one, with the decrypt step standing in.

const identity: VtiClientIdentity = {
  did: 'did:peer:2.chat-of-this-phone',
  kid: 'did:peer:2.chat-of-this-phone#key-2',
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
const FORWARD = 'https://didcomm.org/routing/2.0/forward'
const STATUS_REQUEST = 'https://didcomm.org/messagepickup/3.0/status-request'
const STATUS = 'https://didcomm.org/messagepickup/3.0/status'
const AGENT = 'did:peer:2.the-owners-agent'
const INNER = {
  protected: 'e30',
  recipients: [{ header: { kid: `${AGENT}#key-1` } }],
  iv: 'i',
  ciphertext: 'c',
  tag: 't',
}

/** A refusal as the mediator writes it (error_response.rs): its own id, `pthid` naming the refused message. */
const refusal = (pthid: string, code = 'e.p.authorization.send_forwarded') => ({
  id: 'urn:uuid:pr-1',
  type: PROBLEM_REPORT,
  from: mediator.did,
  pthid,
  body: { code, comment: 'the sender may not forward' },
})
const fenceAnswer = (thid: string) => ({ type: STATUS, from: mediator.did, thid, body: { message_count: 0 } })

function sessionSending() {
  const onMessage = jest.fn(async () => undefined)
  const session = new VtiMediatorSession(agent, identity, mediator, { onMessage })
  const sent: DidCommV2PlaintextMessage[] = []
  session['send'] = jest.fn(async (plaintext: DidCommV2PlaintextMessage) => {
    sent.push(plaintext)
  })
  session['acknowledge'] = jest.fn(async (_ids: string[]) => undefined)
  // A peer on our own mediator: one forward layer, no route to read.
  session['tspOnlyMediatorFor'] = jest.fn(async () => undefined)
  /** Frames as the socket hands them over (`takeFrame`): each one's decrypt yields its plaintext, when `gate` opens. */
  const decrypts = new Map<string, { plaintext: Record<string, unknown>; gate?: Promise<void> }>()
  session['unpack'] = async (encrypted: { ciphertext: string }) => {
    const found = decrypts.get(encrypted.ciphertext)
    if (!found) throw new Error(`no decrypt for ${encrypted.ciphertext}`)
    await found.gate
    return found.plaintext as DidCommV2PlaintextMessage
  }
  const arrive = (name: string, plaintext: Record<string, unknown>, gate?: Promise<void>) => {
    decrypts.set(name, { plaintext, gate })
    return session['takeFrame'](JSON.stringify({ protected: 'e30', ciphertext: name }))
  }
  return { session, sent, arrive, onMessage }
}

function gate() {
  let open: () => void = () => undefined
  const shut = new Promise<void>((resolve) => {
    open = resolve
  })
  return { shut, open }
}

let warn: jest.SpyInstance
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => warn.mockRestore())
const warned = () => warn.mock.calls.map((call) => String(call[0]))

describe('a settled send', () => {
  test('the forward, then the fence: a status-request to the mediator for this identity, after the forward', async () => {
    const { session, sent } = sessionSending()
    const settled = session.forwardSettled(AGENT, INNER)
    await new Promise((r) => setImmediate(r))
    expect(sent).toHaveLength(2)
    expect(sent[0]).toMatchObject({ type: FORWARD, from: identity.did, to: [mediator.did], body: { next: AGENT } })
    expect(sent[1]).toMatchObject({
      type: STATUS_REQUEST,
      from: identity.did,
      to: [mediator.did],
      body: { recipient_did: identity.did },
    })
    expect(sent[1].id).not.toBe(sent[0].id)
    await session.stop()
    await settled
  })

  test('the fence answered with no refusal before it: fenced, under the forward’s id, nothing handed on or said', async () => {
    const { session, sent, arrive, onMessage } = sessionSending()
    const settled = session.forwardSettled(AGENT, INNER)
    await new Promise((r) => setImmediate(r))
    await arrive('status', fenceAnswer(sent[1].id))
    await expect(settled).resolves.toEqual({ id: sent[0].id, settled: 'fenced' })
    expect(session['settling'].size).toBe(0)
    expect(onMessage).not.toHaveBeenCalled()
    expect(warned()).toEqual([])
    await session.stop()
  })

  test('the mediator refusing the forward (pthid): the send rejects with its words, at once, and it is not logged', async () => {
    const { session, sent, arrive, onMessage } = sessionSending()
    const before = Date.now()
    const settled = session.forwardSettled(AGENT, INNER)
    await new Promise((r) => setImmediate(r))
    await arrive('refusal', refusal(sent[0].id))
    await expect(settled).rejects.toThrow(/refused: e\.p\.authorization\.send_forwarded/)
    expect(Date.now() - before).toBeLessThan(SETTLE_BOUND_MS)
    expect(session['settling'].size).toBe(0)
    expect(onMessage).not.toHaveBeenCalled()
    expect(warned()).toEqual([])
    // The fence's answer, arriving after, changes nothing.
    await arrive('status', fenceAnswer(sent[1].id))
    expect(warned()).toEqual([])
    await session.stop()
  })

  test('a refusal that arrived BEFORE the fence answer but decrypts after it still refuses the send', async () => {
    const { session, sent, arrive } = sessionSending()
    const settled = session.forwardSettled(AGENT, INNER)
    await new Promise((r) => setImmediate(r))
    const slow = gate()
    const refused = arrive('refusal', refusal(sent[0].id), slow.shut)
    // The fence answer is handled first: it may not count while an earlier frame is still being opened.
    await arrive('status', fenceAnswer(sent[1].id))
    slow.open()
    await refused
    await expect(settled).rejects.toThrow(/refused: e\.p\.authorization\.send_forwarded/)
    await session.stop()
  })

  test('CONTROL: an earlier frame that is no refusal holds the fence until it is handled, then the send is fenced', async () => {
    const { session, sent, arrive, onMessage } = sessionSending()
    const settled = session.forwardSettled(AGENT, INNER)
    await new Promise((r) => setImmediate(r))
    const slow = gate()
    let outcome: unknown
    void settled.then((value) => {
      outcome = value
    })
    const peerMessage = arrive(
      'peer',
      { type: 'https://didcomm.org/basicmessage/2.0/message', from: 'did:peer:2.a-peer', body: {} },
      slow.shut
    )
    await arrive('status', fenceAnswer(sent[1].id))
    await new Promise((r) => setImmediate(r))
    expect(outcome).toBeUndefined()
    slow.open()
    await peerMessage
    await expect(settled).resolves.toEqual({ id: sent[0].id, settled: 'fenced' })
    expect(onMessage).toHaveBeenCalledTimes(1)
    await session.stop()
  })

  test('CONTROL: a frame that arrived AFTER the fence answer is not waited for', async () => {
    const { session, sent, arrive } = sessionSending()
    const settled = session.forwardSettled(AGENT, INNER)
    await new Promise((r) => setImmediate(r))
    const slow = gate()
    await arrive('status', fenceAnswer(sent[1].id))
    void arrive(
      'peer',
      { type: 'https://didcomm.org/basicmessage/2.0/message', from: 'did:peer:2.a-peer', body: {} },
      slow.shut
    )
    await expect(settled).resolves.toEqual({ id: sent[0].id, settled: 'fenced' })
    slow.open()
    await session.stop()
  })

  test('without the fence: only the forward is sent, and with no refusal the send ends not refused within its bound', async () => {
    const { session, sent } = sessionSending()
    const outcome = await session.forwardSettled(AGENT, INNER, { fence: false, withinMs: 20 })
    expect(outcome).toEqual({ id: sent[0].id, settled: 'notRefusedWithin', withinMs: 20 })
    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe(FORWARD)
    expect(session['settling'].size).toBe(0)
    await session.stop()
  })

  test('without the fence, a refusal within the bound still rejects', async () => {
    const { session, sent, arrive } = sessionSending()
    const settled = session.forwardSettled(AGENT, INNER, { fence: false, withinMs: 1_000 })
    await new Promise((r) => setImmediate(r))
    await arrive('refusal', refusal(sent[0].id, 'e.p.delivery.refused'))
    await expect(settled).rejects.toThrow(/refused: e\.p\.delivery\.refused/)
    await session.stop()
  })

  test('a fence never answered: the bound decides, not refused within it', async () => {
    const { session, sent } = sessionSending()
    const outcome = await session.forwardSettled(AGENT, INNER, { withinMs: 20 })
    expect(outcome).toEqual({ id: sent[0].id, settled: 'notRefusedWithin', withinMs: 20 })
    expect(sent.map((m) => m.type)).toEqual([FORWARD, STATUS_REQUEST])
    expect(session['settling'].size).toBe(0)
    await session.stop()
  })

  test('a fence that cannot be sent leaves the bound to decide: the forward left, so the send does not fail', async () => {
    const { session, sent } = sessionSending()
    session['send'] = jest.fn(async (plaintext: DidCommV2PlaintextMessage) => {
      if (plaintext.type === STATUS_REQUEST) throw new Error('socket closed while the message was packed')
      sent.push(plaintext)
    })
    await expect(session.forwardSettled(AGENT, INNER, { withinMs: 20 })).resolves.toMatchObject({
      settled: 'notRefusedWithin',
    })
    expect(session['settling'].size).toBe(0)
    await session.stop()
  })

  test('the forward that cannot be sent fails the send at once, no fence asked, nothing left waiting', async () => {
    const { session } = sessionSending()
    const tried: DidCommV2PlaintextMessage[] = []
    session['send'] = jest.fn(async (plaintext: DidCommV2PlaintextMessage) => {
      tried.push(plaintext)
      throw new Error('socket is not open')
    })
    await expect(session.forwardSettled(AGENT, INNER)).rejects.toThrow('socket is not open')
    expect(tried.map((m) => m.type)).toEqual([FORWARD])
    expect(session['settling'].size).toBe(0)
    await session.stop()
  })

  test('a refusal of the fence itself is no refusal of the forward: logged as before, and the bound decides', async () => {
    const { session, sent, arrive } = sessionSending()
    const settled = session.forwardSettled(AGENT, INNER, { withinMs: 50 })
    await new Promise((r) => setImmediate(r))
    await arrive('fence-refused', refusal(sent[1].id, 'e.p.authorization.did.session_mismatch'))
    await expect(settled).resolves.toMatchObject({ settled: 'notRefusedWithin', withinMs: 50 })
    expect(warned()).toHaveLength(1)
    expect(warned()[0]).toContain('e.p.authorization.did.session_mismatch')
    await session.stop()
  })

  test('the session stopping first: the send ends `stopped`, its own result, never the bound’s and never a failure', async () => {
    const { session, sent } = sessionSending()
    const settled = session.forwardSettled(AGENT, INNER, { withinMs: 60_000 })
    await new Promise((r) => setImmediate(r))
    await session.stop()
    const outcome = await settled
    expect(outcome).toMatchObject({ id: sent[0].id, settled: 'stopped' })
    expect(outcome).not.toHaveProperty('withinMs')
    expect((outcome as { afterMs: number }).afterMs).toBeLessThan(60_000)
    expect(session['settling'].size).toBe(0)
  })

  test('CONTROL: the bound reached on a live session is `notRefusedWithin`, never `stopped`, with or without the fence', async () => {
    for (const fence of [true, false]) {
      const { session, sent } = sessionSending()
      const outcome = await session.forwardSettled(AGENT, INNER, { fence, withinMs: 20 })
      expect(outcome).toEqual({ id: sent[0].id, settled: 'notRefusedWithin', withinMs: 20 })
      await session.stop()
    }
  })

  test('a refusal arriving after the bound is the mediator’s own, logged as before', async () => {
    const { session, sent, arrive } = sessionSending()
    await session.forwardSettled(AGENT, INNER, { fence: false, withinMs: 20 })
    await arrive('late', refusal(sent[0].id))
    expect(warned()).toHaveLength(1)
    expect(warned()[0]).toContain('e.p.authorization.send_forwarded')
    await session.stop()
  })
})

describe('a released forward is never waited on', () => {
  test('`forward` lists nothing, and the mediator’s refusal threaded to its id still goes to the log', async () => {
    const { session, sent, arrive, onMessage } = sessionSending()
    await session.forward(AGENT, INNER)
    expect(sent).toHaveLength(1)
    expect(session['settling'].size).toBe(0)
    expect(session['asks'].size).toBe(0)
    await arrive('refusal', refusal(sent[0].id))
    expect(warned()).toHaveLength(1)
    expect(warned()[0]).toContain('e.p.authorization.send_forwarded')
    expect(onMessage).not.toHaveBeenCalled()
    await session.stop()
  })

  test('CONTROL: with a settled send waiting too, a refusal of the plain forward is logged and does not touch it', async () => {
    const { session, sent, arrive } = sessionSending()
    await session.forward(AGENT, INNER)
    const plainId = sent[0].id
    const settled = session.forwardSettled(AGENT, INNER)
    await new Promise((r) => setImmediate(r))
    await arrive('refusal', refusal(plainId))
    expect(warned()).toHaveLength(1)
    expect(session['settling'].size).toBe(2)
    await arrive('status', fenceAnswer(sent[2].id))
    await expect(settled).resolves.toEqual({ id: sent[1].id, settled: 'fenced' })
    await session.stop()
  })

  test('`sendTo` and `forward` send no fence', async () => {
    const { session, sent } = sessionSending()
    await session.forward(AGENT, INNER)
    expect(sent.map((m) => m.type)).toEqual([FORWARD])
    await session.stop()
  })
})

describe('the settled forward is the forward `forward` sends', () => {
  const strip = (m: DidCommV2PlaintextMessage): unknown =>
    JSON.parse(
      JSON.stringify(m, (key, value) => (key === 'id' || key === 'created_time' || key === 'expires_time' ? 0 : value))
    )

  test('a peer on our own mediator: one layer, the same shape', async () => {
    const { session, sent } = sessionSending()
    await session.forward(AGENT, INNER)
    const settled = session.forwardSettled(AGENT, INNER, { fence: false, withinMs: 1 })
    await settled
    expect(strip(sent[1])).toEqual(strip(sent[0]))
    await session.stop()
  })

  test('a peer behind a mediator ours may not route to: two layers, the same shape', async () => {
    const { session, sent } = sessionSending()
    const theirs = { ...mediator, did: 'did:webvh:QmTheirs:theirs.example:mediator' }
    session['tspOnlyMediatorFor'] = jest.fn(async () => theirs)
    session['packFor'] = jest.fn(async (to: { did: string }, m: DidCommV2PlaintextMessage) => ({
      packedFor: to.did,
      body: m.body,
      type: m.type,
    }))
    await session.forward(AGENT, INNER)
    await session.forwardSettled(AGENT, INNER, { fence: false, withinMs: 1 })
    expect(sent[0]).toMatchObject({ body: { next: theirs.did } })
    expect(strip(sent[1])).toEqual(strip(sent[0]))
    await session.stop()
  })
})
