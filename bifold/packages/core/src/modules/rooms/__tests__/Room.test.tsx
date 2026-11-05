/**
 * A room as a conversation (R3, RoomView): newest at the bottom, as the person-to-person chat, with a day pill above
 * each day's posts and "Load older" at the top; pull to refresh while there are no posts; a chat message shows its text and anything else shows as written, inert; an unreadable post holds its
 * place; the host check warns only on `conflict`; a custody-only room is never asked for posts.
 */
import { useNavigation } from '@react-navigation/native'
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native'
import React from 'react'
import { FlatList, ScrollView } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { deriveRoomCapabilities, sampleCapabilities } from '../capabilities'
import { toInertText } from '../inertText'
import { roomHandle } from '../components/RoomRow'
import { POSTS_PAGE } from '../useRoomPosts'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { HostCheck, Note, NoteList, Room as RoomRecord, RoomsService } from '../types'

let mockService: RoomsService | undefined
let mockParams: Record<string, string> | undefined
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => 100 }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useRoute: () => ({ params: mockParams }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Room = require('../screens/Room').default
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withDayPills } = require('../screens/Room')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RoomsHome = require('../screens/RoomsHome').default

const id = (key: string) => testIdWithKey(key)
/**
 * How long a page drawn in rounds may take on a busy CI runner: past the 3 s every wait has here (jestSetupAfterEnv),
 * inside jest's 12 s testTimeout with room for the reads after it.
 */
const PAGE_DRAWN_MS = 8_000
const show = (Screen: React.FC = Room) =>
  render(
    <BasicAppContext>
      <Screen />
    </BasicAppContext>
  )

const PLANNING = 'did:webvh:sample:planning'
const CUSTODY = 'did:webvh:sample:3f9a7c21e0'
const ME = { did: 'did:peer:2.me-1234567890', identityWords: 'negative-weird' }
// A ULID dated 2023-12-31: inside the chat parser's clock window whatever the run's date.
const EVENT_ID = '01HJYJQ6008Q2W4E5R6T7Y8Z9V'

const post = (key: string, body: string, over: Partial<Note> = {}): Note => ({
  key,
  version: 1,
  status: 'active',
  pinned: false,
  updatedAt: '2026-10-26T09:00:00Z',
  author: { did: 'did:peer:them', identityWords: 'term-benefit' },
  body: toInertText(body),
  flags: { containsLink: false, looksLikeInstruction: false },
  check: { verdict: 'consistent', detail: '' },
  ...over,
})

/** A service whose one room is open to the member, with these posts (or a listing that fails). */
const withPosts = (posts: Note[] | Error, list: Partial<NoteList> = {}, unreadable: string[] = []) => {
  const room: RoomRecord = {
    roomId: 'did:webvh:r:one',
    name: toInertText('One'),
    nameFrom: 'community',
    source: 'community',
    communityDid: 'did:webvh:c',
    communityName: toInertText('C'),
    tier: 'open',
    verbs: ['read'],
    standing: 'member',
    actingAs: ME,
  }
  const service = {
    isSample: false,
    capabilities: async () => sampleCapabilities(),
    getRoom: async () => room,
    roomCapabilities: async () => deriveRoomCapabilities(sampleCapabilities(), room),
    listNotes: jest.fn(async () => {
      if (posts instanceof Error) throw posts
      const notes = posts.map(
        ({ body: _b, flags: _f, check: _c, kind: _k, inReplyTo: _r, writtenAt: _w, editedAt: _e, ...summary }) =>
          summary
      )
      return { notes, complete: true, check: { verdict: 'consistent', detail: '' }, ...list }
    }),
    readNote: async (_roomId: string, key: string) => {
      if (unreadable.includes(key) || posts instanceof Error) throw new Error('unreadable')
      const found = posts.find((p) => p.key === key)
      if (!found) throw new Error('no such post')
      return found
    },
    listFiles: async () => [],
  }
  return service as unknown as RoomsService & { listNotes: jest.Mock }
}
const open = (service: RoomsService, roomId = 'did:webvh:r:one') => {
  mockService = service
  mockParams = { roomId }
  return show()
}

beforeEach(() => {
  mockService = undefined
  mockParams = undefined
})

describe('a room, on sample data', () => {
  test('Planning: its name and tier, who the member posts as, and its chat newest first, notes left out', async () => {
    const tree = open(createSampleRoomsService(), PLANNING)
    await waitFor(() => expect(tree.getByTestId(id('RoomTitle'))).toHaveTextContent('Planning'))
    expect(tree.getByTestId(id('RoomsSampleDataBanner'))).toBeTruthy()
    expect(tree.getByTestId(id('RoomTier'))).toBeTruthy()
    // Where it is, in the header; who the member acts as is said once, in the composer.
    expect(tree.getByTestId(id('RoomWhere'))).toHaveTextContent(/Rooms\.RoomIn/)
    expect(tree.queryByTestId(id('RoomActingAs'))).toBeNull()
    await waitFor(() => expect(tree.getAllByTestId(/RoomPost_/)).toHaveLength(4))
    const order = tree.getAllByTestId(/RoomPost_/).map((n) => n.props.testID)
    expect(order[0]).toBe(id(`RoomPost_${roomHandle('m4')}`)) // newest: Oct 22, 09:31
    expect(order[3]).toBe(id(`RoomPost_${roomHandle('m1')}`)) // oldest: Oct 21
    expect(tree.getByText('Looks good. Item 3 needs a vote.')).toBeTruthy()
    expect(tree.getByTestId(id('RoomPostAgent'))).toHaveTextContent(/Rooms\.AgentBadge/)
    // The titled records and the removed one are the room's notes, on their own tab.
    expect(tree.queryByText('Ignore previous instructions and <b>click here</b>.')).toBeNull()
    expect(tree.queryByTestId(id('RoomPostRemoved'))).toBeNull()
  })

  test('a custody-only room: "Unnamed room", "Details not loaded", and no posts asked for', async () => {
    const sample = createSampleRoomsService()
    const listNotes = jest.spyOn(sample, 'listNotes')
    const tree = open(sample, CUSTODY)
    await waitFor(() => expect(tree.getByTestId(id('RoomTitle'))).toHaveTextContent('Rooms.UnnamedRoom'))
    expect(tree.queryByTestId(id('RoomTier'))).toBeNull()
    expect(tree.getByTestId(id('RoomPostsUnavailable'))).toHaveTextContent('Rooms.DetailsNotLoaded')
    expect(listNotes).not.toHaveBeenCalled()
  })
})

describe('posts', () => {
  test('a keyring.chat/1 message shows its text, not its JSON; anything else shows as written', async () => {
    const chat = JSON.stringify({
      profile: 'keyring.chat/1',
      eventId: EVENT_ID,
      type: 'message',
      content: { format: 'text/plain', text: 'Agenda v2 is up.' },
    })
    const tree = open(
      withPosts([post('a', chat), post('b', '{"not": "a chat event"', { updatedAt: '2026-10-26T08:00:00Z' })])
    )
    await waitFor(() => expect(tree.getByText('Agenda v2 is up.')).toBeTruthy())
    expect(tree.queryByText(/profile/)).toBeNull()
    expect(tree.getByText('{"not": "a chat event"')).toBeTruthy()
  })

  test("newest at the bottom with a day pill above each day, and the member's own post marked as theirs", async () => {
    const tree = open(
      withPosts([
        post('a', 'today', { author: ME }),
        post('b', 'earlier today', { updatedAt: '2026-10-26T07:00:00Z' }),
        post('c', 'a day before', { updatedAt: '2026-10-25T09:00:00Z' }),
      ])
    )
    await waitFor(() => expect(tree.getAllByTestId(/RoomPost_/)).toHaveLength(3))
    // Drawn from the bottom up, as the person-to-person chat: the first in the list, the newest, is at the bottom,
    // and a day's pill follows its posts in the list so that it shows above them.
    expect(tree.getByTestId(id('RoomPosts')).props.inverted).toBe(true)
    const drawn = tree.getAllByTestId(/RoomPost_|ChatDayPill/).map((n) => n.props.testID.replace(/^.*\//, ''))
    expect(drawn).toEqual([
      `RoomPost_${roomHandle('a')}`,
      `RoomPost_${roomHandle('b')}`,
      'ChatDayPill',
      `RoomPost_${roomHandle('c')}`,
      'ChatDayPill',
    ])
    expect(tree.getByText('Rooms.You')).toBeTruthy()
  })

  test('scrolling floats the day of the posts at the top of the screen, as the person-to-person chat does', async () => {
    const tree = open(withPosts([post('a', 'today'), post('c', 'a day before', { updatedAt: '2026-10-25T09:00:00Z' })]))
    await waitFor(() => expect(tree.getAllByTestId(/RoomPost_/)).toHaveLength(2))
    expect(tree.queryByTestId(id('RoomFloatingDay'))).toBeNull()
    const chat = tree.UNSAFE_getAllByType(FlatList).find((l) => l.props.testID === id('RoomPosts'))
    if (!chat) throw new Error('no chat list')
    const viewableItems = (chat.props.data as { key: string }[]).map((item, index) => ({
      item,
      index,
      key: item.key,
      isViewable: true,
    }))
    await act(async () => {
      chat.props.onViewableItemsChanged({ viewableItems, changed: [] })
      chat.props.onScrollBeginDrag()
    })
    // The topmost post in view (the highest index, drawn bottom up) is the older one: its day floats.
    expect(within(tree.getByTestId(id('RoomFloatingDay'))).getByTestId(id('ChatDayPill'))).toBeTruthy()
  })

  test("a post that couldn't be read keeps its place, and the rest show", async () => {
    const tree = open(
      withPosts([post('a', 'readable'), post('b', 'hidden', { updatedAt: '2026-10-26T08:00:00Z' })], {}, ['b'])
    )
    await waitFor(() => expect(tree.getByText('readable')).toBeTruthy())
    expect(tree.getByTestId(id('RoomPostUnread'))).toBeTruthy()
    expect(tree.queryByText('hidden')).toBeNull()
  })

  // 276.9: a reopened room drew 8 posts and stopped: notes among its newest records took places in the page.
  test(`notes among the newest records leave the chat its ${POSTS_PAGE} posts, with no scroll`, async () => {
    const at = (i: number) => new Date(Date.UTC(2026, 9, 26, 9, 0, 0) - i * 60_000).toISOString()
    const records = Array.from({ length: POSTS_PAGE + 4 }, (_, i) =>
      i === 1 || i === 4
        ? post(`note${i}`, `note body ${i}`, { updatedAt: at(i), title: toInertText(`Note ${i}`) })
        : post(`p${i}`, `chat ${i}`, { updatedAt: at(i) })
    )
    const tree = open(withPosts(records))
    const chat = records.filter((r) => !r.title).slice(0, POSTS_PAGE)
    // The page is drawn in two rounds: its first ten records hold two notes, so eight posts show, then the shortfall
    // is read and the last two land. Waiting on a count can run out between the rounds on a busy runner and see 8
    // (FLAKY-ROOM-10-POSTS, twice on 11-02), so the wait is on the tenth post itself, with room for a slow round.
    await tree.findByTestId(id(`RoomPost_${roomHandle(chat[POSTS_PAGE - 1].key)}`), {}, { timeout: PAGE_DRAWN_MS })
    expect(tree.getAllByTestId(/RoomPost_/)).toHaveLength(POSTS_PAGE)
    for (const r of chat) expect(tree.getByText(String(r.body))).toBeTruthy()
    expect(tree.queryByText('note body 1')).toBeNull()
  })

  test(`${POSTS_PAGE} at a time: scrolling up to the oldest post reads the next page, with the spinner and no button`, async () => {
    const many = Array.from({ length: POSTS_PAGE + 1 }, (_, i) =>
      post(`p${i}`, `post ${i}`, { updatedAt: new Date(Date.UTC(2026, 9, 26, 9, 0, 0) - i * 60_000).toISOString() })
    )
    const service = withPosts(many)
    // The older post's read waits until the test lets it answer, so the spinner can be seen.
    let answer: () => void = () => undefined
    const answered = new Promise<void>((resolve) => (answer = resolve))
    const readNote = service.readNote.bind(service)
    jest.spyOn(service, 'readNote').mockImplementation(async (roomId: string, key: string) => {
      if (key === `p${POSTS_PAGE}`) await answered
      return readNote(roomId, key)
    })
    const tree = open(service)
    // On the tenth post itself, as the page above: a count can run out on a busy runner (FLAKY-ROOM-10-POSTS).
    await tree.findByTestId(id(`RoomPost_${roomHandle(`p${POSTS_PAGE - 1}`)}`), {}, { timeout: PAGE_DRAWN_MS })
    expect(tree.getAllByTestId(/RoomPost_/)).toHaveLength(POSTS_PAGE)
    expect(tree.queryByText(`post ${POSTS_PAGE}`)).toBeNull()
    expect(tree.queryByText('Rooms.LoadOlder')).toBeNull()
    // Drawn bottom up, the list's end is its top: reaching it reads the next page.
    const list = tree.getByTestId(id('RoomPosts'))
    expect(list.props.inverted).toBe(true)
    await act(async () => list.props.onEndReached({ distanceFromEnd: 0 }))
    expect(tree.getByTestId(id('RoomPosts')).props.ListFooterComponent.props.testID).toBe(id('RoomLoadingOlder'))
    await act(async () => answer())
    await waitFor(() => expect(tree.getByText(`post ${POSTS_PAGE}`)).toBeTruthy())
    // Everything is shown: nothing more to read, and no spinner.
    expect(tree.getByTestId(id('RoomPosts')).props.onEndReached).toBeUndefined()
    expect(tree.queryByTestId(id('RoomLoadingOlder'))).toBeNull()
  })

  test('with no posts yet, pulling down reads the room again, and a new post appears', async () => {
    const posts: Note[] = []
    const service = withPosts(posts)
    const tree = open(service)
    await waitFor(() => expect(tree.getByTestId(id('RoomPostsNone'))).toBeTruthy())
    // An empty list reads from the top, so its message is where the eye starts.
    expect(tree.getByTestId(id('RoomPosts')).props.inverted).toBe(false)
    const before = service.listNotes.mock.calls.length
    posts.push(post('b', 'arrived later', { updatedAt: '2026-10-26T10:00:00Z' }))
    await act(async () => tree.getByTestId(id('RoomPosts')).props.refreshControl.props.onRefresh())
    await waitFor(() => expect(tree.getByText('arrived later')).toBeTruthy())
    expect(service.listNotes).toHaveBeenCalledTimes(before + 1)
  })

  test('with posts shown there is no pull to refresh: drawn bottom up it would sit at the bottom', async () => {
    const tree = open(withPosts([post('a', 'first')]))
    await waitFor(() => expect(tree.getByText('first')).toBeTruthy())
    expect(tree.getByTestId(id('RoomPosts')).props.refreshControl).toBeUndefined()
  })

  test('no posts yet: says so', async () => {
    const tree = open(withPosts([]))
    await waitFor(() => expect(tree.getByTestId(id('RoomPostsNone'))).toBeTruthy())
  })
})

describe('withDayPills, for a list drawn from the bottom up', () => {
  const at = (iso?: string) => ({ key: iso ?? 'none', version: 1, at: iso ? new Date(iso) : undefined })
  const shape = (posts: ReturnType<typeof at>[]) =>
    withDayPills(posts).map((i: { kind: string; key: string; post?: { key: string } }) =>
      i.kind === 'day' ? i.key : i.post?.key
    )

  test("each day's pill comes after its posts, the oldest day's last", () => {
    expect(shape([at('2026-10-26T10:00:00'), at('2026-10-26T08:00:00'), at('2026-10-25T09:00:00')])).toEqual([
      '2026-10-26T10:00:00',
      '2026-10-26T08:00:00',
      'day-2026-10-26',
      '2026-10-25T09:00:00',
      'day-2026-10-25',
    ])
  })

  test('a post with no time takes no pill and stays among its neighbours', () => {
    expect(shape([at('2026-10-26T10:00:00'), at(), at('2026-10-25T09:00:00')])).toEqual([
      '2026-10-26T10:00:00',
      'none',
      'day-2026-10-26',
      '2026-10-25T09:00:00',
      'day-2026-10-25',
    ])
    expect(shape([at()])).toEqual(['none'])
    expect(shape([])).toEqual([])
  })
})

describe('a chat with messages says a note is there, in one line', () => {
  const note = (key: string, title: string, over: Partial<Note> = {}) =>
    post(key, 'First record in a VTC data room', { title: toInertText(title), ...over })
  const at = (hour: number) => `2026-11-03T${String(hour).padStart(2, '0')}:00:00Z`
  // The chat's order: the list is drawn bottom up, so its data is newest first.
  const inOrder = (tree: ReturnType<typeof open>) =>
    (tree.UNSAFE_getByType(FlatList).props.data as { kind: string; post?: { key: string } }[])
      .filter((item) => item.kind !== 'day')
      .map((item) => item.post?.key)

  test('at its time among the messages, its title shown, and a tap opens the Notes', async () => {
    const navigate = useNavigation().navigate as jest.Mock
    navigate.mockClear()
    const tree = open(
      withPosts([
        post('m1', 'Before', { updatedAt: at(9), version: 1 }),
        note('n1', 'Onboarding decisions', { updatedAt: at(10), version: 2 }),
        post('m2', 'After', { updatedAt: at(11), version: 3 }),
      ])
    )
    await waitFor(() => expect(tree.getByTestId(id('RoomNoteMarker'))).toBeTruthy())
    expect(inOrder(tree)).toEqual(['m2', 'n1', 'm1'])
    const words = tree.getByTestId(id('RoomNoteMarkerWords'))
    expect(words).toHaveTextContent('Rooms.NoteMarker Onboarding decisions')
    expect(tree.getByTestId(id('RoomNoteMarkerOpen'))).toHaveTextContent('Rooms.NoteMarkerOpen')
    fireEvent.press(tree.getByTestId(id('RoomNoteMarker')))
    expect(navigate).toHaveBeenCalledWith(Screens.RoomPart, { roomId: 'did:webvh:r:one', part: 'notes' })
  })

  test("its words say nothing of a body, an edit or a count: a version is the room's, not the note's", async () => {
    // A note first written at a high version, as a room's first note was at 3 (IN-459).
    const tree = open(
      withPosts([post('m1', 'Hi all'), note('n1', 'Agenda', { version: 13, body: toInertText('Secret words') })])
    )
    await waitFor(() => expect(tree.getByTestId(id('RoomNoteMarker'))).toBeTruthy())
    expect(tree.getByTestId(id('RoomNoteMarkerWords'))).toHaveTextContent('Rooms.NoteMarker Agenda')
    expect(tree.queryByText(/Secret words/)).toBeNull()
  })

  test('two notes, two lines; a removed note none (control)', async () => {
    const tree = open(
      withPosts([
        post('m1', 'Hi all'),
        note('n1', 'One'),
        note('n2', 'Two'),
        note('n3', 'Gone', { status: 'retracted' }),
      ])
    )
    await waitFor(() => expect(tree.getAllByTestId(id('RoomNoteMarker'))).toHaveLength(2))
    expect(tree.queryByText(/Gone/)).toBeNull()
  })

  test('with no messages, the card and no line (control)', async () => {
    const tree = open(withPosts([note('n1', 'Hello World')]))
    await waitFor(() => expect(tree.getByTestId(id('RoomNotesWaiting'))).toBeTruthy())
    expect(tree.queryByTestId(id('RoomNoteMarker'))).toBeNull()
  })

  test('a record with no title stays a message (control)', async () => {
    const tree = open(withPosts([post('m1', 'Hi all'), post('m2', 'No title here')]))
    await waitFor(() => expect(tree.getByText('No title here')).toBeTruthy())
    expect(tree.queryByTestId(id('RoomNoteMarker'))).toBeNull()
  })
})

describe('a record that says what it is (trust-tasks-tf #1027)', () => {
  const reaction = (key: string, target = 'm1') => post(key, '👍', { kind: 'reaction', inReplyTo: { key: target } })

  test('a reaction shows in the chat nowhere, as neither a message nor a note', async () => {
    const tree = open(withPosts([post('m1', 'Hi all'), reaction('r1')]))
    await waitFor(() => expect(tree.getByText('Hi all')).toBeTruthy())
    expect(tree.queryByText('👍')).toBeNull()
    expect(tree.queryByTestId(id('RoomNoteMarker'))).toBeNull()
  })

  test('a room holding only reactions reads as having no messages, and no notes', async () => {
    const tree = open(withPosts([reaction('r1'), reaction('r2')]))
    await waitFor(() => expect(tree.getByTestId(id('RoomPostsNone'))).toBeTruthy())
    expect(tree.queryByTestId(id('RoomNotesWaiting'))).toBeNull()
  })

  test('a page is still its posts: reactions do not use it up', async () => {
    const chat = Array.from({ length: POSTS_PAGE + 2 }, (_, i) => post(`m${i}`, `Message ${i}`))
    const reactions = Array.from({ length: POSTS_PAGE }, (_, i) => reaction(`r${i}`))
    const tree = open(withPosts([...reactions, ...chat]))
    await waitFor(
      () => {
        const drawn = (tree.UNSAFE_getByType(FlatList).props.data as { kind: string }[]).filter(
          (i) => i.kind === 'post'
        )
        expect(drawn).toHaveLength(POSTS_PAGE)
      },
      { timeout: PAGE_DRAWN_MS }
    )
  })

  test('a withdrawn message shows nowhere', async () => {
    const tree = open(withPosts([post('m1', 'Hi all'), post('m2', '', { kind: 'message' })]))
    await waitFor(() => expect(tree.getByText('Hi all')).toBeTruthy())
    const drawn = (tree.UNSAFE_getByType(FlatList).props.data as { kind: string; post?: { key: string } }[]).filter(
      (i) => i.kind === 'post'
    )
    expect(drawn.map((i) => i.post?.key)).toEqual(['m1'])
  })

  test('a kind it does not know is a note, and never refused', async () => {
    const tree = open(
      withPosts([post('m1', 'Hi all'), post('n1', 'Words', { kind: 'poll', title: toInertText('A poll') })])
    )
    await waitFor(() => expect(tree.getByTestId(id('RoomNoteMarkerWords'))).toHaveTextContent(/A poll/))
    expect(tree.queryByText('Words')).toBeNull()
  })

  test('a titled message on an open room, which the listing shows by its title, reaches Notes and is never lost', async () => {
    const service = withPosts([
      post('m1', 'Hi all'),
      post('m2', 'Titled', { kind: 'message', title: toInertText('Named') }),
    ])
    const tree = open(service)
    await waitFor(() => expect(tree.getByTestId(id('RoomNoteMarkerWords'))).toHaveTextContent(/Named/))
    // The real `leftOut` path: the listing's title kept it from being read for the chat, so its words aren't there.
    expect(tree.queryByText('Titled')).toBeNull()
  })

  test('a record answering a reaction shows nowhere; one answering a message shows (control)', async () => {
    const tree = open(
      withPosts([
        post('m1', 'Hi all'),
        reaction('r1'),
        post('m2', 'To the reaction', { kind: 'message', inReplyTo: { key: 'r1' } }),
        post('m3', 'To the message', { kind: 'message', inReplyTo: { key: 'm1' } }),
      ])
    )
    await waitFor(() => expect(tree.getByText('To the message')).toBeTruthy())
    expect(tree.queryByText('To the reaction')).toBeNull()
  })
})

describe("the host's answer", () => {
  test.each<[HostCheck['verdict'], boolean]>([
    ['conflict', true],
    ['unverified', false],
    ['consistent', false],
  ])('%s: warning shown = %s', async (verdict, warned) => {
    const tree = open(withPosts([], { check: { verdict, detail: 'test' } }))
    await waitFor(() => expect(tree.getByTestId(id('RoomPostsNone'))).toBeTruthy())
    expect(!!tree.queryByTestId(id('RoomHostConflict'))).toBe(warned)
  })

  test('a list the host stopped early says some posts may be missing', async () => {
    const tree = open(withPosts([post('a', 'x')], { complete: false }))
    await waitFor(() => expect(tree.getByTestId(id('RoomPostsIncomplete'))).toBeTruthy())
  })

  test("posts that couldn't be listed say so, and the room still shows", async () => {
    const tree = open(withPosts(new Error('host down')))
    await waitFor(() => expect(tree.getByTestId(id('RoomPostsFailed'))).toBeTruthy())
    expect(tree.getByTestId(id('RoomTitle'))).toHaveTextContent('One')
  })
})

describe('reaching a room', () => {
  test("a room that couldn't be read says so and offers to try again", async () => {
    let fail = true
    const service = withPosts([])
    const getRoom = service.getRoom
    service.getRoom = async (roomId: string) => {
      if (fail) throw new Error('down')
      return getRoom(roomId)
    }
    const tree = open(service)
    await waitFor(() => expect(tree.getByTestId(id('RoomReadFailed'))).toBeTruthy())
    fail = false
    fireEvent.press(tree.getByTestId(id('RoomTryAgain')))
    await waitFor(() => expect(tree.getByTestId(id('RoomTitle'))).toHaveTextContent('One'))
  })

  test('rooms flag off: says so, and nothing is read (no service)', () => {
    mockParams = { roomId: PLANNING }
    const tree = show()
    expect(tree.getByTestId(id('RoomsOff'))).toBeTruthy()
    expect(tree.queryByTestId(id('RoomReading'))).toBeNull()
  })

  test('Rooms opens a room by its ID', async () => {
    mockService = createSampleRoomsService()
    const navigate = useNavigation().navigate as jest.Mock
    navigate.mockClear()
    const tree = show(RoomsHome)
    await waitFor(() => expect(tree.getByText('Planning')).toBeTruthy())
    fireEvent.press(tree.getByTestId(id(`RoomRow_${roomHandle(PLANNING)}`)))
    expect(navigate).toHaveBeenCalledWith(Screens.Room, { roomId: PLANNING })
  })
})

// 34VR-Y58H (277.8, 11-03): re-invited to the community, not to the room. Its posts, notes and files said "Couldn't
// read… Try again later" for ever; the room now says he is not in it yet, and how to get in.
describe('a room not joined yet', () => {
  const notJoined = (offers: { offerId: string; roomId: string }[]) => {
    const service = withPosts([])
    const getRoom = service.getRoom.bind(service)
    service.getRoom = async (roomId: string) => ({ ...(await getRoom(roomId)), tier: 'attributed', joined: false })
    ;(service as unknown as { listOffers: jest.Mock }).listOffers = jest.fn(async () => offers)
    return service
  }

  test('says so in place of the posts and the composer, with no Try again', async () => {
    const tree = open(notJoined([]))
    await waitFor(() => expect(tree.getByTestId(id('RoomNotJoined'))).toHaveTextContent(/Rooms\.NotJoinedTitle/))
    expect(tree.getByTestId(id('RoomNotJoined'))).toHaveTextContent(/Rooms\.NotJoinedBody/)
    expect(tree.queryByTestId(id('RoomComposerInput'))).toBeNull()
    expect(tree.queryByTestId(id('RoomPostsFailed'))).toBeNull()
    expect(tree.queryByText('Rooms.TryAgain')).toBeNull()
    expect(tree.queryByTestId(id('RoomNotJoinedOffer'))).toBeNull()
  })

  // At the largest text the words and the button run past the screen. A render found it: nothing asserted that it fits.
  test('its words and its button scroll, at any text size', async () => {
    const tree = open(notJoined([]))
    await waitFor(() => expect(tree.getByTestId(id('RoomNotJoined'))).toBeTruthy())
    expect(within(tree.UNSAFE_getByType(ScrollView)).getByTestId(id('RoomNotJoined'))).toBeTruthy()
  })

  test('offers the way to an offer for the room when one is waiting, and only then', async () => {
    const navigate = useNavigation().navigate as jest.Mock
    navigate.mockClear()
    const tree = open(
      notJoined([
        { offerId: 'other', roomId: 'x' },
        { offerId: 'offer-1', roomId: 'did:webvh:r:one' },
      ])
    )
    const button = await waitFor(() => tree.getByTestId(id('RoomNotJoinedOffer')))
    fireEvent.press(button)
    expect(navigate).toHaveBeenCalledWith(Screens.RoomOffer, { offerRef: 'offer-1' })
  })

  test('no button for an offer of another room (control)', async () => {
    const service = notJoined([{ offerId: 'other', roomId: 'x' }])
    const tree = open(service)
    await waitFor(() => expect(tree.getByTestId(id('RoomNotJoined'))).toBeTruthy())
    await waitFor(() => expect((service as unknown as { listOffers: jest.Mock }).listOffers).toHaveBeenCalled())
    await act(async () => undefined)
    expect(tree.queryByTestId(id('RoomNotJoinedOffer'))).toBeNull()
  })

  // Its notes and files can't be read either; they said "Couldn't read… Try again later".
  test.each(['notes', 'files'])('its %s say so too, with no Try again', async (part) => {
    mockService = notJoined([])
    mockParams = { roomId: 'did:webvh:r:one', part }
    const tree = show(require('../screens/RoomPart').default)
    await waitFor(() => expect(tree.getByTestId(id('RoomNotJoined'))).toBeTruthy())
    expect(tree.queryByText('Rooms.NotesFailed')).toBeNull()
    expect(tree.queryByText('Rooms.TryAgain')).toBeNull()
  })

  test('a joined room has its composer and no such card (control)', async () => {
    const tree = open(withPosts([]))
    await waitFor(() => expect(tree.getByTestId(id('RoomPostsNone'))).toBeTruthy())
    expect(tree.queryByTestId(id('RoomNotJoined'))).toBeNull()
  })
})

// IN-434 (277.7, 11-03): a note written from the community's web page lives on the room's Notes, never in its chat, and
// the room itself said only "No posts yet": the tester restarted the app several times looking for it.
describe('an empty chat says what notes the room holds', () => {
  const note = (key: string, title: string, over: Partial<Note> = {}) =>
    post(key, 'First record in a VTC data room', { title: toInertText(title), ...over })

  test('one note: counted, the newest named, and a tap opens the Notes', async () => {
    const navigate = useNavigation().navigate as jest.Mock
    navigate.mockClear()
    const tree = open(withPosts([note('n1', 'Hello World')]))
    await waitFor(() => expect(tree.getByTestId(id('RoomPostsNone'))).toHaveTextContent('Rooms.PostsNone'))
    const card = tree.getByTestId(id('RoomNotesWaiting'))
    expect(card).toHaveTextContent(/Rooms\.NotesWaiting/)
    expect(tree.getByTestId(id('RoomNotesWaitingNewest'))).toHaveTextContent('Hello World')
    fireEvent.press(card)
    expect(navigate).toHaveBeenCalledWith(Screens.RoomPart, { roomId: 'did:webvh:r:one', part: 'notes' })
  })

  test('the newest of several is the one named', async () => {
    const tree = open(
      withPosts([
        note('n1', 'Older', { updatedAt: '2026-10-20T09:00:00Z' }),
        note('n2', 'Newest', { updatedAt: '2026-10-26T09:00:00Z' }),
      ])
    )
    await waitFor(() => expect(tree.getByTestId(id('RoomNotesWaitingNewest'))).toHaveTextContent('Newest'))
  })

  test('no notes, or only a retracted one: no card (control)', async () => {
    const empty = open(withPosts([]))
    await waitFor(() => expect(empty.getByTestId(id('RoomPostsNone'))).toBeTruthy())
    expect(empty.queryByTestId(id('RoomNotesWaiting'))).toBeNull()
    empty.unmount()
    const retracted = open(withPosts([note('n1', 'Gone', { status: 'retracted' })]))
    await waitFor(() => expect(retracted.getByTestId(id('RoomPostsNone'))).toBeTruthy())
    expect(retracted.queryByTestId(id('RoomNotesWaiting'))).toBeNull()
  })

  test('a chat with messages shows them, not the card (control)', async () => {
    const tree = open(withPosts([note('n1', 'Hello World'), post('m1', 'Hi all')]))
    await waitFor(() => expect(tree.getByText('Hi all')).toBeTruthy())
    expect(tree.queryByTestId(id('RoomNotesWaiting'))).toBeNull()
  })
})
