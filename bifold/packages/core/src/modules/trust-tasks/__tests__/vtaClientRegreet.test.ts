/**
 * A VTA that restarted forgets the TSP relationship and drops what the phone
 * sends in silence (al-phone, 10-05): every ask went "over rev3" and none was
 * answered until the app was force-quit. The phone greets once per session, so
 * an ask over TSP that gets no answer clears the greeting and the next ask
 * sends the XRFI invite again before its task.
 */
jest.mock('@bifold/trust-tasks', () => {
  const actual = jest.requireActual('@bifold/trust-tasks')
  return {
    ...actual,
    signDocumentProof: jest.fn(async (_agent: unknown, doc: Record<string, unknown>) => doc),
    tsp: {
      ...actual.tsp,
      CODEC_FORMS_RELATIONSHIPS: true,
      packInviteRev3: jest.fn(async () => ({ bytes: new Uint8Array([0x49]) })),
    },
  }
})
jest.mock('../module/tspCapability', () => ({ chooseCarriage: jest.fn(async () => 'tsp') }))
jest.mock('../module/vtaReplyProof', () => ({ checkVtaReply: jest.fn(async () => ({ kind: 'unsigned' })) }))
jest.mock('../module/vtiTsp', () => ({
  ...jest.requireActual('../module/vtiTsp'),
  packTrustTaskForPeer: jest.fn(async (_tsp: unknown, _from: string, _to: string, doc: Record<string, unknown>) => ({
    bytes: new Uint8Array([0x54]),
    revision: 'rev3',
    doc,
  })),
}))

import { VtaClient } from '../module/VtaClient'

const HEARTBEAT = 'https://trusttasks.org/spec/vta/device/heartbeat/0.1'

function tspClient() {
  const client = new VtaClient(
    { config: { logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn() } } } as never,
    'did:webvh:agent',
    {} as never,
    {}
  )
  // What went out, in order: 'invite' or the task's type.
  const frames: string[] = []
  const tasks: Record<string, unknown>[] = []
  const sendTspFrame = jest.fn(async (bytes: Uint8Array) => {
    if (bytes[0] === 0x49) frames.push('invite')
    else frames.push(String(tasks.at(-1)?.type))
  })
  const internals = client as unknown as {
    session: unknown
    identity: unknown
    tsp: unknown
    mediator: unknown
    deliver: (m: unknown) => void
  }
  internals.session = { sendTspFrame, isOpen: true }
  internals.identity = { did: 'did:peer:2.phone' }
  internals.tsp = { identity: {}, resolver: {} }
  internals.mediator = { did: 'did:web:mediator' }
  const { packTrustTaskForPeer } = jest.requireMock('../module/vtiTsp') as {
    packTrustTaskForPeer: jest.Mock
  }
  packTrustTaskForPeer.mockImplementation(
    async (_tsp: unknown, _from: string, _to: string, doc: Record<string, unknown>) => {
      tasks.push(doc)
      return { bytes: new Uint8Array([0x54]), revision: 'rev3' }
    }
  )
  const answerLast = () => {
    const doc = tasks.at(-1) as { type: string; threadId: string }
    internals.deliver({
      id: 'urn:uuid:reply',
      type: 'https://trusttasks.org/binding/didcomm/v2',
      from: 'did:webvh:agent',
      thid: doc.threadId,
      created_time: Math.floor(Date.now() / 1000),
      body: { type: `${doc.type}#response`, threadId: doc.threadId, payload: { ok: true } },
    })
  }
  return { client, frames, answerLast }
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

describe('greeting the VTA again after an ask over TSP got no answer', () => {
  afterEach(() => jest.useRealTimers())

  it('greets once while the VTA answers', async () => {
    const { client, frames, answerLast } = tspClient()
    const first = client.task('https://t/whoami', {}, 5_000)
    await flush()
    answerLast()
    await expect(first).resolves.toEqual({ ok: true })
    const second = client.task('https://t/acl-list', {}, 5_000)
    await flush()
    answerLast()
    await expect(second).resolves.toEqual({ ok: true })
    expect(frames).toEqual(['invite', 'https://t/whoami', 'https://t/acl-list'])
  })

  it('a heartbeat that times out makes the next heartbeat greet first, and that one is answered', async () => {
    jest.useFakeTimers()
    const { client, frames, answerLast } = tspClient()
    const first = client.task(HEARTBEAT, {}, 1_000)
    await flush()
    expect(frames).toEqual(['invite', HEARTBEAT])
    // The VTA restarted: nothing comes back.
    jest.advanceTimersByTime(1_000)
    await expect(first).rejects.toThrow(/did not answer/)

    const next = client.task(HEARTBEAT, {}, 1_000)
    await flush()
    // Not resent on its own; the next ask greets before its task.
    expect(frames).toEqual(['invite', HEARTBEAT, 'invite', HEARTBEAT])
    answerLast()
    await expect(next).resolves.toEqual({ ok: true })

    // Greeted again, so the ask after that does not.
    const after = client.task('https://t/whoami', {}, 1_000)
    await flush()
    answerLast()
    await expect(after).resolves.toEqual({ ok: true })
    expect(frames).toEqual(['invite', HEARTBEAT, 'invite', HEARTBEAT, 'https://t/whoami'])
  })

  it('an invite that failed to send is tried again on the next ask', async () => {
    const { client, frames, answerLast } = tspClient()
    const session = (client as unknown as { session: { sendTspFrame: jest.Mock } }).session
    const send = session.sendTspFrame.getMockImplementation()!
    session.sendTspFrame.mockImplementationOnce(async () => {
      throw new Error('socket closed')
    })
    await expect(client.task('https://t/whoami', {}, 5_000)).rejects.toThrow(/socket closed/)
    session.sendTspFrame.mockImplementation(send)
    const next = client.task('https://t/whoami', {}, 5_000)
    await flush()
    answerLast()
    await expect(next).resolves.toEqual({ ok: true })
    expect(frames).toEqual(['invite', 'https://t/whoami'])
  })
})
