/**
 * A slow mint's answer reaches the flow (227 gate, VTA Farm, 09-30).
 *
 * The phone asked the VTA to mint its persona at 16:31:59.7Z and gave up after
 * 30 s; the VTA had opened a TSP relationship with the DID host first and
 * answered at 16:32:31.6Z — minted, with nobody waiting. The phone's retry
 * reused the mint's idempotency key, and the VTA replayed the first answer as
 * recorded (vta-service trust_tasks/idempotency.rs:249-253, VTI 270da936),
 * threaded to the FIRST attempt; the retry took that for an earlier task's late
 * answer and waited out its own 30 s. "Your agent didn't answer", twice, for a
 * persona that existed.
 *
 * Now a mint waits two minutes, and a keyed retry takes an answer threaded to
 * any attempt of the same key — and only that: another key's answer stays
 * another task's.
 */
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  signDocumentProof: jest.fn(async (_agent: unknown, doc: Record<string, unknown>) => doc),
}))
jest.mock('../module/tspCapability', () => ({ chooseCarriage: jest.fn(async () => 'didcomm') }))
jest.mock('../module/vtaReplyProof', () => ({ checkVtaReply: jest.fn(async () => ({ kind: 'unsigned' })) }))

import { MINT_TIMEOUT_MS, VTA_TASK, VtaClient } from '../module/VtaClient'

const MINT = VTA_TASK.didsCreate
const PAYLOAD = { contextId: 'vta', serverId: 'control', label: 'keyring-x' }
const MINTED = { did: 'did:webvh:QmMinted:dids.example:immune-hood' }

function connectedClient() {
  const onInbound = jest.fn()
  const info = jest.fn()
  const client = new VtaClient(
    { config: { logger: { warn: jest.fn(), info, debug: jest.fn() } } } as never,
    'did:webvh:agent',
    {} as never,
    { onInbound }
  )
  const sendTo = jest.fn(async () => undefined)
  const internals = client as unknown as {
    session: unknown
    identity: unknown
    deliver: (m: unknown) => void
  }
  internals.session = { sendTo, isOpen: true }
  internals.identity = { did: 'did:peer:2.phone' }
  const sent = () => (sendTo.mock.calls.at(-1) as unknown as [string, { body: Record<string, unknown> }])[1].body
  // As the VTA answers over TSP: the reply document is the body, and its
  // threadId (the request it answers) is the message's thid (vtiTsp.ts).
  const answerTo = (threadId: unknown) =>
    internals.deliver({
      id: 'urn:uuid:reply',
      type: 'https://trusttasks.org/binding/didcomm/v2',
      from: 'did:webvh:agent',
      thid: threadId,
      created_time: Math.floor(Date.now() / 1000),
      body: { type: `${MINT}#response`, threadId, payload: MINTED },
    })
  return { client, sent, answerTo, onInbound, info }
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('a slow mint', () => {
  afterEach(() => jest.useRealTimers())

  it('waits two minutes, well past the 31.2 s the Farm took', async () => {
    expect(MINT_TIMEOUT_MS).toBe(120_000)
    const vta = new VtaClient({} as never, 'did:webvh:agent', {} as never)
    const task = jest
      .spyOn(vta as unknown as { task: (...a: unknown[]) => Promise<unknown> }, 'task')
      .mockResolvedValue(MINTED)
    await vta.mintPersona({ ...PAYLOAD, idempotencyKey: 'urn:uuid:k' })
    expect(task.mock.calls[0][0]).toBe(MINT)
    expect(task.mock.calls[0][2]).toBe(MINT_TIMEOUT_MS)
  })

  it('an answer 31.2 s after the request is the answer', async () => {
    jest.useFakeTimers()
    const { client, sent, answerTo } = connectedClient()
    const minted = client.task(MINT, PAYLOAD, MINT_TIMEOUT_MS, { idempotencyKey: 'urn:uuid:k' })
    await flush()
    const threadId = sent().threadId
    await jest.advanceTimersByTimeAsync(31_200)
    answerTo(threadId)
    await expect(minted).resolves.toEqual(MINTED)
  })
})

describe('a keyed retry', () => {
  it("takes the VTA's replay of the first attempt's answer", async () => {
    const { client, sent, answerTo, onInbound, info } = connectedClient()
    const first = client.task(MINT, PAYLOAD, 50, { idempotencyKey: 'urn:uuid:k' })
    await flush()
    const firstThread = sent().threadId
    await expect(first).rejects.toThrow(/did not answer/)

    const retry = client.task(MINT, PAYLOAD, 5_000, { idempotencyKey: 'urn:uuid:k' })
    await flush()
    expect(sent().threadId).not.toBe(firstThread)
    answerTo(firstThread)
    await expect(retry).resolves.toEqual(MINTED)
    expect(onInbound).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/answer to an earlier attempt of the same keyed request/))
  })

  it("does not take an answer threaded to another key's request", async () => {
    const { client, sent, answerTo, onInbound } = connectedClient()
    const other = client.task(MINT, PAYLOAD, 50, { idempotencyKey: 'urn:uuid:other' })
    await flush()
    const otherThread = sent().threadId
    await expect(other).rejects.toThrow(/did not answer/)

    const mine = client.task(MINT, PAYLOAD, 300, { idempotencyKey: 'urn:uuid:mine' })
    await flush()
    answerTo(otherThread)
    expect(onInbound).toHaveBeenCalledTimes(1)
    await expect(mine).rejects.toThrow(/did not answer/)
  })

  it('an unkeyed task still takes only its own thread', async () => {
    const { client, sent, answerTo, onInbound } = connectedClient()
    const first = client.task(MINT, PAYLOAD, 50)
    await flush()
    const firstThread = sent().threadId
    await expect(first).rejects.toThrow(/did not answer/)
    const second = client.task(MINT, PAYLOAD, 300)
    await flush()
    answerTo(firstThread)
    expect(onInbound).toHaveBeenCalledTimes(1)
    await expect(second).rejects.toThrow(/did not answer/)
  })
})
