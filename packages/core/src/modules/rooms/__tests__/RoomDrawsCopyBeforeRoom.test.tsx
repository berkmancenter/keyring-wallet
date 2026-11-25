/**
 * The room screen draws a room's kept posts before the room is known (useRoomPosts `seedBeforeRoom`): on 279.4 the
 * feed held them 135 ms after opening, and the log said "9 posts shown", while the screen still showed only its
 * spinner, until the first rooms listing answered 14 s after launch (YJPT-6WC8, Alberto's video). These rows mount the
 * screen and look for the posts ON it: the hook's own rows, and a check that the screen asks for the copy, all passed
 * against that build. The opening's log line is said only once the list has laid the posts out.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { keepRoomPosts, resetMessageCache, ROOMS_MESSAGE_CACHE, setMessageCacheBiometryGate } from '../messageCache'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { Room as RoomOf, RoomsService } from '../types'
import { cacheWallet } from './fixtures/cacheWallet'

let mockService: RoomsService | undefined
const ROOM = 'did:webvh:sample:planning'
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => 100 }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useRoute: () => ({ params: { roomId: 'did:webvh:sample:planning' } }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Room = require('../screens/Room').default

const id = (key: string) => testIdWithKey(key)
const NOW = Date.now()

/**
 * The sample room on an agent with a wallet holding its kept copy, whose room is not known until `arrive` (the first
 * rooms listing, at a cold start) and whose own listing never answers here.
 */
async function coldStart(options: { copyOf?: 'me' | 'someone else' } = {}) {
  const sample = createSampleRoomsService()
  const known = await sample.getRoom(ROOM)
  const wallet = cacheWallet()
  const lines: string[] = []
  await keepRoomPosts(
    wallet,
    {
      personaDid: options.copyOf === 'someone else' ? 'did:peer:2.someone-else' : known.actingAs.did,
      roomId: ROOM,
      communityDid: known.communityDid!,
    },
    [
      {
        key: 'k1',
        version: 1,
        author: 'did:peer:them',
        writtenAt: new Date(NOW - 120_000).toISOString(),
        body: 'kept one',
      },
      {
        key: 'k2',
        version: 2,
        author: 'did:peer:them',
        writtenAt: new Date(NOW - 60_000).toISOString(),
        body: 'kept two',
      },
    ],
    NOW
  )
  let arrive: (room: RoomOf) => void = () => undefined
  let refuse: (e: Error) => void = () => undefined
  const roomKnown = new Promise<RoomOf>((resolve, reject) => {
    arrive = resolve
    refuse = reject
  })
  roomKnown.catch(() => undefined)
  mockService = {
    ...sample,
    runsOn: wallet,
    note: (line: string) => void lines.push(line),
    localCommunities: async () => [{ did: known.communityDid!, personaDid: known.actingAs.did }],
    getRoom: () => roomKnown,
    roomCapabilities: async (roomId: string) => {
      await roomKnown
      return sample.roomCapabilities(roomId)
    },
    listNotes: () => new Promise(() => undefined),
  } as RoomsService
  const tree = render(
    <BasicAppContext>
      <Room />
    </BasicAppContext>
  )
  const opened = () => lines.filter((line) => line.startsWith('[Room] '))
  return {
    tree,
    opened,
    arrive: (actingAs = known.actingAs) => act(async () => arrive({ ...known, actingAs })),
    refuse: () => act(async () => refuse(new Error(`no room ${ROOM} among this member's rooms`))),
  }
}

const SHIPPED = { ...ROOMS_MESSAGE_CACHE }
beforeEach(() => {
  setMessageCacheBiometryGate(async () => true)
  resetMessageCache()
  Object.assign(ROOMS_MESSAGE_CACHE, { on: true, remoteOff: false })
})
afterEach(() => {
  Object.assign(ROOMS_MESSAGE_CACHE, SHIPPED)
})

describe('a cold start, before the rooms listing answers', () => {
  test('the room screen shows its kept posts, marked from last time, with nothing to post from', async () => {
    const { tree } = await coldStart()
    await waitFor(() => expect(tree.getByText('kept two')).toBeTruthy())
    expect(tree.getByText('kept one')).toBeTruthy()
    expect(tree.getByTestId(id('RoomFromLastTime'))).toBeTruthy()
    expect(tree.queryByTestId(id('RoomReading'))).toBeNull()
    // Nothing can be posted until the room is known: no composer.
    expect(tree.queryByTestId(id('RoomComposer'))).toBeNull()
  })

  test('the opening is said once the list has laid the posts out, and not before', async () => {
    const { tree, opened } = await coldStart()
    await waitFor(() => expect(tree.getByText('kept two')).toBeTruthy())
    expect(opened()).toEqual([])
    fireEvent(tree.getByTestId(id('RoomPosts')), 'contentSizeChange', 320, 400)
    expect(opened()).toHaveLength(1)
    expect(opened()[0]).toMatch(/opened: 2 posts shown in \d+ ms \(wallet copy, before the room\)$/)
  })

  test('the room arriving keeps the same posts on screen', async () => {
    const { tree, arrive } = await coldStart()
    await waitFor(() => expect(tree.getByText('kept two')).toBeTruthy())
    await arrive()
    await waitFor(() => expect(tree.queryByTestId(id('RoomBeforeKnown'))).toBeNull())
    expect(tree.getByText('kept two')).toBeTruthy()
  })

  // The takedown, on the screen: posts drawn and then found not to be this screen's go from it, not only from the feed.
  test('the room arriving as another identity takes the posts off the screen at once', async () => {
    const { tree, arrive } = await coldStart()
    await waitFor(() => expect(tree.getByText('kept two')).toBeTruthy())
    await arrive({ did: 'did:peer:2.another-identity' })
    await waitFor(() => expect(tree.queryByText('kept two')).toBeNull())
    expect(tree.queryByText('kept one')).toBeNull()
  })

  test('the room not readable takes the posts off the screen', async () => {
    const { tree, refuse } = await coldStart()
    await waitFor(() => expect(tree.getByText('kept two')).toBeTruthy())
    await refuse()
    await waitFor(() => expect(tree.queryByText('kept two')).toBeNull())
    expect(tree.queryByTestId(id('RoomBeforeKnown'))).toBeNull()
  })

  test("control: another identity's copy draws nothing; the screen waits as before", async () => {
    const { tree } = await coldStart({ copyOf: 'someone else' })
    await waitFor(() => expect(tree.getByTestId(id('RoomReading'))).toBeTruthy())
    await act(async () => undefined)
    expect(tree.queryByText('kept two')).toBeNull()
  })
})
