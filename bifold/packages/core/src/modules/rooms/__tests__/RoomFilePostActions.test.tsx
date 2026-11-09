/**
 * A long press on a file or photo post opens the same sheet a text post does. A file with no words has nothing to copy,
 * edit or withdraw: with sending off, or in a room that takes neither, the sheet says replies and reactions aren't on
 * here yet and offers nothing else; with them on, it offers a reaction and a reply. A post on its way, withdrawn, or
 * one that could not be read still opens nothing, and a text post's sheet is as it was.
 */
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { deriveRoomCapabilities, sampleCapabilities } from '../capabilities'
import { RoomFileChip } from '../components/RoomFileChip'
import { roomHandle } from '../components/RoomRow'
import { toInertText } from '../inertText'
import type { Note, RecordFeatures, Room as RoomRecord, RoomFile, RoomsService } from '../types'

let mockService: RoomsService | undefined
let mockParams: Record<string, string> | undefined
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => 100 }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useRoute: () => ({ params: mockParams }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: Room, canActOn, pendingAsPost } = require('../screens/Room')

const id = (key: string) => testIdWithKey(key)
const ROOM = 'did:webvh:r:one'
const ME = { did: 'did:peer:2.me-1234567890', identityWords: 'negative-weird' }
const NOOR = { did: 'did:peer:noor', identityWords: 'river-stone' }
const EVERYTHING: RecordFeatures = {
  listed: ['kind', 'inReplyTo', 'writtenAt', 'editedAt'],
  canSeal: true,
  unresolved: false,
}
const NEITHER: RecordFeatures = { listed: [], canSeal: true, unresolved: false }

const AGENDA: RoomFile = { fileId: 'file-agenda', name: toInertText('agenda.pdf'), mediaType: 'application/pdf' }
const PHOTO: RoomFile = { fileId: 'file-photo', name: toInertText('IMG_0042.jpg'), mediaType: 'image/jpeg' }

const post = (key: string, body: string, over: Partial<Note> = {}): Note => ({
  key,
  version: 1,
  status: 'active',
  pinned: false,
  updatedAt: '2026-10-26T09:00:00Z',
  author: NOOR,
  body: toInertText(body),
  flags: { containsLink: false, looksLikeInstruction: false },
  check: { verdict: 'consistent', detail: '' },
  ...over,
})
const filePost = (key: string, file: RoomFile, over: Partial<Note> = {}) => post(key, '', { files: [file], ...over })

type Seam = { on?: boolean; features?: RecordFeatures; unreadable?: string[] }

/** An attributed room the member may write to and open files in, with these posts and the record seam as given. */
const service = (posts: Note[], seam: Seam = {}) => {
  const room: RoomRecord = {
    roomId: ROOM,
    name: toInertText('One'),
    nameFrom: 'community',
    source: 'community',
    communityDid: 'did:webvh:c',
    communityName: toInertText('C'),
    tier: 'attributed',
    verbs: ['read', 'write'],
    standing: 'member',
    actingAs: ME,
  }
  const recordFeaturesIn = jest.fn(async () => seam.features ?? EVERYTHING)
  const s = {
    isSample: false,
    capabilities: async () => sampleCapabilities(),
    getRoom: async () => room,
    roomCapabilities: async () => {
      const derived = deriveRoomCapabilities(sampleCapabilities(), room)
      return {
        ...derived,
        write: { status: 'available', detail: '' },
        openFile: { status: 'available', detail: '' },
      }
    },
    listNotes: jest.fn(async () => ({
      notes: posts.map(
        ({ body: _b, flags: _f, check: _c, kind: _k, inReplyTo: _r, writtenAt: _w, editedAt: _e, ...summary }) =>
          summary
      ),
      complete: true,
      check: { verdict: 'consistent', detail: '' },
    })),
    readNote: async (_roomId: string, key: string) => {
      if (seam.unreadable?.includes(key)) throw new Error('could not be read')
      const found = posts.find((p) => p.key === key)
      if (!found) throw new Error('no such post')
      return found
    },
    listFiles: async () => [],
    prepareWrite: jest.fn(async () => ({ token: 't' })),
    confirmWrite: jest.fn(async () => ({ key: 'plain', version: 9 })),
    recordSendingOn: () => seam.on ?? true,
    recordFeaturesIn,
    sendRecord: jest.fn(async () => ({ key: 'new', version: 9 })),
  }
  return s as unknown as RoomsService & { recordFeaturesIn: jest.Mock; sendRecord: jest.Mock }
}

const open = (s: RoomsService) => {
  mockService = s
  mockParams = { roomId: ROOM }
  return render(
    <BasicAppContext>
      <Room />
    </BasicAppContext>
  )
}

const bubbleOf = (tree: ReturnType<typeof open>, key: string) =>
  waitFor(() => within(tree.getByTestId(id(`RoomPost_${roomHandle(key)}`))).getByTestId(id('RoomPostBubble')))

const longPress = async (tree: ReturnType<typeof open>, key: string) => {
  fireEvent(await bubbleOf(tree, key), 'longPress')
}

const press = async (tree: ReturnType<typeof open>, testId: string) => {
  await act(async () => {
    fireEvent.press(tree.getByTestId(id(testId)))
  })
}

/** Nothing on the sheet to tap but its backdrop. */
const expectNoticeOnly = (tree: ReturnType<typeof open>) => {
  expect(tree.getByTestId(id('ChatMessageActions'))).toBeTruthy()
  expect(tree.getByTestId(id('ChatMessageActionsNotice'))).toHaveTextContent('Rooms.RecordsNotOn')
  for (const entry of ['ChatReactionBar', 'ChatActionReply', 'ChatActionCopy', 'ChatActionEdit', 'ChatActionWithdraw'])
    expect(tree.queryByTestId(id(entry))).toBeNull()
}

beforeEach(() => {
  mockService = undefined
  mockParams = undefined
  jest.clearAllMocks()
})

describe('with sending off (every room today)', () => {
  test.each<[string, RoomFile]>([
    ['a file', AGENDA],
    ['a photo', PHOTO],
  ])(
    "%s with no words opens the sheet, which says they aren't on here yet and offers nothing else",
    async (_n, file) => {
      const s = service([filePost('f1', file)], { on: false })
      const tree = open(s)
      await longPress(tree, 'f1')
      expectNoticeOnly(tree)
      expect(s.recordFeaturesIn).not.toHaveBeenCalled()
    }
  )

  test('control: a text post is as before: Copy, and no notice', async () => {
    const tree = open(service([post('m1', 'Hi all')], { on: false }))
    await longPress(tree, 'm1')
    expect(tree.getByTestId(id('ChatActionCopy'))).toBeTruthy()
    expect(tree.queryByTestId(id('ChatMessageActionsNotice'))).toBeNull()
    expect(tree.queryByTestId(id('ChatReactionBar'))).toBeNull()
  })

  test('a file with words under it is a text post: Copy, and no notice', async () => {
    const tree = open(service([post('f1', 'The agenda', { files: [AGENDA] })], { on: false }))
    await longPress(tree, 'f1')
    expect(tree.getByTestId(id('ChatActionCopy'))).toBeTruthy()
    expect(tree.queryByTestId(id('ChatMessageActionsNotice'))).toBeNull()
  })
})

describe('with sending on', () => {
  test("another member's file: reactions and Reply; no Copy and no notice", async () => {
    const s = service([filePost('f1', AGENDA, { kind: 'message' })])
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalledWith(ROOM))
    await longPress(tree, 'f1')
    await waitFor(() => expect(tree.getByTestId(id('ChatReactionBar'))).toBeTruthy())
    expect(tree.getByTestId(id('ChatActionReply'))).toBeTruthy()
    expect(tree.queryByTestId(id('ChatActionCopy'))).toBeNull()
    expect(tree.queryByTestId(id('ChatMessageActionsNotice'))).toBeNull()
  })

  test('your own file that says it is a message: Reply and reactions, never Edit or Withdraw', async () => {
    const s = service([filePost('f1', PHOTO, { kind: 'message', author: ME })])
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    await longPress(tree, 'f1')
    await waitFor(() => expect(tree.getByTestId(id('ChatActionReply'))).toBeTruthy())
    expect(tree.getByTestId(id('ChatReactionBar'))).toBeTruthy()
    expect(tree.queryByTestId(id('ChatActionEdit'))).toBeNull()
    expect(tree.queryByTestId(id('ChatActionWithdraw'))).toBeNull()
  })

  test('your own file with words under it: Copy and Withdraw, never Edit (an edit would drop the file)', async () => {
    const s = service([post('f1', 'The agenda', { kind: 'message', author: ME, files: [AGENDA] })])
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    await longPress(tree, 'f1')
    await waitFor(() => expect(tree.getByTestId(id('ChatActionWithdraw'))).toBeTruthy())
    expect(tree.getByTestId(id('ChatActionCopy'))).toBeTruthy()
    expect(tree.queryByTestId(id('ChatActionEdit'))).toBeNull()
  })

  test("while the room's profile is still being read the notice shows, and Reply and reactions replace it", async () => {
    let answer: (features: RecordFeatures) => void = () => undefined
    const s = service([filePost('f1', AGENDA)])
    s.recordFeaturesIn.mockImplementation(() => new Promise<RecordFeatures>((resolve) => (answer = resolve)))
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    await longPress(tree, 'f1')
    expectNoticeOnly(tree)
    await act(async () => answer(EVERYTHING))
    await waitFor(() => expect(tree.getByTestId(id('ChatActionReply'))).toBeTruthy())
    expect(tree.getByTestId(id('ChatReactionBar'))).toBeTruthy()
    expect(tree.queryByTestId(id('ChatMessageActionsNotice'))).toBeNull()
  })

  test('control: your own text message still offers Edit and Withdraw', async () => {
    const s = service([post('m1', 'We meet at 5', { kind: 'message', author: ME })])
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    await longPress(tree, 'm1')
    await waitFor(() => expect(tree.getByTestId(id('ChatActionEdit'))).toBeTruthy())
    expect(tree.getByTestId(id('ChatActionWithdraw'))).toBeTruthy()
    expect(tree.getByTestId(id('ChatActionCopy'))).toBeTruthy()
  })

  test("a room whose profile lists neither: the file's sheet is the notice alone", async () => {
    const s = service([filePost('f1', AGENDA)], { features: NEITHER })
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    await longPress(tree, 'f1')
    expectNoticeOnly(tree)
  })

  test("Reply on a file quotes the file's name above the composer", async () => {
    const s = service([filePost('f1', AGENDA)])
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    await longPress(tree, 'f1')
    await waitFor(() => expect(tree.getByTestId(id('ChatActionReply'))).toBeTruthy())
    await press(tree, 'ChatActionReply')
    expect(tree.getByTestId(id('RoomComposerContextText'))).toHaveTextContent('agenda.pdf')
  })

  test("a reply to a file shows the file's name in its quote", async () => {
    const tree = open(
      service([post('r1', 'Got it, thanks', { kind: 'message', inReplyTo: { key: 'f1' } }), filePost('f1', AGENDA)])
    )
    const reply = await waitFor(() => tree.getByTestId(id(`RoomPost_${roomHandle('r1')}`)))
    await waitFor(() => expect(within(reply).getByTestId(id('RoomQuoteText'))).toHaveTextContent('agenda.pdf'))
  })

  test('a reaction to a file shows its chip under that file', async () => {
    const tree = open(
      service([post('x1', '👍', { kind: 'reaction', inReplyTo: { key: 'f1' } }), filePost('f1', AGENDA)])
    )
    const file = await waitFor(() => tree.getByTestId(id(`RoomPost_${roomHandle('f1')}`)))
    await waitFor(() => expect(within(file).getByTestId(id('RoomPostReactions'))).toBeTruthy())
  })

  test("a long press on the file's own chip is the post's: the chip is handed the sheet", async () => {
    const tree = open(service([filePost('f1', AGENDA)]))
    await bubbleOf(tree, 'f1')
    const [chip] = tree.UNSAFE_getAllByType(RoomFileChip)
    expect(chip.props.onLongPress).toEqual(expect.any(Function))
    act(() => chip.props.onLongPress())
    await waitFor(() => expect(tree.getByTestId(id('ChatActionReply'))).toBeTruthy())
  })
})

describe('still opens nothing', () => {
  test('a file post that could not be read', async () => {
    const tree = open(service([filePost('f1', AGENDA), post('m1', 'Hi all')], { unreadable: ['f1'] }))
    await waitFor(() => expect(tree.getByTestId(id('RoomPostUnread'))).toBeTruthy())
    await longPress(tree, 'f1')
    expect(tree.queryByTestId(id('ChatMessageActions'))).toBeNull()
  })

  const fileOnItsWay = (state: 'sending' | 'failed' | 'sent') =>
    pendingAsPost(
      {
        localId: 'l1',
        text: '',
        body: '',
        at: new Date('2026-10-26T09:00:00Z'),
        state,
        file: { uri: 'file:///a.pdf', name: 'a.pdf', mimeType: 'application/pdf', size: 10 },
      },
      ME
    )

  test.each(['sending', 'failed'] as const)('a file post still %s', (state) => {
    const pending = fileOnItsWay(state)
    expect(pending.files).toHaveLength(1)
    expect(canActOn(pending)).toBe(false)
    // Control: the same post once it is in the room.
    expect(canActOn(fileOnItsWay('sent'))).toBe(true)
  })

  // A removed post is drawn only where this screen saw it before, and its listing carries no files; the rule holds even
  // for one that still names its file.
  test('a removed post, even one that still names its file', () => {
    const sent = fileOnItsWay('sent')
    expect(sent.files).toHaveLength(1)
    expect(canActOn({ ...sent, retracted: true })).toBe(false)
    expect(canActOn(sent)).toBe(true)
  })
})

describe('the file chip on its own', () => {
  test('a long press calls the post sheet, not the file', () => {
    const onPress = jest.fn()
    const onLongPress = jest.fn()
    const tree = render(
      <BasicAppContext>
        <RoomFileChip file={AGENDA} ink="#000" edge="#ccc" onPress={onPress} onLongPress={onLongPress} />
      </BasicAppContext>
    )
    // RNTL's fireEvent would find onLongPress on the chip's own props too, so hold the touchable itself: without the
    // prop, Pressable fires onPress on a long press's release and the file opens.
    const chipId = id(`RoomFileChip_${roomHandle(AGENDA.fileId)}`)
    const touchable = tree.UNSAFE_root.findAll(
      (node) => typeof node.type !== 'string' && node.props.testID === chipId && node.props.onLongPress === onLongPress
    )
    // Pressable's own wrappers may carry the same props: at least one, never none.
    expect(touchable.length).toBeGreaterThan(0)
    act(() => touchable[0].props.onLongPress())
    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(onPress).not.toHaveBeenCalled()
  })
})
