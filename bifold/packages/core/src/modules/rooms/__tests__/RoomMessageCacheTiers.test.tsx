/**
 * Which rooms' chats are kept in the wallet (rooms/messageCache), as the room screen asks: open, attributed and private
 * rooms (Alberto, 11-18), never one whose tier is unknown (a custody-only room). The tiers are named at the call
 * (Room.tsx), never "not unknown": a denylist would start keeping any tier added later. And an attributed or private
 * room's copy goes as an open room's does: the emptyings never read a tier (messageCacheMatrix.test.ts has every
 * trigger).
 */
import { render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import {
  emptyGoneRooms,
  readRoomPosts,
  resetMessageCache,
  ROOMS_MESSAGE_CACHE,
  setMessageCacheBiometryGate,
  sweepMessageCache,
} from '../messageCache'
import { afterLeavingCommunity } from '../roomsLeave'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { RoomsService, RoomSummary } from '../types'
import { cacheWallet } from './fixtures/cacheWallet'

let mockService: RoomsService | undefined
const mockOptions: unknown[] = []
/** What the screen last asked of the feed. */
const last = () => mockOptions[mockOptions.length - 1]
const ROOM = 'did:webvh:sample:planning'
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => 100 }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useRoute: () => ({ params: { roomId: 'did:webvh:sample:planning' } }),
}))
// The real feed; only what the screen asks of it is noted.
jest.mock('../useRoomPosts', () => {
  const actual = jest.requireActual('../useRoomPosts')
  return {
    ...actual,
    useRoomPosts: (...args: unknown[]) => {
      mockOptions.push(args[6])
      return actual.useRoomPosts(...args)
    },
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Room = require('../screens/Room').default

/** The sample room, as a room of `tier`, on an agent with a wallet. */
function roomOfTier(tier: RoomSummary['tier']) {
  const sample = createSampleRoomsService()
  const wallet = cacheWallet()
  mockService = {
    ...sample,
    runsOn: wallet,
    getRoom: async (roomId: string) => ({ ...(await sample.getRoom(roomId)), tier }),
  } as RoomsService
  return { sample, wallet }
}
const show = () =>
  render(
    <BasicAppContext>
      <Room />
    </BasicAppContext>
  )
/** What the build ships (off on main, on in a cut that carries #1140): these rows run it on, and put it back. */
const SHIPPED = { ...ROOMS_MESSAGE_CACHE }
beforeEach(() => {
  mockOptions.length = 0
  setMessageCacheBiometryGate(async () => true)
  resetMessageCache()
  // These rows are about the cache at work: switched on, as a cut that carries it does.
  Object.assign(ROOMS_MESSAGE_CACHE, { on: true, remoteOff: false })
})
afterEach(() => {
  Object.assign(ROOMS_MESSAGE_CACHE, SHIPPED)
})

describe("the room screen's chat, by the room's tier", () => {
  it.each(['open', 'attributed', 'private'] as const)('%s: kept, by its community', async (tier) => {
    const { sample } = roomOfTier(tier)
    const room = await sample.getRoom(ROOM)
    show()
    // The screen asks for the copy before the room too (#1146): the hook's own rows pass the option themselves.
    await waitFor(() => expect(last()).toMatchObject({ seedBeforeRoom: true, messageCache: expect.anything() }))
    expect((last() as { messageCache: { communityDid: string } }).messageCache.communityDid).toBe(room.communityDid)
  })

  it.each(['unknown'] as const)('control: %s (custody-only): never kept', async (tier) => {
    const { wallet } = roomOfTier(tier)
    const tree = show()
    await waitFor(() => expect(tree.getAllByTestId(/RoomPost_/).length).toBeGreaterThan(0))
    expect((last() as { messageCache?: unknown }).messageCache).toBeUndefined()
    expect(last()).toMatchObject({ seedBeforeRoom: true })
    expect(mockOptions.every((o) => !(o as { messageCache?: unknown }).messageCache)).toBe(true)
    expect(wallet.genericRecords.save).not.toHaveBeenCalled()
    expect(wallet.genericRecords.findById).not.toHaveBeenCalled()
  })
})

describe.each(['attributed', 'private'] as const)("the %s room's copy", (tier) => {
  /** Opens the sample room as a room of `tier` and lets its posts be kept. */
  const kept = async () => {
    const { sample, wallet } = roomOfTier(tier)
    const room = await sample.getRoom(ROOM)
    show()
    await waitFor(() => expect(wallet.genericRecords.save).toHaveBeenCalled(), { timeout: 6000 })
    const copy = await readRoomPosts(wallet, room.actingAs.did, ROOM)
    expect(copy?.posts.length).toBeGreaterThan(0)
    return { wallet, room }
  }

  it('is kept, with only what the chat draws', async () => {
    const { wallet } = await kept()
    const fields = new Set(
      wallet.copies().flatMap((c) => ((c.posts as object[] | undefined) ?? []).flatMap((p) => Object.keys(p)))
    )
    for (const f of fields)
      expect([
        'key',
        'version',
        'kind',
        'author',
        'writtenAt',
        'body',
        'inReplyTo',
        'reactions',
        'verdict',
        'cut',
      ]).toContain(f)
  })

  it('goes when the member leaves its community', async () => {
    const { wallet, room } = await kept()
    await afterLeavingCommunity(wallet as never, room.communityDid!)
    expect(await readRoomPosts(wallet, room.actingAs.did, ROOM)).toBeUndefined()
    expect(wallet.copies().every((c) => c.emptied === true)).toBe(true)
  })

  it('goes when the room is listed as gone', async () => {
    const { wallet, room } = await kept()
    await emptyGoneRooms(wallet, [{ roomId: ROOM, standing: 'removed' }])
    expect(await readRoomPosts(wallet, room.actingAs.did, ROOM)).toBeUndefined()
  })

  it('goes at the next start once the release turns it off (the kill)', async () => {
    const { wallet, room } = await kept()
    ROOMS_MESSAGE_CACHE.remoteOff = true
    await sweepMessageCache(wallet, [{ communityDid: room.communityDid!, personaDid: room.actingAs.did }])
    ROOMS_MESSAGE_CACHE.remoteOff = false
    expect(await readRoomPosts(wallet, room.actingAs.did, ROOM)).toBeUndefined()
  })
})
