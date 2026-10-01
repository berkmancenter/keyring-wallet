/**
 * Unlink drops what is queued (227 gate U4, lab, 09-30): an app just started
 * queues whoami … device/list, and an unlink tapped then queued its "tell the
 * agent" behind them and ran out of time before it was sent. `dropQueued`
 * fails every task queued and not yet sent, without sending it; the task in
 * flight finishes; what is asked for afterwards runs as usual.
 */
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  signDocumentProof: jest.fn(async (_agent: unknown, doc: Record<string, unknown>) => doc),
}))
jest.mock('../module/tspCapability', () => ({ chooseCarriage: jest.fn(async () => 'didcomm') }))
jest.mock('../module/vtaReplyProof', () => ({ checkVtaReply: jest.fn(async () => ({ kind: 'unsigned' })) }))

import { VtaClient, VtaTaskDropped } from '../module/VtaClient'

function connectedClient() {
  const client = new VtaClient(
    { config: { logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn() } } } as never,
    'did:webvh:agent',
    {} as never,
    {}
  )
  const sendTo = jest.fn(async () => undefined)
  const internals = client as unknown as { session: unknown; identity: unknown; deliver: (m: unknown) => void }
  internals.session = { sendTo, isOpen: true }
  internals.identity = { did: 'did:peer:2.phone' }
  const sentTypes = () =>
    (sendTo.mock.calls as unknown as [string, { body: { type: string } }][]).map((c) => c[1].body.type)
  const answerLast = () => {
    const body = (sendTo.mock.calls.at(-1) as unknown as [string, { body: Record<string, unknown> }])[1].body
    internals.deliver({
      id: 'urn:uuid:reply',
      type: 'https://trusttasks.org/binding/didcomm/v2',
      from: 'did:webvh:agent',
      thid: body.threadId,
      created_time: Math.floor(Date.now() / 1000),
      body: { type: `${body.type}#response`, threadId: body.threadId, payload: { ok: true } },
    })
  }
  return { client, sentTypes, answerLast }
}
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

describe('dropping the queue', () => {
  it('drops what is queued and the wait in flight, and sends what comes after at once', async () => {
    const { client, sentTypes, answerLast } = connectedClient()
    const inFlight = client.task('https://t/whoami', {}, 30_000)
    const queuedA = client.task('https://t/acl-list', {}, 5_000)
    const queuedB = client.task('https://t/device-list', {}, 5_000)
    await flush()
    expect(sentTypes()).toEqual(['https://t/whoami'])

    client.dropQueued()
    const after = client.task('https://t/set-wake', {}, 5_000)

    await expect(inFlight).rejects.toBeInstanceOf(VtaTaskDropped)
    await expect(queuedA).rejects.toBeInstanceOf(VtaTaskDropped)
    await expect(queuedB).rejects.toThrow(/device-list was dropped before it was sent/)
    await flush()
    // Sent without waiting out whoami's 30 s.
    expect(sentTypes()).toEqual(['https://t/whoami', 'https://t/set-wake'])
    answerLast()
    await expect(after).resolves.toEqual({ ok: true })
  })
})
