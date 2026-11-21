/**
 * A prune's catch-up and the agent session together (#832 with #815): when the full listing a prune calls for fails,
 * the failure is the poll's, sent on the session it was sent on. A session opened since asks again (#815); the same
 * session does not, so the ticks owed after a failure still pass first.
 */
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import type { AgentSession } from '../agentSession'
import { toInertText } from '../inertText'
import type { Note, NoteList, NoteSummary, RoomsService } from '../types'
import { ROOM_POLL_MS, useRoomPosts } from '../useRoomPosts'

let mockSession: AgentSession = { reconnecting: false, openedAt: 1 }
const mockSessionListeners = new Set<() => void>()
jest.mock('../agentSession', () => {
  const { useSyncExternalStore } = jest.requireActual('react')
  return {
    useAgentSession: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          mockSessionListeners.add(listener)
          return () => mockSessionListeners.delete(listener)
        },
        () => mockSession
      ),
  }
})
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }))

const ROOM = 'did:webvh:r:one'
const ME = { did: 'did:peer:2.me' }
const CONSISTENT = { verdict: 'consistent' as const, detail: '' }
const note = (key: string, version: number): Note => ({
  key,
  version,
  status: 'active',
  pinned: false,
  updatedAt: `2026-10-30T09:${String(version).padStart(2, '0')}:00Z`,
  author: { did: 'did:peer:them' },
  body: toInertText(`post ${key}`),
  flags: { containsLink: false, looksLikeInstruction: false },
  check: CONSISTENT,
})
const summaryOf = ({ body: _b, flags: _f, check: _c, ...summary }: Note): NoteSummary => summary

const flush = () => act(async () => undefined)
const tick = async () => {
  await act(async () => jest.advanceTimersByTime(ROOM_POLL_MS))
  await flush()
}

beforeEach(() => {
  jest.useFakeTimers()
  mockSession = { reconnecting: false, openedAt: 1 }
  jest.spyOn(AppState, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as never)
})
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

test("a prune's full listing that fails waits out its ticks on the same session, and asks again on a new one", async () => {
  const records = [note('a', 1), note('b', 2), note('c', 3)]
  let pruned = false
  let fullListings = 0
  const listNotes = jest.fn(async (_roomId: string, options: { sinceVersion?: number } = {}): Promise<NoteList> => {
    if (options.sinceVersion === undefined && ++fullListings > 1) throw new Error('the agent did not answer')
    const held = records.filter((n) => !(pruned && n.key === 'b'))
    return {
      notes: held.filter((n) => n.version > (options.sinceVersion ?? 0)).map(summaryOf),
      complete: true,
      check: CONSISTENT,
      ...(pruned ? { lastPrune: { version: 4, prunedAt: '2026-10-30T12:00:00Z', removed: 1 } } : {}),
    }
  })
  const service = {
    listNotes,
    readNote: jest.fn(async (_roomId: string, key: string) => records.find((n) => n.key === key)),
  } as unknown as RoomsService
  const asked = () => listNotes.mock.calls.map(([, o]) => o?.sinceVersion)

  const { result } = renderHook(() => useRoomPosts(service, ROOM, ME, true, true))
  for (let i = 0; i < 4; i++) await flush()
  pruned = true
  await tick()
  for (let i = 0; i < 4; i++) await flush()
  // The first listing, the poll that found the prune, and the full listing it called for, which failed.
  expect(asked()).toEqual([undefined, 3, undefined])
  expect(result.current.pollFailed).toBe(true)

  // The same session: nothing more until the owed ticks pass.
  for (let i = 0; i < 4; i++) await flush()
  expect(asked()).toEqual([undefined, 3, undefined])

  // A session opened since: asked again at once.
  await act(async () => {
    mockSession = { reconnecting: false, openedAt: 2 }
    mockSessionListeners.forEach((listener) => listener())
  })
  for (let i = 0; i < 4; i++) await flush()
  expect(asked()).toEqual([undefined, 3, undefined, 3])
})
