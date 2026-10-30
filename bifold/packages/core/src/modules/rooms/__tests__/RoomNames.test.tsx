/**
 * A room's header and its people (header B, names step 1): the room's letters, name, community, access end and
 * tier, and no "You act here as" line; the member posts as their Keyring profile's name, said once at the composer;
 * another member is "Member …saddle", never a raw ID; a name opens the person's sheet, where the identity lives
 * with Copy, and for the member themselves, their profile.
 */
import Clipboard from '@react-native-clipboard/clipboard'
import { useNavigation } from '@react-navigation/native'
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { deriveRoomCapabilities, sampleCapabilities } from '../capabilities'
import { initialsOf } from '../components/RoomIdentitySheet'
import { toInertText } from '../inertText'
import type { Note, Room as RoomRecord, RoomsService } from '../types'
import type { MyName } from '../useMyName'

let mockService: RoomsService | undefined
let mockMe: MyName = {}
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
jest.mock('../useMyName', () => ({ useMyName: () => mockMe }))
jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => 100 }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useRoute: () => ({ params: { roomId: 'did:webvh:r:one' } }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Room = require('../screens/Room').default

const id = (key: string) => testIdWithKey(key)
const ME = { did: 'did:webvh:lab:persona:expose' }
const THEM = { did: 'did:webvh:lab:persona:saddle' }

const post = (key: string, body: string, author: { did: string }): Note => ({
  key,
  version: 1,
  status: 'active',
  pinned: false,
  updatedAt: '2026-10-29T18:06:00Z',
  author,
  body: toInertText(body),
  flags: { containsLink: false, looksLikeInstruction: false },
  check: { verdict: 'consistent', detail: '' },
})

/** One open room in a named community, the member and one other having posted, as the real service gives them. */
const service = () => {
  const room: RoomRecord = {
    roomId: 'did:webvh:r:one',
    name: toInertText('Keyring lab open'),
    nameFrom: 'community',
    source: 'community',
    communityDid: 'did:webvh:lab',
    communityName: toInertText('Keyring Lab'),
    tier: 'open',
    verbs: ['read', 'write'],
    validUntil: '2027-01-26T00:00:00Z',
    standing: 'member',
    actingAs: ME,
  }
  const posts = [post('m1', 'Hi', THEM), post('m2', 'How is everyone', ME)]
  return {
    isSample: false,
    capabilities: async () => sampleCapabilities(),
    getRoom: async () => room,
    roomCapabilities: async () => deriveRoomCapabilities(sampleCapabilities(), room),
    listNotes: async () => ({
      notes: posts.map(({ body: _b, flags: _f, check: _c, ...summary }) => summary),
      complete: true,
      check: { verdict: 'consistent', detail: '' },
    }),
    readNote: async (_roomId: string, key: string) => posts.find((p) => p.key === key),
    listFiles: async () => [],
  } as unknown as RoomsService
}

const show = async () => {
  mockService = service()
  const tree = render(
    <BasicAppContext>
      <Room />
    </BasicAppContext>
  )
  await waitFor(() => expect(tree.getAllByTestId(/RoomPost_/)).toHaveLength(2))
  return tree
}
type Tree = Awaited<ReturnType<typeof show>>
const press = async (tree: Tree, key: string) => {
  await act(async () => {
    fireEvent.press(tree.getByTestId(id(key)))
  })
}
const sheet = (tree: Tree) => within(tree.getByTestId(id('RoomIdentitySheet')))

beforeEach(() => {
  mockMe = {}
  ;(Clipboard.setString as jest.Mock | undefined)?.mockClear?.()
})

describe("a room's header", () => {
  test("the room's letters, its name, where it is and until when, its tier; who the member is, not said here", async () => {
    const tree = await show()
    const header = within(tree.getByTestId(id('RoomHeader')))
    // Hidden from a screen reader: the title says the name.
    expect(header.getByTestId(id('RoomMonogram'), { includeHiddenElements: true })).toHaveTextContent('KL')
    expect(header.getByTestId(id('RoomTitle'))).toHaveTextContent('Keyring lab open')
    expect(header.getByTestId(id('RoomWhere'))).toHaveTextContent('Rooms.RoomInUntil')
    expect(header.getByTestId(id('RoomTier'))).toBeTruthy()
    expect(tree.queryByTestId(id('RoomActingAs'))).toBeNull()
    expect(initialsOf('Keyring lab open')).toBe('KL')
    expect(initialsOf('  ')).toBe('?')
  })
})

describe('names in a room, step 1', () => {
  test('no raw ID is a label: the member is "You", another member is "Member …saddle"', async () => {
    const tree = await show()
    expect(tree.queryAllByText(/did:/)).toHaveLength(0)
    expect(tree.getByTestId(id('RoomPostAuthor'))).toHaveTextContent('Rooms.MemberTail')
    expect(tree.getAllByText('Rooms.You').length).toBeGreaterThan(0)
  })

  test('with a profile name: the composer posts as it, and its sheet says where it comes from and opens the profile', async () => {
    mockMe = { name: 'Alberto L', profileId: 'p1' }
    const tree = await show()
    expect(tree.getByTestId(id('RoomComposerPostingAs'))).toHaveTextContent('Rooms.PostingAs')
    await press(tree, 'RoomComposerPostingAsButton')
    expect(sheet(tree).getByTestId(id('RoomIdentityName'))).toHaveTextContent('Alberto L')
    expect(sheet(tree).getByTestId(id('RoomIdentitySource'))).toHaveTextContent('Rooms.NameFromProfile')
    // The room's members see the identity, not the name: the sheet says so, beside the identity itself.
    expect(sheet(tree).getByTestId(id('RoomIdentityDid'))).toHaveTextContent(ME.did)
    expect(sheet(tree).getByTestId(id('RoomIdentityOthersSee'))).toBeTruthy()
    const navigation = useNavigation() as unknown as { navigate: jest.Mock }
    navigation.navigate.mockClear()
    await press(tree, 'RoomIdentityOpenProfile')
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.EditRCard, { profileId: 'p1' })
    expect(tree.queryByTestId(id('RoomIdentitySheet'))).toBeNull()
  })

  test('with no profile name: "Posting as you · Add your name", and the sheet offers to add one', async () => {
    const tree = await show()
    expect(tree.getByTestId(id('RoomComposerPostingAs'))).toHaveTextContent('Rooms.PostingAsAddName')
    await press(tree, 'RoomComposerPostingAsButton')
    expect(sheet(tree).getByTestId(id('RoomIdentityName'))).toHaveTextContent('Rooms.You')
    expect(sheet(tree).getByTestId(id('RoomIdentitySource'))).toHaveTextContent('Rooms.NameNotSet')
    const navigation = useNavigation() as unknown as { navigate: jest.Mock }
    navigation.navigate.mockClear()
    await press(tree, 'RoomIdentityAddName')
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.EditRCard, {})
  })

  test("another member's name opens their sheet: no name known yet, their identity with Copy, no profile", async () => {
    mockMe = { name: 'Alberto L', profileId: 'p1' }
    const tree = await show()
    await press(tree, 'RoomPostAuthor')
    expect(sheet(tree).getByTestId(id('RoomIdentityName'))).toHaveTextContent('Rooms.MemberTail')
    expect(sheet(tree).getByTestId(id('RoomIdentitySource'))).toHaveTextContent('Rooms.NameNotKnown')
    expect(sheet(tree).getByTestId(id('RoomIdentityDid'))).toHaveTextContent(THEM.did)
    expect(sheet(tree).queryByTestId(id('RoomIdentityOpenProfile'))).toBeNull()
    expect(sheet(tree).queryByTestId(id('RoomIdentityOthersSee'))).toBeNull()
    await press(tree, 'RoomIdentityCopy')
    expect(Clipboard.setString).toHaveBeenCalledWith(THEM.did)
    expect(sheet(tree).getByText('Rooms.IdCopied')).toBeTruthy()
    await press(tree, 'RoomIdentityClose')
    expect(tree.queryByTestId(id('RoomIdentitySheet'))).toBeNull()
  })
})
