/**
 * A room whose read is refused over a version stops reading (IN-814): its row said nothing and span for ever, and the
 * rows were read again and again for it. Its row now says who needs an update, the retries stop, and the log line
 * says who refused and the versions named. Any other failure keeps the row reading and is tried again, as before.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect } from '@react-navigation/native'
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import { newEventId } from '../../chat/eventId'
import { toInertText } from '../inertText'
import { chatMessageBody } from '../roomPosts'
import type { Note, NoteList, NoteSummary, RoomsService, RoomSummary } from '../types'
import {
  refreshRoomRows,
  resetRoomRows,
  ROOMS_HIDDEN_KEY,
  ROOMS_SEEN_KEY,
  ROWS_RETRY_MS,
  useRoomRows,
  useRoomRowsPoll,
} from '../useRoomRows'

jest.mock('../../trust-tasks/module/vtaAgent', () => ({
  vtaAgent: { subscribe: () => () => undefined, getState: () => ({}) },
}))

const ME = { did: 'did:key:z6MkMe' }
const SAM = { did: 'did:key:z6MkSaddle', identityWords: 'Sam' }
const LAB = 'did:webvh:QmLab:lab.example'
const SPEC = 'https://trusttasks.org/spec/'

const room = (roomId: string): RoomSummary => ({
  roomId,
  name: toInertText(roomId),
  nameFrom: 'community',
  source: 'community',
  communityDid: LAB,
  tier: 'open',
  standing: 'member',
})
const note = (key: string, version: number): NoteSummary => ({
  key,
  version,
  author: SAM,
  updatedAt: new Date(Date.UTC(2026, 10, 26, 9, version)).toISOString(),
  status: 'active',
  pinned: false,
})
const refusal = (code: string, message: string, details?: unknown) =>
  Object.assign(new Error(message), { name: 'VtiRefusal', code, details })
/** The agent passing on a host that serves `served` where it was asked for `asked` (vta-service `host_failure`). */
const hostServes = (asked: string, served: string[]) => {
  const reason = `unsupported version: ${SPEC}rooms/records/list/${asked} — this VTC serves ${served
    .map((v) => `${SPEC}rooms/records/list/${v}`)
    .join(', ')}`
  return refusal('rooms/keys/browse:hostRefused', `room host refused: unsupportedVersion: ${reason}`, {
    code: 'unsupportedVersion',
    reason,
  })
}

/** Two rooms. `planning` reads normally; what `integration`'s listing does is the test's to say. */
function serviceWith(integration: () => Promise<NoteList>) {
  const rooms = [room('planning'), room('integration')]
  const listed = (notes: NoteSummary[]): NoteList => ({
    notes,
    complete: true,
    check: { verdict: 'consistent', detail: '' },
  })
  const service = {
    isSample: false,
    listMyRooms: jest.fn(async () => rooms),
    getRoom: jest.fn(async (roomId: string) => ({ ...rooms.find((r) => r.roomId === roomId)!, actingAs: ME })),
    listNotes: jest.fn(async (roomId: string, options?: { sinceVersion?: number }) =>
      roomId === 'integration'
        ? integration()
        : listed([note('n1', 1)].filter((n) => options?.sinceVersion === undefined || n.version > options.sinceVersion))
    ),
    readNote: jest.fn(
      async (_roomId: string, key: string): Promise<Note> => ({
        ...note(key, 1),
        body: toInertText(chatMessageBody(`the words of ${key}`, newEventId(), new Date())),
        flags: { containsLink: false, looksLikeInstruction: false },
        check: { verdict: 'consistent', detail: '' },
      })
    ),
  }
  return { service: service as unknown as RoomsService & typeof service, listed }
}

beforeEach(async () => {
  jest.useFakeTimers()
  resetRoomRows()
  await AsyncStorage.setItem(ROOMS_SEEN_KEY, '{}')
  await AsyncStorage.setItem(ROOMS_HIDDEN_KEY, '{}')
  ;(useFocusEffect as jest.Mock).mockImplementation(() => undefined)
  Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true, configurable: true })
  jest.spyOn(AppState, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as never)
})
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

const flush = () => act(async () => undefined)
const step = (ms: number) => act(async () => void (await jest.advanceTimersByTimeAsync(ms)))
const mount = (service: RoomsService) => {
  const lines: string[] = []
  renderHook(() => useRoomRowsPoll(service, true, (line) => lines.push(line)))
  const list = renderHook(() => useRoomRows())
  const row = (roomId: string) => list.result.current.rows.find((r) => r.roomId === roomId)!
  return { lines, row }
}

describe('a room whose host does not serve the version the agent asks it in', () => {
  test('its row stops reading and says it can’t be read yet; the other room reads as ever', async () => {
    const { service } = serviceWith(async () => Promise.reject(hostServes('0.8', ['0.5', '0.6'])))
    const { row } = mount(service)
    await flush()
    // A host's refusal passed on has only words, and who is behind is not read from words (readNotComing).
    expect(row('integration')).toMatchObject({ cannotRead: 'cannotTell' })
    expect(row('integration').reading).toBeUndefined()
    expect(row('integration').lastPost).toBeUndefined()
    expect(row('planning').cannotRead).toBeUndefined()
    expect(row('planning').reading).toBeUndefined()
    expect(row('planning').lastPost?.text).toBe('the words of n1')
  })

  test('the log says who refused and the versions named, and counts the room apart from those not read yet', async () => {
    const { service } = serviceWith(async () => Promise.reject(hostServes('0.8', ['0.5', '0.6'])))
    const { lines } = mount(service)
    await flush()
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^\[Rooms:rows\] integration of .+ not read: refused \(unsupportedVersion\) by the room's host; its words name rooms\/records\/list 0\.8, rooms\/records\/list 0\.5, rooms\/records\/list 0\.6$/
      )
    )
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^\[Rooms:rows\] 2 rooms listed, 0 not read yet, 1 that an update has to come for, in \d+ ms$/
      )
    )
  })

  test('the rows are not read again for it: no retry is armed', async () => {
    const { service } = serviceWith(async () => Promise.reject(hostServes('0.8', ['0.5', '0.6'])))
    mount(service)
    await flush()
    expect(service.listMyRooms).toHaveBeenCalledTimes(1)
    await step(ROWS_RETRY_MS[0] + ROWS_RETRY_MS[1] + ROWS_RETRY_MS[2] + 1000)
    expect(service.listMyRooms).toHaveBeenCalledTimes(1)
  })

  test('once the host serves it, the next read fills the row and the words go', async () => {
    let updated = false
    const { service, listed } = serviceWith(async () =>
      updated ? listed([note('i1', 1)]) : Promise.reject(hostServes('0.8', ['0.5', '0.6']))
    )
    const { row } = mount(service)
    await flush()
    expect(row('integration').cannotRead).toBe('cannotTell')
    updated = true
    act(() => refreshRoomRows())
    await flush()
    expect(row('integration').cannotRead).toBeUndefined()
    expect(row('integration').reading).toBeUndefined()
    expect(row('integration').lastPost?.text).toBe('the words of i1')
  })

  test('where the refusal has details that say it, the row names the side: the agent, Keyring, or the community', async () => {
    const details = (own: string, task: string, asked: string, served: string[], inner?: string) =>
      refusal(own, 'unsupported version', {
        ...(inner ? { code: inner } : {}),
        requestedType: `${SPEC}${task}/${asked}`,
        servedVersions: served.map((v) => `${SPEC}${task}/${v}`),
      })
    const cases: [Error, string][] = [
      // The agent's own refusal of what Keyring asked.
      [details('unsupportedVersion', 'rooms/keys/browse', '0.6', ['0.4', '0.5']), 'agentNeedsUpdate'],
      [details('unsupportedVersion', 'rooms/keys/browse', '0.6', ['0.7']), 'appNeedsUpdate'],
      // A host's refusal passed on with details: no agent sends this today.
      [
        details('rooms/keys/browse:hostRefused', 'rooms/records/list', '0.8', ['0.6'], 'unsupportedVersion'),
        'communityNeedsUpdate',
      ],
    ]
    for (const [failure, side] of cases) {
      resetRoomRows()
      const { service } = serviceWith(async () => Promise.reject(failure))
      const { row } = mount(service)
      await flush()
      expect(row('integration').cannotRead).toBe(side)
    }
  })
})

describe('the control: a failure that asking again may get past', () => {
  test.each([
    ['an agent not ready', () => new Error('agent not ready'), 'failed'],
    [
      'a host that could not be reached',
      () => refusal('rooms/keys/browse:hostUnreachable', 'room host could not be reached: did not answer'),
      'refused \\(hostUnreachable: noAnswer\\)',
    ],
  ])(
    '%s: the row keeps reading, says nothing of an update, and the rows are read again',
    async (_case, failure, kind) => {
      const { service } = serviceWith(async () => Promise.reject(failure()))
      const { row, lines } = mount(service)
      await flush()
      expect(row('integration').reading).toBe(true)
      expect(row('integration').cannotRead).toBeUndefined()
      expect(lines).toContainEqual(
        expect.stringMatching(new RegExp(`^\\[Rooms:rows\\] integration of .+ not read: ${kind}$`))
      )
      expect(lines).toContainEqual(expect.stringMatching(/^\[Rooms:rows\] 2 rooms listed, 1 not read yet, in \d+ ms$/))
      expect(service.listMyRooms).toHaveBeenCalledTimes(1)
      await step(ROWS_RETRY_MS[0] + 100)
      expect(service.listMyRooms).toHaveBeenCalledTimes(2)
    }
  )

  test('a room refused for good, then failing another way, reads again: something changed', async () => {
    let failure: Error = hostServes('0.8', ['0.6'])
    const { service } = serviceWith(async () => Promise.reject(failure))
    const { row } = mount(service)
    await flush()
    expect(row('integration').cannotRead).toBe('cannotTell')
    failure = new Error('agent not ready')
    act(() => refreshRoomRows())
    await flush()
    expect(row('integration').cannotRead).toBeUndefined()
    expect(row('integration').reading).toBe(true)
  })
})
