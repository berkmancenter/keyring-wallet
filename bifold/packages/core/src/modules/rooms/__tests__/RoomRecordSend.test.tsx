/**
 * Sending replies, reactions, edits and withdrawals from a room (trust-tasks-tf #1027, frames 3, 5, 7, 8, 9 and 12).
 * Off in every build: `recordSendingOn` is set by nothing but tests. These tests turn it on to hold what the screen
 * does then, and hold that with it off, or absent, the room is exactly as before: Copy only, and no profile read.
 */
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native'
import React from 'react'
import Toast from 'react-native-toast-message'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { deriveRoomCapabilities, sampleCapabilities } from '../capabilities'
import { RoomComposer } from '../components/RoomComposer'
import { roomHandle } from '../components/RoomRow'
import { toInertText } from '../inertText'
import type { Note, RecordFeatures, RecordWrite, Room as RoomRecord, RoomsService } from '../types'

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

const id = (key: string) => testIdWithKey(key)
const ROOM = 'did:webvh:r:one'
const ME = { did: 'did:peer:2.me-1234567890', identityWords: 'negative-weird' }
const NOOR = { did: 'did:peer:noor', identityWords: 'river-stone' }
const EVERYTHING: RecordFeatures = {
  listed: ['kind', 'inReplyTo', 'writtenAt', 'editedAt'],
  canSeal: true,
  unresolved: false,
}

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
const reaction = (key: string, target: string, value: string, over: Partial<Note> = {}) =>
  post(key, value, { kind: 'reaction', inReplyTo: { key: target }, ...over })

type Seam = {
  on?: boolean
  features?: RecordFeatures
  tier?: RoomRecord['tier']
  /** Leave the three optional methods off the service, as a build without them. */
  absent?: boolean
  sendRecord?: (roomId: string, write: RecordWrite) => Promise<{ key: string; version: number }>
}

/** An attributed room the member may write to, with these posts and the record seam as given. */
const service = (posts: Note[], seam: Seam = {}) => {
  const room: RoomRecord = {
    roomId: ROOM,
    name: toInertText('One'),
    nameFrom: 'community',
    source: 'community',
    communityDid: 'did:webvh:c',
    communityName: toInertText('C'),
    tier: seam.tier ?? 'attributed',
    verbs: ['read', 'write'],
    standing: 'member',
    actingAs: ME,
  }
  const recordFeaturesIn = jest.fn(async () => seam.features ?? EVERYTHING)
  const sendRecord = jest.fn(seam.sendRecord ?? (async () => ({ key: 'new', version: 9 })))
  const s = {
    isSample: false,
    capabilities: async () => sampleCapabilities(),
    getRoom: async () => room,
    roomCapabilities: async () => {
      const derived = deriveRoomCapabilities(sampleCapabilities(), room)
      return { ...derived, write: { status: 'available', detail: '' } }
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
      const found = posts.find((p) => p.key === key)
      if (!found) throw new Error('no such post')
      return found
    },
    listFiles: async () => [],
    prepareWrite: jest.fn(async () => ({ token: 't' })),
    confirmWrite: jest.fn(async () => ({ key: 'plain', version: 9 })),
    ...(seam.absent ? {} : { recordSendingOn: () => seam.on ?? true, recordFeaturesIn, sendRecord }),
  }
  return s as unknown as RoomsService & {
    recordFeaturesIn: jest.Mock
    sendRecord: jest.Mock
    prepareWrite: jest.Mock
    listNotes: jest.Mock
  }
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

const longPress = async (tree: ReturnType<typeof open>, key: string) => {
  const bubble = await waitFor(() =>
    within(tree.getByTestId(id(`RoomPost_${roomHandle(key)}`))).getByTestId(id('RoomPostBubble'))
  )
  fireEvent(bubble, 'longPress')
}

const press = async (tree: ReturnType<typeof open>, testId: string) => {
  await act(async () => {
    fireEvent.press(tree.getByTestId(id(testId)))
  })
}

beforeEach(() => {
  mockService = undefined
  mockParams = undefined
  jest.clearAllMocks()
})

describe('with sending off, the room is as before', () => {
  test.each<[string, Seam]>([
    ['switched off', { on: false }],
    ['a service without the seam', { absent: true }],
  ])('%s: Copy only, and the room profile is never read', async (_name, seam) => {
    const s = service([post('m1', 'Hi all')], seam)
    const tree = open(s)
    await longPress(tree, 'm1')
    expect(tree.getByTestId(id('ChatActionCopy'))).toBeTruthy()
    expect(tree.queryByTestId(id('ChatReactionBar'))).toBeNull()
    expect(tree.queryByTestId(id('ChatActionReply'))).toBeNull()
    expect(tree.queryByTestId(id('ChatMessageActionsNotice'))).toBeNull()
    if (!seam.absent) expect(s.recordFeaturesIn).not.toHaveBeenCalled()
  })

  test('a plain post goes the old way, as a note', async () => {
    const s = service([post('m1', 'Hi all')], { on: false })
    const tree = open(s)
    fireEvent.changeText(await waitFor(() => tree.getByTestId(id('RoomComposerInput'))), 'On my way')
    await press(tree, 'RoomComposerSend')
    await waitFor(() => expect(s.prepareWrite).toHaveBeenCalled())
    expect(s.sendRecord).not.toHaveBeenCalled()
  })

  test('on, but a room Keyring does not write these to: Copy only, and no profile read', async () => {
    const s = service([post('m1', 'Hi all')], { tier: 'private' })
    const tree = open(s)
    await longPress(tree, 'm1')
    expect(tree.queryByTestId(id('ChatReactionBar'))).toBeNull()
    expect(s.recordFeaturesIn).not.toHaveBeenCalled()
  })
})

describe('with sending on', () => {
  test("a room whose profile lists neither says they aren't on here yet, and offers Copy (frame 7)", async () => {
    const s = service([post('m1', 'Hi all')], { features: { listed: [], canSeal: true, unresolved: false } })
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalledWith(ROOM))
    await longPress(tree, 'm1')
    expect(tree.getByTestId(id('ChatMessageActionsNotice'))).toHaveTextContent('Rooms.RecordsNotOn')
    expect(tree.getByTestId(id('ChatActionCopy'))).toBeTruthy()
    expect(tree.queryByTestId(id('ChatReactionBar'))).toBeNull()
  })

  test('a room this phone saw take them, now listing neither, says they were on and are off now', async () => {
    const s = service([post('m1', 'Hi all')], {
      features: { listed: [], canSeal: true, unresolved: false, wereOn: { epoch: 3 } },
    })
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalledWith(ROOM))
    await longPress(tree, 'm1')
    expect(tree.getByTestId(id('ChatMessageActionsNotice'))).toHaveTextContent('Rooms.RecordsTurnedOff')
    expect(tree.getByTestId(id('ChatActionCopy'))).toBeTruthy()
    expect(tree.queryByTestId(id('ChatReactionBar'))).toBeNull()
    expect(tree.queryByTestId(id('ChatActionReply'))).toBeNull()
  })

  test('a room that still takes them says nothing of having been on (control)', async () => {
    const s = service([post('m1', 'Hi all')], { features: { ...EVERYTHING, wereOn: { epoch: 3 } } })
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    await longPress(tree, 'm1')
    expect(tree.getByTestId(id('ChatReactionBar'))).toBeTruthy()
    expect(tree.queryByTestId(id('ChatMessageActionsNotice'))).toBeNull()
  })

  test('an agent that does not seal them offers neither, whatever the profile lists', async () => {
    const s = service([post('m1', 'Hi all')], { features: { ...EVERYTHING, canSeal: false } })
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    await longPress(tree, 'm1')
    expect(tree.queryByTestId(id('ChatReactionBar'))).toBeNull()
    expect(tree.queryByTestId(id('ChatActionReply'))).toBeNull()
  })

  test('replies listed but not reactions: Reply, and no reaction bar', async () => {
    const s = service([post('m1', 'Hi all')], { features: { listed: ['inReplyTo'], canSeal: true, unresolved: false } })
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    await longPress(tree, 'm1')
    await waitFor(() => expect(tree.getByTestId(id('ChatActionReply'))).toBeTruthy())
    expect(tree.queryByTestId(id('ChatReactionBar'))).toBeNull()
    expect(tree.queryByTestId(id('ChatMessageActionsNotice'))).toBeNull()
  })

  test("another member's message: reactions, Reply and Copy, and no Edit or Withdraw (frame 5)", async () => {
    const s = service([post('m1', 'Hi all', { kind: 'message' })])
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    await longPress(tree, 'm1')
    await waitFor(() => expect(tree.getByTestId(id('ChatReactionBar'))).toBeTruthy())
    expect(tree.getByTestId(id('ChatActionReply'))).toBeTruthy()
    expect(tree.queryByTestId(id('ChatActionEdit'))).toBeNull()
    expect(tree.queryByTestId(id('ChatActionWithdraw'))).toBeNull()
  })

  test('your own message that says it is one: Edit and Withdraw too (frame 8); one that does not, neither', async () => {
    const s = service([
      post('typed', 'We meet at 5', { kind: 'message', author: ME }),
      post('plain', 'An older post', { author: ME }),
    ])
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    await longPress(tree, 'typed')
    await waitFor(() => expect(tree.getByTestId(id('ChatActionEdit'))).toBeTruthy())
    expect(tree.getByTestId(id('ChatActionWithdraw'))).toBeTruthy()
    await press(tree, 'ChatMessageActionsBackdrop')
    await longPress(tree, 'plain')
    await waitFor(() => expect(tree.getByTestId(id('ChatActionCopy'))).toBeTruthy())
    expect(tree.queryByTestId(id('ChatActionEdit'))).toBeNull()
  })

  test('a first reaction is a new record answering the post, at the version seen', async () => {
    const s = service([post('m1', 'Hi all', { version: 4 })])
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    await longPress(tree, 'm1')
    await press(tree, 'ChatReaction-0')
    await waitFor(() =>
      expect(s.sendRecord).toHaveBeenCalledWith(ROOM, {
        type: 'reaction',
        value: '👍',
        target: { key: 'm1', version: 4 },
      })
    )
    expect(s.sendRecord).toHaveBeenCalledTimes(1)
    // Shown once stored: the room is read again.
    await waitFor(() => expect(s.listNotes.mock.calls.length).toBeGreaterThan(1))
  })

  test('another value rewrites your reaction; the one you chose takes back every record holding it', async () => {
    const s = service([
      reaction('r2', 'm1', '👍', { author: ME }),
      reaction('r1', 'm1', '👍', { author: ME }),
      post('m1', 'Hi all'),
    ])
    const tree = open(s)
    await waitFor(() => expect(tree.getByTestId(id('RoomPostReactions'))).toBeTruthy())
    await longPress(tree, 'm1')
    // Yours is marked in the bar.
    expect(tree.getByTestId(id('ChatReaction-0')).props.accessibilityState).toEqual({ selected: true })
    await press(tree, 'ChatReaction-0')
    await waitFor(() => expect(s.sendRecord).toHaveBeenCalledTimes(2))
    expect(s.sendRecord.mock.calls.map(([, w]) => w)).toEqual([
      { type: 'withdraw', key: 'r2' },
      { type: 'withdraw', key: 'r1' },
    ])

    s.sendRecord.mockClear()
    await longPress(tree, 'm1')
    await press(tree, 'ChatReaction-1')
    await waitFor(() => expect(s.sendRecord).toHaveBeenCalledTimes(1))
    expect(s.sendRecord).toHaveBeenCalledWith(ROOM, { type: 'changeReaction', key: 'r2', value: '❤️' })
  })

  test('a reaction the room refuses says so in the reaction words, and why', async () => {
    const { RoomsRefused } = jest.requireActual('../types')
    const show = jest.spyOn(Toast, 'show')
    const s = service([post('m1', 'Hi all')], {
      sendRecord: async () => {
        throw new RoomsRefused('write', 'notYours', false, 'someone else wrote it')
      },
    })
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    await longPress(tree, 'm1')
    await press(tree, 'ChatReaction-0')
    await waitFor(() =>
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({ text1: 'Chat.ReactionNotSent', text2: 'Rooms.PostNotTaken' })
      )
    )
  })

  test('a write the room no longer takes says they are not on here, and the sheet follows what the refusal says', async () => {
    const show = jest.spyOn(Toast, 'show')
    const s = service([post('m1', 'Hi all')], {
      sendRecord: async () => {
        const e = Object.assign(new Error('this room cannot take kind'), {
          name: 'RecordMembersNotPermitted',
          refused: ['kind'],
          features: { listed: [], canSeal: true, unresolved: false },
        })
        throw e
      },
    })
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalledTimes(1))
    await longPress(tree, 'm1')
    await press(tree, 'ChatReaction-0')
    await waitFor(() => expect(show).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Rooms.RecordsNotOn' })))
    await longPress(tree, 'm1')
    await waitFor(() => expect(tree.getByTestId(id('ChatMessageActionsNotice'))).toBeTruthy())
    expect(tree.queryByTestId(id('ChatReactionBar'))).toBeNull()
    // Told, so not asked again.
    expect(s.recordFeaturesIn).toHaveBeenCalledTimes(1)
  })

  test('a write refused in a room this phone saw take them says they were on, in the toast and then the sheet', async () => {
    const show = jest.spyOn(Toast, 'show')
    const s = service([post('m1', 'Hi all')], {
      sendRecord: async () => {
        throw Object.assign(new Error('this room cannot take kind'), {
          name: 'RecordMembersNotPermitted',
          refused: ['kind'],
          features: { listed: [], canSeal: true, unresolved: false, wereOn: { epoch: 3 } },
        })
      },
    })
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalledTimes(1))
    await longPress(tree, 'm1')
    await press(tree, 'ChatReaction-0')
    await waitFor(() => expect(show).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Rooms.RecordsTurnedOff' })))
    await longPress(tree, 'm1')
    await waitFor(() =>
      expect(tree.getByTestId(id('ChatMessageActionsNotice'))).toHaveTextContent('Rooms.RecordsTurnedOff')
    )
  })

  test('a refusal that says nothing of the room reads its profile again', async () => {
    const s = service([post('m1', 'Hi all')], {
      sendRecord: async () => {
        throw Object.assign(new Error('refused'), { name: 'RecordMembersNotPermitted' })
      },
    })
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalledTimes(1))
    await longPress(tree, 'm1')
    await press(tree, 'ChatReaction-0')
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalledTimes(2))
  })

  test('Reply puts the words it answers above the field; Send writes a reply as a record, once (frame 3)', async () => {
    const s = service([post('m1', 'Thursday?', { version: 2 })])
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    await longPress(tree, 'm1')
    await press(tree, 'ChatActionReply')
    expect(tree.getByTestId(id('RoomComposerContextName'))).toHaveTextContent('river-stone')
    expect(tree.getByTestId(id('RoomComposerContextText'))).toHaveTextContent('Thursday?')
    // Words only while replying.
    expect(tree.queryByTestId(id('RoomComposerAttach'))).toBeNull()
    fireEvent.changeText(tree.getByTestId(id('RoomComposerInput')), 'Thursday works')
    await press(tree, 'RoomComposerSend')
    await waitFor(() => expect(s.sendRecord).toHaveBeenCalledTimes(1))
    const [, write] = s.sendRecord.mock.calls[0]
    expect(write).toEqual({
      type: 'message',
      body: 'Thursday works',
      inReplyTo: { key: 'm1', version: 2 },
      idempotencyKey: expect.any(String),
    })
    expect(s.prepareWrite).not.toHaveBeenCalled()
    expect(tree.queryByTestId(id('RoomComposerReplying'))).toBeNull()
  })

  test('a reply can be put away, and the next post answers nothing', async () => {
    const s = service([post('m1', 'Thursday?')])
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    await longPress(tree, 'm1')
    await press(tree, 'ChatActionReply')
    await press(tree, 'RoomComposerContextCancel')
    expect(tree.queryByTestId(id('RoomComposerReplying'))).toBeNull()
    fireEvent.changeText(tree.getByTestId(id('RoomComposerInput')), 'Hello')
    await press(tree, 'RoomComposerSend')
    await waitFor(() => expect(s.sendRecord).toHaveBeenCalledTimes(1))
    expect(s.sendRecord.mock.calls[0][1]).not.toHaveProperty('inReplyTo')
  })

  test('where the room takes kind, a plain post says it is a message, so it can be changed later', async () => {
    const s = service([post('m1', 'Hi all')])
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    fireEvent.changeText(tree.getByTestId(id('RoomComposerInput')), 'Hello')
    await press(tree, 'RoomComposerSend')
    await waitFor(() => expect(s.sendRecord).toHaveBeenCalledTimes(1))
    expect(s.sendRecord.mock.calls[0][1]).toEqual({
      type: 'message',
      body: 'Hello',
      idempotencyKey: expect.any(String),
    })
  })

  test('where it does not, a plain post still goes as a note', async () => {
    const s = service([post('m1', 'Hi all')], { features: { listed: ['inReplyTo'], canSeal: true, unresolved: false } })
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    fireEvent.changeText(tree.getByTestId(id('RoomComposerInput')), 'Hello')
    await press(tree, 'RoomComposerSend')
    await waitFor(() => expect(s.prepareWrite).toHaveBeenCalled())
    expect(s.sendRecord).not.toHaveBeenCalled()
  })

  test('Edit puts your words in the field, sends new words on the same record, and gives the draft back (frame 12)', async () => {
    const s = service([post('m1', 'We meet at 5', { kind: 'message', author: ME })])
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    const input = () => tree.getByTestId(id('RoomComposerInput'))
    fireEvent.changeText(input(), 'A half-written post')
    await longPress(tree, 'm1')
    await press(tree, 'ChatActionEdit')
    expect(tree.getByTestId(id('RoomComposerContextName'))).toHaveTextContent('Rooms.Editing')
    await waitFor(() => expect(input().props.value).toBe('We meet at 5'))
    fireEvent.changeText(input(), 'We meet at 6')
    await press(tree, 'RoomComposerSend')
    expect(s.sendRecord).toHaveBeenCalledWith(ROOM, { type: 'edit', key: 'm1', body: 'We meet at 6' })
    await waitFor(() => expect(tree.queryByTestId(id('RoomComposerEditing'))).toBeNull())
    await waitFor(() => expect(input().props.value).toBe('A half-written post'))
  })

  test('an edit that fails keeps its words in the field, and says so', async () => {
    const show = jest.spyOn(Toast, 'show')
    const s = service([post('m1', 'We meet at 5', { kind: 'message', author: ME })], {
      sendRecord: async () => {
        throw new Error('agent not reached')
      },
    })
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    await longPress(tree, 'm1')
    await press(tree, 'ChatActionEdit')
    fireEvent.changeText(tree.getByTestId(id('RoomComposerInput')), 'We meet at 6')
    await press(tree, 'RoomComposerSend')
    await waitFor(() => expect(show).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Rooms.EditNotSent' })))
    expect(tree.getByTestId(id('RoomComposerEditing'))).toBeTruthy()
    expect(tree.getByTestId(id('RoomComposerInput')).props.value).toBe('We meet at 6')
  })

  test('Withdraw asks first; "Keep it" sends nothing, Withdraw empties the record (frame 9)', async () => {
    const s = service([post('m1', 'We meet at 5', { kind: 'message', author: ME })])
    const tree = open(s)
    await waitFor(() => expect(s.recordFeaturesIn).toHaveBeenCalled())
    await longPress(tree, 'm1')
    await press(tree, 'ChatActionWithdraw')
    expect(tree.getByTestId(id('RoomWithdrawSheet'))).toBeTruthy()
    await press(tree, 'RoomWithdrawKeep')
    expect(tree.queryByTestId(id('RoomWithdrawSheet'))).toBeNull()
    expect(s.sendRecord).not.toHaveBeenCalled()

    await longPress(tree, 'm1')
    await press(tree, 'ChatActionWithdraw')
    await press(tree, 'RoomWithdrawConfirm')
    expect(s.sendRecord).toHaveBeenCalledWith(ROOM, { type: 'withdraw', key: 'm1' })
    expect(tree.queryByTestId(id('RoomWithdrawSheet'))).toBeNull()
  })
})

describe('the composer, when a send is waited for', () => {
  const compose = (onSend: () => Promise<boolean>) =>
    render(
      <BasicAppContext>
        <RoomComposer onSend={onSend} />
      </BasicAppContext>
    )

  test.each([
    ['answers no', async () => false],
    ['fails', async () => Promise.reject(new Error('not reached'))],
  ])('one that %s keeps the words in the field', async (_name, onSend) => {
    const tree = compose(onSend)
    fireEvent.changeText(tree.getByTestId(id('RoomComposerInput')), 'Still here')
    await press(tree as unknown as ReturnType<typeof open>, 'RoomComposerSend')
    expect(tree.getByTestId(id('RoomComposerInput')).props.value).toBe('Still here')
  })

  test('one that goes empties the field, and Send is held while it is on its way', async () => {
    let done: (ok: boolean) => void = () => undefined
    const onSend = jest.fn(() => new Promise<boolean>((resolve) => (done = resolve)))
    const tree = compose(onSend)
    fireEvent.changeText(tree.getByTestId(id('RoomComposerInput')), 'Going')
    await press(tree as unknown as ReturnType<typeof open>, 'RoomComposerSend')
    expect(tree.getByTestId(id('RoomComposerSend')).props.accessibilityState).toEqual({ disabled: true })
    await press(tree as unknown as ReturnType<typeof open>, 'RoomComposerSend')
    expect(onSend).toHaveBeenCalledTimes(1)
    await act(async () => done(true))
    expect(tree.getByTestId(id('RoomComposerInput')).props.value).toBe('')
  })
})
