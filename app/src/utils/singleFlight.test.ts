import { singleFlight } from './singleFlight'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('singleFlight', () => {
  it('starts one run for three calls made while it is in flight, and gives all three its result', async () => {
    // Three agent inits started together, as three Splash mounts did when a reset of the stored
    // mediator rebuilt initializeAgent: each opened the same Askar store, and one read it
    // half-created ("no such table: config").
    const run = deferred<string>()
    const init = jest.fn<Promise<string>, [walletSecret: string]>(() => run.promise)
    const inFlight = { current: null as Promise<string> | null }
    const calls = [
      singleFlight(inFlight, init)('secret'),
      singleFlight(inFlight, init)('secret'),
      singleFlight(inFlight, init)('secret'),
    ]
    run.resolve('agent')
    await expect(Promise.all(calls)).resolves.toEqual(['agent', 'agent', 'agent'])
    expect(init).toHaveBeenCalledTimes(1)
  })

  it('starts afresh once the run in flight has settled', async () => {
    const init = jest.fn(async (n: number) => n)
    const guarded = singleFlight({ current: null as Promise<number> | null }, init)
    await guarded(1)
    await expect(guarded(2)).resolves.toBe(2)
    expect(init).toHaveBeenCalledTimes(2)
  })

  it('lets a later call retry after a run that failed, and hands the failure to every waiting caller', async () => {
    const run = deferred<string>()
    const init = jest.fn().mockReturnValueOnce(run.promise).mockResolvedValueOnce('agent')
    const guarded = singleFlight({ current: null as Promise<string> | null }, init)
    const first = guarded()
    const second = guarded()
    run.reject(new Error('askar'))
    await expect(first).rejects.toThrow('askar')
    await expect(second).rejects.toThrow('askar')
    await expect(guarded()).resolves.toBe('agent')
    expect(init).toHaveBeenCalledTimes(2)
  })
})
