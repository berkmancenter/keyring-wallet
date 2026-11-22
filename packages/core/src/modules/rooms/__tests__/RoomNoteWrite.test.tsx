/**
 * Writing a note (rooms member features, chunk 2): "New note" in an open room's notes (RoomPart) opens the editor; Review
 * asks for the preview, which names who it posts as and who can read it; Post writes it and the note shows. The
 * member's own notes offer Edit, which saves a new version. A failed write keeps the words and, retried, is the same
 * write; a stale preview is prepared once more; a note that changed under an edit is not written. An attributed
 * room is written to like an open one; a room whose write status says writing is on its way shows that instead,
 * and a member without the right gets no button at all.
 */
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native'
import React from 'react'
import { Modal } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { createSampleRoomsService } from '../sample/sampleRooms'
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, RoomsConflict, RoomsPreviewExpired, type RoomsService } from '../types'
import { noteDraft } from '../useRoomNoteWrite'

let mockService: RoomsService | undefined
let mockParams: Record<string, string> | undefined
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => 100 }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useRoute: () => ({ params: mockParams }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RoomPart = require('../screens/RoomPart').default

// Planning is attributed in the sample, where the member may write; shown here as open unless a test says otherwise.
// Welcome desk is open, and read-only for this member.
const PLANNING = 'did:webvh:sample:planning'
const WELCOME_DESK = 'did:webvh:sample:welcome-desk'
const id = (key: string) => testIdWithKey(key)

const asOpen = (base: RoomsService): RoomsService => ({
  ...base,
  getRoom: async (roomId) => ({ ...(await base.getRoom(roomId)), tier: 'open' }),
})

const show = async (roomId = PLANNING) => {
  mockParams = { roomId, part: 'notes' }
  const tree = render(
    <BasicAppContext>
      <RoomPart />
    </BasicAppContext>
  )
  await waitFor(() => tree.getByTestId(id('RoomNotesCaption')))
  return tree
}

type Tree = Awaited<ReturnType<typeof show>>

const press = async (tree: Tree, key: string) => {
  await act(async () => {
    fireEvent.press(tree.getByTestId(id(key)))
  })
}

const type = async (tree: Tree, title: string, body: string) => {
  await act(async () => {
    fireEvent.changeText(tree.getByTestId(id('RoomNoteTitleInput')), title)
    fireEvent.changeText(tree.getByTestId(id('RoomNoteBodyInput')), body)
  })
}

const writeNote = async (tree: Tree, title: string, body: string) => {
  await press(tree, 'RoomNoteNew')
  await type(tree, title, body)
  await press(tree, 'RoomNoteReview')
  await waitFor(() => tree.getByTestId(id('RoomNotePost')))
  await press(tree, 'RoomNotePost')
  await waitFor(() => expect(tree.queryByTestId(id('RoomNoteEditor'))).toBeNull())
}

const notesList = (tree: Tree) => within(tree.getByTestId(id('RoomNotes')))

let base: RoomsService
beforeEach(() => {
  base = createSampleRoomsService()
  mockService = asOpen(base)
})

describe('what is written', () => {
  test('the title is trimmed and both are held to their limits; an edit is keyed by its note, a new note by its id', () => {
    const long = noteDraft(` ${'t'.repeat(NOTE_TITLE_MAX + 5)} `, 'b'.repeat(NOTE_BODY_MAX + 5), undefined, 'e1')
    expect(long.title).toHaveLength(NOTE_TITLE_MAX)
    expect(long.body).toHaveLength(NOTE_BODY_MAX)
    expect(long.idempotencyKey).toBe('e1')
    expect(noteDraft('  Agenda  ', 'words', 'n2', 'e1')).toEqual({ title: 'Agenda', body: 'words', replaceKey: 'n2' })
  })
})

describe('a new note', () => {
  test('Review waits for a title and words; the check names who it posts as; Post writes it and it shows', async () => {
    const prepare = jest.spyOn(mockService!, 'prepareWrite')
    const tree = await show()
    await press(tree, 'RoomNoteNew')
    expect(tree.getByTestId(id('RoomNoteReview'))).toBeDisabled()
    await type(tree, 'Decisions', '')
    expect(tree.getByTestId(id('RoomNoteReview'))).toBeDisabled()
    await type(tree, 'Decisions', 'We meet on Thursdays.')
    expect(tree.getByTestId(id('RoomNoteReview'))).toBeEnabled()

    await press(tree, 'RoomNoteReview')
    await waitFor(() => tree.getByTestId(id('RoomNotePostingAs')))
    // t() gives keys under jest: these pin which words show, not their English.
    expect(tree.getByTestId(id('RoomNotePostingAs'))).toHaveTextContent('Rooms.PostingAs')
    expect(tree.getByTestId(id('RoomNoteVisibleTo'))).toHaveTextContent('Rooms.NoteVisibleMembers')
    expect(within(tree.getByTestId(id('RoomNotePreview'))).getByText('We meet on Thursdays.')).toBeTruthy()
    expect(prepare).toHaveBeenCalledWith(PLANNING, {
      title: 'Decisions',
      body: 'We meet on Thursdays.',
      idempotencyKey: expect.any(String),
    })

    await press(tree, 'RoomNotePost')
    await waitFor(() => expect(tree.queryByTestId(id('RoomNoteEditor'))).toBeNull())
    await waitFor(() => notesList(tree).getByText('Decisions'))
    expect(notesList(tree).getByText('We meet on Thursdays.')).toBeTruthy()
  })

  test("the editor's top bar clears the status bar: the modal has its own safe-area provider", async () => {
    const tree = await show()
    await press(tree, 'RoomNoteNew')
    // A modal is its own window: the SafeAreaView reads its insets from the nearest provider inside it, or none.
    const outward: unknown[] = []
    for (let node = tree.getByTestId(id('RoomNoteEditor')).parent; node; node = node.parent) outward.push(node.type)
    const provider = outward.indexOf(SafeAreaProvider)
    expect(provider).toBeGreaterThan(-1)
    expect(provider).toBeLessThan(outward.indexOf(Modal))
  })

  test('Back from the check returns to the words, unchanged; Cancel closes with nothing written', async () => {
    const confirm = jest.spyOn(mockService!, 'confirmWrite')
    const tree = await show()
    await press(tree, 'RoomNoteNew')
    await type(tree, 'Draft', 'Not yet')
    await press(tree, 'RoomNoteReview')
    await waitFor(() => tree.getByTestId(id('RoomNoteBack')))
    await press(tree, 'RoomNoteBack')
    expect(tree.getByTestId(id('RoomNoteTitleInput')).props.value).toBe('Draft')
    expect(tree.getByTestId(id('RoomNoteBodyInput')).props.value).toBe('Not yet')
    await press(tree, 'RoomNoteCancel')
    expect(tree.queryByTestId(id('RoomNoteEditor'))).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
  })

  test('a failed write keeps the words, and the retry is the same write: one note, not two', async () => {
    const realConfirm = mockService!.confirmWrite
    let failOnce = true
    mockService!.confirmWrite = jest.fn(async (token: string) => {
      if (failOnce) {
        failOnce = false
        throw new Error('no answer')
      }
      return realConfirm(token)
    })
    const prepare = jest.spyOn(mockService!, 'prepareWrite')
    const tree = await show()
    await press(tree, 'RoomNoteNew')
    await type(tree, 'Retry me', 'Once only')
    await press(tree, 'RoomNoteReview')
    await waitFor(() => tree.getByTestId(id('RoomNotePost')))
    await press(tree, 'RoomNotePost')
    await waitFor(() => tree.getByTestId(id('RoomNoteFailed')))
    expect(tree.getByTestId(id('RoomNoteFailed'))).toHaveTextContent('Rooms.NoteSaveFailed')
    expect(tree.getByTestId(id('RoomNoteTitleInput')).props.value).toBe('Retry me')

    await press(tree, 'RoomNoteReview')
    await waitFor(() => tree.getByTestId(id('RoomNotePost')))
    await press(tree, 'RoomNotePost')
    await waitFor(() => expect(tree.queryByTestId(id('RoomNoteEditor'))).toBeNull())
    const keys = prepare.mock.calls.map(([, draft]) => draft.idempotencyKey)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
    await waitFor(() => notesList(tree).getByText('Retry me'))
    expect(notesList(tree).getAllByText('Retry me')).toHaveLength(1)
  })

  test('a preview gone stale is prepared once more and posted, without asking again', async () => {
    const realConfirm = mockService!.confirmWrite
    let expireOnce = true
    mockService!.confirmWrite = jest.fn(async (token: string) => {
      if (expireOnce) {
        expireOnce = false
        throw new RoomsPreviewExpired(token)
      }
      return realConfirm(token)
    })
    const tree = await show()
    await writeNote(tree, 'Stale preview', 'Still posted')
    expect(mockService!.confirmWrite).toHaveBeenCalledTimes(2)
    await waitFor(() => notesList(tree).getByText('Stale preview'))
  })

  test('each new note gets its own id: a second note after Cancel is not taken for a retry of the first', async () => {
    const prepare = jest.spyOn(mockService!, 'prepareWrite')
    const tree = await show()
    await press(tree, 'RoomNoteNew')
    await type(tree, 'First', 'One')
    await press(tree, 'RoomNoteReview')
    await waitFor(() => tree.getByTestId(id('RoomNoteBack')))
    await press(tree, 'RoomNoteBack')
    await press(tree, 'RoomNoteCancel')
    await writeNote(tree, 'Second', 'Two')
    const keys = prepare.mock.calls.map(([, draft]) => draft.idempotencyKey)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBeTruthy()
    expect(keys[1]).not.toBe(keys[0])
    await waitFor(() => notesList(tree).getByText('Second'))
  })
})

describe("editing one's own note", () => {
  test('only the member’s own notes offer Edit; an edit saves a new version of the same note', async () => {
    const tree = await show()
    // The sample's notes are all others'.
    expect(notesList(tree).queryAllByTestId(id('RoomNoteEdit'))).toHaveLength(0)
    await writeNote(tree, 'Plan', 'First version')
    await waitFor(() => notesList(tree).getByText('First version'))
    expect(notesList(tree).getAllByTestId(id('RoomNoteEdit'))).toHaveLength(1)

    const prepare = jest.spyOn(mockService!, 'prepareWrite')
    await press(tree, 'RoomNoteEdit')
    expect(tree.getByTestId(id('RoomNoteTitleInput')).props.value).toBe('Plan')
    expect(tree.getByTestId(id('RoomNoteBodyInput')).props.value).toBe('First version')
    await type(tree, 'Plan', 'Second version')
    await press(tree, 'RoomNoteReview')
    await waitFor(() => tree.getByText('Rooms.NoteNewVersion'))
    const [, draft] = prepare.mock.calls[0]
    expect(draft.replaceKey).toBeTruthy()
    expect(draft.idempotencyKey).toBeUndefined()

    await press(tree, 'RoomNotePost')
    await waitFor(() => notesList(tree).getByText('Second version'))
    expect(notesList(tree).queryByText('First version')).toBeNull()
    expect(notesList(tree).getAllByText('Plan')).toHaveLength(1)
  })

  test('a note that changed after it was opened is not written; Read it again closes and reads the room', async () => {
    const tree = await show()
    await writeNote(tree, 'Shared plan', 'Mine')
    await waitFor(() => notesList(tree).getByTestId(id('RoomNoteEdit')))
    mockService!.confirmWrite = jest.fn(async () => {
      throw new RoomsConflict('n9', 7)
    })
    const read = jest.spyOn(mockService!, 'listNotes')
    await press(tree, 'RoomNoteEdit')
    await type(tree, 'Shared plan', 'Changed')
    await press(tree, 'RoomNoteReview')
    await waitFor(() => tree.getByTestId(id('RoomNotePost')))
    await press(tree, 'RoomNotePost')
    await waitFor(() => tree.getByTestId(id('RoomNoteConflict')))
    expect(tree.getByTestId(id('RoomNoteConflict'))).toHaveTextContent('Rooms.NoteConflict')

    await press(tree, 'RoomNoteReread')
    expect(tree.queryByTestId(id('RoomNoteEditor'))).toBeNull()
    await waitFor(() => expect(read).toHaveBeenCalled())
    expect(notesList(tree).getByText('Mine')).toBeTruthy()
  })
})

describe('where notes are written, by the room’s write status', () => {
  test('an attributed room where the member may write offers "New note", as an open one does', async () => {
    mockService = base
    expect((await base.getRoom(PLANNING)).tier).toBe('attributed')
    const tree = await show()
    expect(tree.getByTestId(id('RoomNoteNew'))).toBeTruthy()
    expect(tree.queryByTestId(id('RoomNotesCannotWrite'))).toBeNull()
  })

  test('where the room says writing is on its way (a tier not written to yet): the "Writing notes" card, no plain line', async () => {
    mockService = {
      ...base,
      roomCapabilities: async (roomId) => ({
        ...(await base.roomCapabilities(roomId)),
        write: { status: 'comingSoon', reason: 'tierNotYet', detail: 'not in an attributed room yet' },
      }),
    }
    const tree = await show()
    expect(tree.queryByTestId(id('RoomNoteNew'))).toBeNull()
    expect(tree.getByTestId(id('RoomFeatureCard_noteWrite'))).toBeTruthy()
    expect(tree.queryByTestId(id('RoomNotesCannotWrite'))).toBeNull()
  })

  test('the real service before writing is built: the "Writing notes" card, no button and nothing to edit', async () => {
    mockService = {
      ...asOpen(base),
      roomCapabilities: async (roomId) => ({
        ...(await base.roomCapabilities(roomId)),
        write: { status: 'comingSoon', reason: 'clientNotBuilt', detail: 'not built in this version of Keyring' },
      }),
    }
    const prepare = jest.spyOn(mockService, 'prepareWrite')
    const tree = await show()
    expect(tree.queryByTestId(id('RoomNoteNew'))).toBeNull()
    expect(tree.getByTestId(id('RoomFeatureCard_noteWrite'))).toBeTruthy()
    expect(tree.queryByTestId(id('RoomNotesCannotWrite'))).toBeNull()
    expect(notesList(tree).queryAllByTestId(id('RoomNoteEdit'))).toHaveLength(0)
    expect(prepare).not.toHaveBeenCalled()
  })

  test('control: in an open room this member may only read, the tab gives the reason, not "not yet"', async () => {
    mockService = base
    const tree = await show(WELCOME_DESK)
    expect(tree.queryByTestId(id('RoomNoteNew'))).toBeNull()
    expect(tree.getByTestId(id('RoomNotesCannotWrite'))).toHaveTextContent('Rooms.NoRightWrite')
    expect(tree.queryByTestId(id('RoomFeatureCard_noteWrite'))).toBeNull()
  })
})
