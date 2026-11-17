/**
 * A listing waits, bounded, for its identity's own session while that session is opening (vtiOwnSessions
 * `ownSessionOnceOpen`), rather than signing the shared session in as the same identity. QG4P-MQCT (11-17): a launch's
 * first listing did that a moment before the identity's listener listened; the mediator closed one of the two sockets
 * (`duplicate-channel`), the answer came on it, and the listing waited 43 s with every room row behind it.
 */
import {
  dropAllOwnSessions,
  keepOwnSession,
  ownSessionFor,
  ownSessionOnceOpen,
  ownSessionOpening,
  ownSessionsSettling,
} from '../module/vtiOwnSessions'

const DID = 'did:webvh:p:tiger-phrase'
const session = { sendTo: async () => undefined }
const deferred = () => {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}
/** The wait's outcome so far, without waiting for it. */
const watch = (p: Promise<unknown>) => {
  const seen: { done: boolean; value?: unknown } = { done: false }
  void p.then((value) => Object.assign(seen, { done: true, value }))
  return seen
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => {
  jest.useRealTimers()
  dropAllOwnSessions()
})

describe('waiting for an identity’s own session that is opening', () => {
  it('gives the session once its listener listens, and not before', async () => {
    const opening = deferred()
    ownSessionOpening(DID, opening.promise)
    const seen = watch(ownSessionOnceOpen(DID, 15_000))
    await jest.advanceTimersByTimeAsync(5_000)
    expect(seen.done).toBe(false)
    keepOwnSession(DID, session)
    opening.resolve()
    await jest.advanceTimersByTimeAsync(0)
    expect(seen).toEqual({ done: true, value: session })
  })

  it('stops waiting at its bound, with none: an open that never ends holds a listing no longer than that', async () => {
    ownSessionOpening(DID, deferred().promise)
    const seen = watch(ownSessionOnceOpen(DID, 15_000))
    await jest.advanceTimersByTimeAsync(14_999)
    expect(seen.done).toBe(false)
    await jest.advanceTimersByTimeAsync(2)
    expect(seen).toEqual({ done: true, value: undefined })
  })

  it('gives none when the open fails, or ends with the listener stopped (handed to the shared session)', async () => {
    const failing = deferred()
    ownSessionOpening(DID, failing.promise)
    const failed = watch(ownSessionOnceOpen(DID, 15_000))
    failing.reject(new Error('challenge answered 503'))
    await jest.advanceTimersByTimeAsync(0)
    expect(failed).toEqual({ done: true, value: undefined })

    const stopped = deferred()
    ownSessionOpening(DID, stopped.promise)
    const handedOver = watch(ownSessionOnceOpen(DID, 15_000))
    stopped.resolve()
    await jest.advanceTimersByTimeAsync(0)
    expect(handedOver).toEqual({ done: true, value: undefined })
  })

  it('an open that ended is not waited on again: the next ask goes the shared way at once', async () => {
    const opening = deferred()
    ownSessionOpening(DID, opening.promise)
    opening.resolve()
    await jest.advanceTimersByTimeAsync(0)
    const seen = watch(ownSessionOnceOpen(DID, 15_000))
    await jest.advanceTimersByTimeAsync(0)
    expect(seen).toEqual({ done: true, value: undefined })
  })

  it('an older open ending does not end the wait on a newer one for the same identity', async () => {
    const older = deferred()
    const newer = deferred()
    ownSessionOpening(DID, older.promise)
    ownSessionOpening(DID, newer.promise)
    older.resolve()
    await jest.advanceTimersByTimeAsync(0)
    const seen = watch(ownSessionOnceOpen(DID, 15_000))
    await jest.advanceTimersByTimeAsync(1_000)
    expect(seen.done).toBe(false)
    keepOwnSession(DID, session)
    newer.resolve()
    await jest.advanceTimersByTimeAsync(0)
    expect(seen.value).toBe(session)
  })
})

// 66RA-EWC4 (11-17): a listing asked while the listeners were still deciding what to open found nothing opening, and
// signed the shared session in as an identity whose listener opened seconds later.
describe('waiting while the listeners decide which identities to open', () => {
  it('waits for the pass, then for the listener it starts, and gives that session', async () => {
    const pass = deferred()
    const opening = deferred()
    ownSessionsSettling(pass.promise)
    const seen = watch(ownSessionOnceOpen(DID, 15_000))
    await jest.advanceTimersByTimeAsync(1_000)
    expect(seen.done).toBe(false)
    ownSessionOpening(DID, opening.promise)
    pass.resolve()
    await jest.advanceTimersByTimeAsync(1_000)
    expect(seen.done).toBe(false)
    keepOwnSession(DID, session)
    opening.resolve()
    await jest.advanceTimersByTimeAsync(0)
    expect(seen).toEqual({ done: true, value: session })
  })

  it('a pass that ends with no listener started for this identity: none, as soon as it ends', async () => {
    const pass = deferred()
    ownSessionsSettling(pass.promise)
    const seen = watch(ownSessionOnceOpen(DID, 15_000))
    pass.resolve()
    await jest.advanceTimersByTimeAsync(0)
    expect(seen).toEqual({ done: true, value: undefined })
    expect(jest.getTimerCount()).toBe(0)
  })

  it('one bound covers the pass and the open together', async () => {
    const pass = deferred()
    ownSessionsSettling(pass.promise)
    const seen = watch(ownSessionOnceOpen(DID, 15_000))
    await jest.advanceTimersByTimeAsync(10_000)
    ownSessionOpening(DID, deferred().promise)
    pass.resolve()
    await jest.advanceTimersByTimeAsync(4_999)
    expect(seen.done).toBe(false)
    await jest.advanceTimersByTimeAsync(2)
    expect(seen).toEqual({ done: true, value: undefined })
  })

  it('a pass that fails, or never ends, holds a listing no longer than the bound', async () => {
    const failing = deferred()
    ownSessionsSettling(failing.promise)
    const failed = watch(ownSessionOnceOpen(DID, 15_000))
    failing.reject(new Error('identities not read'))
    await jest.advanceTimersByTimeAsync(0)
    expect(failed).toEqual({ done: true, value: undefined })

    ownSessionsSettling(deferred().promise)
    const stuck = watch(ownSessionOnceOpen(DID, 15_000))
    await jest.advanceTimersByTimeAsync(15_001)
    expect(stuck).toEqual({ done: true, value: undefined })
  })

  it('an older pass ending does not end the wait on a newer one', async () => {
    const older = deferred()
    const newer = deferred()
    ownSessionsSettling(older.promise)
    ownSessionsSettling(newer.promise)
    older.resolve()
    await jest.advanceTimersByTimeAsync(0)
    const seen = watch(ownSessionOnceOpen(DID, 15_000))
    await jest.advanceTimersByTimeAsync(1_000)
    expect(seen.done).toBe(false)
    newer.resolve()
    await jest.advanceTimersByTimeAsync(0)
    expect(seen).toEqual({ done: true, value: undefined })
  })

  it('a pass that ended is not waited on again (control)', async () => {
    const pass = deferred()
    ownSessionsSettling(pass.promise)
    pass.resolve()
    await jest.advanceTimersByTimeAsync(0)
    await expect(ownSessionOnceOpen(DID, 15_000)).resolves.toBeUndefined()
    expect(jest.getTimerCount()).toBe(0)
  })
})

describe('with nothing opening (controls)', () => {
  it('a session already open is given at once', async () => {
    keepOwnSession(DID, session)
    await expect(ownSessionOnceOpen(DID, 15_000)).resolves.toBe(session)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('no session and no open under way: none, at once, with no timer set', async () => {
    await expect(ownSessionOnceOpen(DID, 15_000)).resolves.toBeUndefined()
    expect(jest.getTimerCount()).toBe(0)
    expect(ownSessionFor(DID)).toBeUndefined()
  })
})
