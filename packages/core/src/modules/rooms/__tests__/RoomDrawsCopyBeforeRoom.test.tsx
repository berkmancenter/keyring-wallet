/**
 * The room screen draws a room's kept posts before the room is known (useRoomPosts `seedBeforeRoom`): on 279.4 the
 * feed held them 135 ms after opening, and the log said "9 posts shown", while the screen still showed only its
 * spinner, until the first rooms listing answered 14 s after launch (YJPT-6WC8, Alberto's video). These rows mount the
 * screen and look for the posts ON it: the hook's own rows, and a check that the screen asks for the copy, all passed
 * against that build. The opening's log line is said only once the list has laid the posts out.
 *
 * And it draws the whole screen then, not the posts alone (281.2, Alberto's video of 11-24: ~3 s under a plain name,
 * with no header card, no composer and "Member …" for a sender): the header card from the room's row on Messages, the
 * senders' kept names, and the composer with Send held until the room is read. One list before the room and after.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { keepRoomPosts, resetMessageCache, ROOMS_MESSAGE_CACHE, setMessageCacheBiometryGate } from '../messageCache'
import { ROWS_AT_START_RECORD_ID } from '../rowsAtStart'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { Room as RoomOf, RoomsService } from '../types'
import { resetRoomRows, useRoomRowsPoll } from '../useRoomRows'
import { cacheWallet } from './fixtures/cacheWallet'

let mockService: RoomsService | undefined
// The member's own names for others, by community: none unless a test sets them, and none with no community to read by.
let mockNames = new Map<string, string>()
const mockNoNames = new Map<string, string>()
jest.mock('../usePetname', () => ({
  usePetname: () => ({ name: undefined, loaded: true, set: jest.fn() }),
  usePetnames: (communityDid?: string) => (communityDid ? mockNames : mockNoNames),
}))
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
/** Messages' poll, as the tab navigator runs it: the rows the room screen reads its header card from. */
const MessagesPoll: React.FC = () => {
  useRoomRowsPoll(mockService, true)
  return null
}

async function coldStart(options: { copyOf?: 'me' | 'someone else'; row?: boolean } = {}) {
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
  // The room's row as the last run kept it (rowsAtStart): shown by Messages until the first listing answers.
  if (options.row)
    await wallet.genericRecords.save({
      id: ROWS_AT_START_RECORD_ID,
      content: {
        v: 1,
        rows: [
          {
            key: ROOM,
            roomId: ROOM,
            roomName: 'Planning, as kept',
            nameFrom: 'community',
            communityDid: known.communityDid!,
            lastActivityAt: new Date(NOW - 60_000).toISOString(),
            tier: 'attributed',
            validUntil: '2027-02-01T00:00:00.000Z',
          },
        ],
      },
    })
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
    // The first rooms listing has not answered: Messages shows the last run's rows.
    listMyRooms: () => new Promise(() => undefined),
  } as RoomsService
  const tree = render(
    <BasicAppContext>
      <MessagesPoll />
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
  mockNames = new Map()
  resetRoomRows()
  setMessageCacheBiometryGate(async () => true)
  resetMessageCache()
  Object.assign(ROOMS_MESSAGE_CACHE, { on: true, remoteOff: false })
})
afterEach(() => {
  Object.assign(ROOMS_MESSAGE_CACHE, SHIPPED)
})

describe('a cold start, before the rooms listing answers', () => {
  test('the room screen shows its kept posts, marked from last time, and the composer with Send held', async () => {
    const { tree, arrive } = await coldStart()
    await waitFor(() => expect(tree.getByText('kept two')).toBeTruthy())
    expect(tree.getByText('kept one')).toBeTruthy()
    expect(tree.getByTestId(id('RoomFromLastTime'))).toBeTruthy()
    expect(tree.queryByTestId(id('RoomReading'))).toBeNull()
    expect(tree.getByTestId(id('RoomBeforeKnown'))).toBeTruthy()
    // The composer is in its place and takes the member's words; nothing is sent until the room is read.
    expect(tree.getByTestId(id('RoomComposer'))).toBeTruthy()
    fireEvent.changeText(tree.getByTestId(id('RoomComposerInput')), 'words typed early')
    expect(tree.getByTestId(id('RoomComposerSend')).props.accessibilityState).toEqual({ disabled: true })
    // Read-only meanwhile: no "+" to attach with, and the saved copy is never called a listing that stopped early.
    expect(tree.queryByTestId(id('RoomComposerAttach'))).toBeNull()
    expect(tree.queryByTestId(id('RoomPostsIncomplete'))).toBeNull()
    // Control: the room read, the same words can be sent.
    await arrive()
    await waitFor(() =>
      expect(tree.getByTestId(id('RoomComposerSend')).props.accessibilityState).toEqual({ disabled: false })
    )
    expect(tree.getByTestId(id('RoomComposerInput')).props.value).toBe('words typed early')
  })

  test("the header card is drawn at once from the room's row on Messages, and the senders' kept names", async () => {
    mockNames = new Map([['did:peer:them', 'Sam, as I call them']])
    const { tree, arrive } = await coldStart({ row: true })
    await waitFor(() => expect(tree.getByText('kept two')).toBeTruthy())
    await waitFor(() => expect(tree.getByTestId(id('RoomHeader'))).toBeTruthy())
    expect(tree.getByTestId(id('RoomBeforeKnown'))).toBeTruthy()
    expect(tree.getByTestId(id('RoomTitle'))).toHaveTextContent('Planning, as kept')
    expect(tree.getByTestId(id('RoomTier'))).toBeTruthy()
    expect(tree.getByTestId(id('RoomWhere'))).toBeTruthy()
    // The sender is named as the member names them, not "Member …" (the words a DID alone gets).
    expect(tree.getAllByText(/Rooms\.PetnameLabel/).length).toBeGreaterThan(0)
    expect(tree.queryByText(/Rooms\.MemberTail/)).toBeNull()
    // The room read: the card says what the room says, in the same place.
    await arrive()
    await waitFor(() => expect(tree.queryByTestId(id('RoomBeforeKnown'))).toBeNull())
    expect(tree.getByTestId(id('RoomTitle'))).not.toHaveTextContent('Planning, as kept')
  })

  test('control: with no row on Messages, no header card or kept name is drawn until the room is read', async () => {
    mockNames = new Map([['did:peer:them', 'Sam, as I call them']])
    const { tree, arrive } = await coldStart()
    await waitFor(() => expect(tree.getByText('kept two')).toBeTruthy())
    expect(tree.queryByTestId(id('RoomHeader'))).toBeNull()
    expect(tree.getAllByText(/Rooms\.MemberTail/).length).toBeGreaterThan(0)
    expect(tree.queryByText(/Rooms\.PetnameLabel/)).toBeNull()
    await arrive()
    await waitFor(() => expect(tree.getByTestId(id('RoomHeader'))).toBeTruthy())
    expect(tree.getAllByText(/Rooms\.PetnameLabel/).length).toBeGreaterThan(0)
  })

  test("with its row and nothing kept, the header card and composer are drawn over the posts' spinner", async () => {
    const { tree } = await coldStart({ row: true, copyOf: 'someone else' })
    await waitFor(() => expect(tree.getByTestId(id('RoomHeader'))).toBeTruthy())
    expect(tree.getByTestId(id('RoomPostsReading'))).toBeTruthy()
    expect(tree.getByTestId(id('RoomComposer'))).toBeTruthy()
    expect(tree.queryByTestId(id('RoomReading'))).toBeNull()
    expect(tree.queryByText('kept two')).toBeNull()
  })

  test('the opening is said once the list has laid the posts out, and not before', async () => {
    const { tree, opened } = await coldStart()
    await waitFor(() => expect(tree.getByText('kept two')).toBeTruthy())
    expect(opened()).toEqual([])
    fireEvent(tree.getByTestId(id('RoomPosts')), 'contentSizeChange', 320, 400)
    expect(opened()).toHaveLength(1)
    expect(opened()[0]).toMatch(/opened: 2 posts shown in \d+ ms \(wallet copy, before the room\)$/)
  })

  test('the room arriving keeps the same posts on screen, in the same list', async () => {
    const { tree, arrive } = await coldStart()
    await waitFor(() => expect(tree.getByText('kept two')).toBeTruthy())
    const list = tree.getByTestId(id('RoomPosts'))
    const post = tree.getByText('kept two')
    await arrive()
    await waitFor(() => expect(tree.queryByTestId(id('RoomBeforeKnown'))).toBeNull())
    expect(tree.getByText('kept two')).toBeTruthy()
    // Not a second list drawn in its place (until 282 it was, and every post with it): the one the member is looking at.
    expect(tree.getByTestId(id('RoomPosts'))).toBe(list)
    expect(tree.getByText('kept two')).toBe(post)
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
