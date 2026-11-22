import type { Agent } from '@credo-ts/core'

import { LOCK_SHUTDOWN_WAIT_MS, oldStoreClosed } from '../lockShutdown'

/** An agent whose Askar store manager reports and closes as told. */
const agentWith = (stores: { isStoreOpen: () => boolean; closeStore?: () => Promise<void> } | (() => never)) =>
  ({
    context: {},
    dependencyManager: {
      resolve: () => {
        if (typeof stores === 'function') return stores()
        return { closeStore: async () => undefined, ...stores }
      },
    },
  }) as unknown as Agent

describe('oldStoreClosed: a new agent starts only on positive evidence that the old store is closed', () => {
  afterEach(() => jest.useRealTimers())

  it('proceeds once the shutdown is done and the store is closed', async () => {
    const isStoreOpen = jest.fn(() => false)
    await expect(oldStoreClosed({ agent: agentWith({ isStoreOpen }), done: Promise.resolve() })).resolves.toBe(true)
    expect(isStoreOpen).toHaveBeenCalled()
  })

  it('proceeds when there was no agent at the lock-out', async () => {
    await expect(oldStoreClosed({ agent: null, done: Promise.resolve() })).resolves.toBe(true)
  })

  it('closes a store the shutdown left open, and proceeds once it reads closed', async () => {
    // A module's shutdown threw, so credo never reached closeAgentContext; the helper logged and resolved anyway.
    let open = true
    const closeStore = jest.fn(async () => {
      open = false
    })
    await expect(
      oldStoreClosed({ agent: agentWith({ isStoreOpen: () => open, closeStore }), done: Promise.resolve() })
    ).resolves.toBe(true)
    expect(closeStore).toHaveBeenCalledTimes(1)
  })

  it('refuses when the store still reads open after closing it', async () => {
    await expect(
      oldStoreClosed({ agent: agentWith({ isStoreOpen: () => true }), done: Promise.resolve() })
    ).resolves.toBe(false)
  })

  it('refuses when closing the store throws', async () => {
    const closeStore = jest.fn(async () => {
      throw new Error('Error closing store')
    })
    await expect(
      oldStoreClosed({ agent: agentWith({ isStoreOpen: () => true, closeStore }), done: Promise.resolve() })
    ).resolves.toBe(false)
  })

  it('refuses when the store manager cannot be resolved (a disposed container)', async () => {
    const disposed = agentWith(() => {
      throw new Error('container disposed')
    })
    await expect(oldStoreClosed({ agent: disposed, done: Promise.resolve() })).resolves.toBe(false)
  })

  it('refuses when the open check itself throws', async () => {
    const isStoreOpen = () => {
      throw new Error('no store level')
    }
    await expect(oldStoreClosed({ agent: agentWith({ isStoreOpen }), done: Promise.resolve() })).resolves.toBe(false)
  })

  it('checks the store, not the promise, when the shutdown rejects', async () => {
    await expect(
      oldStoreClosed({ agent: agentWith({ isStoreOpen: () => false }), done: Promise.reject(new Error('shutdown')) })
    ).resolves.toBe(true)
    await expect(
      oldStoreClosed({ agent: agentWith({ isStoreOpen: () => true }), done: Promise.reject(new Error('shutdown')) })
    ).resolves.toBe(false)
  })

  it('refuses when the shutdown is still running past the bound, without reading the store', async () => {
    jest.useFakeTimers()
    const isStoreOpen = jest.fn(() => false)
    const result = oldStoreClosed({ agent: agentWith({ isStoreOpen }), done: new Promise(() => undefined) })
    jest.advanceTimersByTime(LOCK_SHUTDOWN_WAIT_MS)
    await expect(result).resolves.toBe(false)
    // A store closing under a shutdown still in progress is not evidence of anything.
    expect(isStoreOpen).not.toHaveBeenCalled()
  })
})
