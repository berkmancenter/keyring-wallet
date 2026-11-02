/**
 * A room's header and its people (header B, names step 1): the room's letters, name, community, access end and
 * tier, and no "You act here as" line; the member posts as their Keyring profile's name, said once at the composer;
 * another member is "Member …saddle", never a raw ID; a name opens the person's sheet, where the identity lives
 * with Copy, and for the member themselves, their profile.
 */
import Clipboard from '@react-native-clipboard/clipboard'
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens, Stacks, TabStacks } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { deriveRoomCapabilities, sampleCapabilities } from '../capabilities'
import { initialsOf } from '../components/RoomIdentitySheet'
import { toInertText } from '../inertText'
import type { Note, Room as RoomRecord, RoomsService } from '../types'
import type { MyName } from '../useMyName'

let mockService: RoomsService | undefined
let mockMe: MyName = {}
let mockNames = new Map<string, string>()
const mockSetPetname = jest.fn(async (_name: string) => undefined)
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
jest.mock('../useMyName', () => ({ useMyName: () => mockMe }))
// The member's names for others, as a2's store gives them: one for the sheet, all of them for the labels.
jest.mock('../usePetname', () => ({
  usePetname: (communityDid?: string, memberDid?: string) => ({
    name: communityDid && memberDid ? mockNames.get(memberDid) : undefined,
    loaded: !!(communityDid && memberDid),
    set: mockSetPetname,
  }),
  usePetnames: () => mockNames,
}))
// The names other members wrote on their own directory cards, as the directory gives them to the room.
let mockDirectoryNames = new Map<string, string>()
const mockUseDirectoryNames = jest.fn(
  (_service: unknown, _communityDid?: string, _dids?: readonly string[]) => mockDirectoryNames
)
jest.mock('../../directory/useDirectory', () => ({
  useDirectoryService: () => undefined,
  useDirectoryNames: (service: unknown, communityDid?: string, dids?: readonly string[]) =>
    mockUseDirectoryNames(service, communityDid, dids),
}))
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
// The mock's one navigation object, the same one the screen gets.
const navigation = jest.requireMock('@react-navigation/native').useNavigation() as { navigate: jest.Mock }
// A profile and a member's card are My Agent's screens: from a room in either tab they open there (rooms in Messages,
// R2), above what My Agent already shows.
const inMyAgent = (screen: Screens, params: object) => [
  Stacks.TabStack,
  { screen: TabStacks.MyAgentStack, params: { screen, params, initial: false } },
]

beforeEach(() => {
  mockMe = {}
  mockNames = new Map()
  mockDirectoryNames = new Map()
  mockUseDirectoryNames.mockClear()
  mockSetPetname.mockClear()
  ;(Clipboard.setString as jest.Mock | undefined)?.mockClear?.()
  navigation.navigate.mockClear()
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
    await press(tree, 'RoomIdentityOpenProfile')
    expect(navigation.navigate.mock.calls).toEqual([inMyAgent(Screens.EditRCard, { profileId: 'p1' })])
    expect(tree.queryByTestId(id('RoomIdentitySheet'))).toBeNull()
  })

  test('with no profile name: "Posting as you · Add your name", and the sheet offers to add one', async () => {
    const tree = await show()
    expect(tree.getByTestId(id('RoomComposerPostingAs'))).toHaveTextContent('Rooms.PostingAsAddName')
    await press(tree, 'RoomComposerPostingAsButton')
    expect(sheet(tree).getByTestId(id('RoomIdentityName'))).toHaveTextContent('Rooms.You')
    expect(sheet(tree).getByTestId(id('RoomIdentitySource'))).toHaveTextContent('Rooms.NameNotSet')
    await press(tree, 'RoomIdentityAddName')
    expect(navigation.navigate.mock.calls).toEqual([inMyAgent(Screens.EditRCard, {})])
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

  test('another member can be given a name of your own: never blank, saved as typed', async () => {
    const tree = await show()
    await press(tree, 'RoomPostAuthor')
    await press(tree, 'RoomIdentityNameThem')
    expect(tree.getByTestId(id('RoomIdentityNameSave'))).toBeDisabled()
    await act(async () => {
      fireEvent.changeText(tree.getByTestId(id('RoomIdentityNameInput')), '   ')
    })
    expect(tree.getByTestId(id('RoomIdentityNameSave'))).toBeDisabled()
    await act(async () => {
      fireEvent.changeText(tree.getByTestId(id('RoomIdentityNameInput')), 'River')
    })
    await press(tree, 'RoomIdentityNameSave')
    expect(mockSetPetname).toHaveBeenCalledWith('River')
    expect(tree.queryByTestId(id('RoomIdentityNameInput'))).toBeNull()
  })

  test('a name you gave is shown as yours: in the chat, and on their sheet beside "Member …saddle"', async () => {
    mockNames = new Map([[THEM.did, 'River']])
    const tree = await show()
    expect(tree.getByTestId(id('RoomPostAuthor'))).toHaveTextContent('Rooms.PetnameLabel')
    await press(tree, 'RoomPostAuthor')
    expect(sheet(tree).getByTestId(id('RoomIdentityName'))).toHaveTextContent('River')
    expect(sheet(tree).getByTestId(id('RoomIdentityStandIn'))).toHaveTextContent('Rooms.MemberTail')
    expect(sheet(tree).getByTestId(id('RoomIdentitySource'))).toHaveTextContent('Rooms.PetnameSource')
    expect(sheet(tree).getByTestId(id('RoomIdentityRename'))).toBeTruthy()
  })

  test('their own name, where they show it: asked for other authors only, marked as theirs in the chat and on their sheet', async () => {
    mockDirectoryNames = new Map([[THEM.did, 'Saddle Q']])
    const tree = await show()
    expect(mockUseDirectoryNames).toHaveBeenLastCalledWith(undefined, 'did:webvh:lab', [THEM.did])
    expect(tree.getByTestId(id('RoomPostAuthor'))).toHaveTextContent('Rooms.DirectoryNameLabel')
    await press(tree, 'RoomPostAuthor')
    expect(sheet(tree).getByTestId(id('RoomIdentityName'))).toHaveTextContent('Saddle Q')
    // A self-chosen name can claim anything: the stand-in stays beside it.
    expect(sheet(tree).getByTestId(id('RoomIdentityStandIn'))).toHaveTextContent('Rooms.MemberTail')
    expect(sheet(tree).getByTestId(id('RoomIdentitySource'))).toHaveTextContent('Rooms.NameTheirOwn')
  })

  test('an author who shows their card: "View card" opens it by their DID, with what the room calls them', async () => {
    mockDirectoryNames = new Map([[THEM.did, 'Saddle Q']])
    const tree = await show()
    await press(tree, 'RoomPostAuthor')
    expect(sheet(tree).queryByTestId(id('RoomIdentityNoCard'))).toBeNull()
    await press(tree, 'RoomIdentityViewCard')
    expect(navigation.navigate.mock.calls).toEqual([
      inMyAgent(Screens.CommunityMemberCard, {
        communityDid: 'did:webvh:lab',
        memberDid: THEM.did,
        standIn: 'Rooms.MemberTail',
      }),
    ])
  })

  test('an author who does not: one plain line that there is no card to show, no button', async () => {
    const tree = await show()
    await press(tree, 'RoomPostAuthor')
    expect(sheet(tree).getByTestId(id('RoomIdentityNoCard'))).toHaveTextContent('Directory.NoCardToShow')
    expect(sheet(tree).queryByTestId(id('RoomIdentityViewCard'))).toBeNull()
  })

  test('your own sheet has neither', async () => {
    const tree = await show()
    await press(tree, 'RoomComposerPostingAsButton')
    expect(sheet(tree).queryByTestId(id('RoomIdentityNoCard'))).toBeNull()
    expect(sheet(tree).queryByTestId(id('RoomIdentityViewCard'))).toBeNull()
  })

  test('a name you gave comes before their own name', async () => {
    mockNames = new Map([[THEM.did, 'River']])
    mockDirectoryNames = new Map([[THEM.did, 'Saddle Q']])
    const tree = await show()
    expect(tree.getByTestId(id('RoomPostAuthor'))).toHaveTextContent('Rooms.PetnameLabel')
    await press(tree, 'RoomPostAuthor')
    expect(sheet(tree).getByTestId(id('RoomIdentityName'))).toHaveTextContent('River')
    expect(sheet(tree).getByTestId(id('RoomIdentitySource'))).toHaveTextContent('Rooms.PetnameSource')
  })

  test('your own sheet offers your profile, never a name of your own for yourself', async () => {
    mockMe = { name: 'Alberto L', profileId: 'p1' }
    const tree = await show()
    await press(tree, 'RoomComposerPostingAsButton')
    expect(sheet(tree).queryByTestId(id('RoomIdentityNameThem'))).toBeNull()
    expect(sheet(tree).getByTestId(id('RoomIdentityOpenProfile'))).toBeTruthy()
  })
})
