/**
 * A DID resolution is bounded (227 gate, Farm): the persona's mediator is a
 * did:webvh, resolved over the network, and a fetch that never answered held
 * the persona's sign-in — and with it the persona inbox — until the app was
 * killed. Each attempt now gives up after its timeout and is tried again; the
 * last failure is thrown, and every failure is said in the Release log.
 */
import { resolveDidDocumentRetrying, RESOLVE_ATTEMPT_TIMEOUT_MS } from '../module/VtiMediatorTransport'

const DID = 'did:webvh:QmMediator:dids.example:mediator'

function agentWith(resolve: jest.Mock) {
  return { dids: { resolveDidDocument: resolve } } as never
}

describe('resolving a DID document', () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    jest.useFakeTimers()
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    warn.mockRestore()
    jest.useRealTimers()
  })

  it('waits at most 15 s an attempt by default', () => {
    expect(RESOLVE_ATTEMPT_TIMEOUT_MS).toBe(15_000)
  })

  it('gives up on an attempt that never answers, and throws after the last', async () => {
    const resolve = jest.fn(() => new Promise(() => undefined))
    const done = resolveDidDocumentRetrying(agentWith(resolve), DID, 2, 1000)
    const failed = done.then(
      () => undefined,
      (e: Error) => e
    )
    await jest.advanceTimersByTimeAsync(1000 + 800 + 1000 + 1600)
    expect((await failed)?.message).toMatch(/took over 1 s/)
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringMatching(/resolving did:webvh:QmMedi.* failed \(attempt 1 of 2\): .*took over 1 s/),
      expect.stringMatching(/failed \(attempt 2 of 2\)/),
    ])
  })

  it('answers with a later attempt when an earlier one hung', async () => {
    const doc = { id: DID }
    const resolve = jest
      .fn()
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce(doc)
    const done = resolveDidDocumentRetrying(agentWith(resolve), DID, 3, 1000)
    await jest.advanceTimersByTimeAsync(1000 + 800)
    await expect(done).resolves.toBe(doc)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('an answer in time is the answer: nothing said', async () => {
    const doc = { id: DID }
    const done = resolveDidDocumentRetrying(agentWith(jest.fn().mockResolvedValue(doc)), DID)
    await expect(done).resolves.toBe(doc)
    expect(warn).not.toHaveBeenCalled()
  })
})
