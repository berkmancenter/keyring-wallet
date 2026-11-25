/**
 * A file author's DID document is fetched at most once until the wallet locks (`real/files/senderDocuments.ts`):
 * fetching one tells the author's host this phone is reading.
 */
import type { Agent } from '@credo-ts/core'
import { DeviceEventEmitter } from 'react-native'

import { WALLET_LOCKED_EVENT } from '../../../utils/walletLocked'
import { SENDER_RESOLVE_MS, senderResolver } from '../real/files/senderDocuments'

const agentWith = (resolveDidDocument: jest.Mock) => ({ dids: { resolveDidDocument } }) as unknown as Agent

describe('a file author’s DID document', () => {
  afterEach(() => {
    DeviceEventEmitter.emit(WALLET_LOCKED_EVENT)
    jest.useRealTimers()
  })

  it('is fetched once per author, however many files and readers ask, until the wallet locks', async () => {
    const fetch = jest.fn(async (did: string) => ({ id: did }))
    const resolve = senderResolver(agentWith(fetch))
    await Promise.all([resolve('did:webvh:alice'), resolve('did:webvh:alice')])
    await resolve('did:webvh:alice')
    await resolve('did:webvh:bob')
    // Another service on the same phone shares what was fetched.
    await senderResolver(agentWith(fetch))('did:webvh:alice')
    expect(fetch.mock.calls.map(([did]) => did)).toEqual(['did:webvh:alice', 'did:webvh:bob'])

    DeviceEventEmitter.emit(WALLET_LOCKED_EVENT)
    await resolve('did:webvh:alice')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('one that could not be had is not asked for again before the lock', async () => {
    const fetch = jest.fn(async () => {
      throw new Error('offline')
    })
    const resolve = senderResolver(agentWith(fetch))
    await expect(resolve('did:webvh:alice')).rejects.toThrow('offline')
    await expect(resolve('did:webvh:alice')).rejects.toThrow('offline')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('a fetch that does not answer is given up after SENDER_RESOLVE_MS', async () => {
    jest.useFakeTimers()
    const resolve = senderResolver(agentWith(jest.fn(() => new Promise(() => undefined))))
    const asked = resolve('did:webvh:alice')
    const settled = asked.catch((e: Error) => e.message)
    jest.advanceTimersByTime(SENDER_RESOLVE_MS - 1)
    await Promise.resolve()
    let done = false
    settled.then(() => (done = true))
    await Promise.resolve()
    expect(done).toBe(false)
    jest.advanceTimersByTime(1)
    expect(await settled).toMatch(/no DID document within/)
  })
})
