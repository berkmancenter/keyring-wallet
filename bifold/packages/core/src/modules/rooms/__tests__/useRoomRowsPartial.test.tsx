/**
 * Each community's rooms on Messages as soon as that community answers (rooms/partialListingSwitch): the listing asks
 * every community together and waited for all of them, so one slow community held the fresh list (74 s in
 * BC46-XSQD while the other three had answered within seconds). A partial answer is drawn and its rooms read; the rows
 * of the communities still to answer stay as they were; the listing that ends replaces it all, exactly as before, and
 * nothing is kept, told or taken as the member's rooms from a partial one.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect } from '@react-navigation/native'
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import { newEventId } from '../../chat/eventId'
import { toInertText } from '../inertText'
import {
  bindMessageCache,
  keepRoomPosts,
  readRoomPosts,
  resetMessageCache,
  ROOMS_MESSAGE_CACHE,
  setMessageCacheBiometryGate,
} from '../messageCache'
import { ROOMS_PARTIAL_LISTING } from '../partialListingSwitch'
import { AgentRoomsService, type RoomsBackend } from '../real/agentRoomsService'
import { ROOMS_TASK } from '../real/wire'
import { chatMessageBody } from '../roomPosts'
import type { Note, NoteList, NoteSummary, RoomsService, RoomSummary } from '../types'
import { cacheWallet } from './fixtures/cacheWallet'
import {
  onRoomsListed,
  refreshRoomRows,
  resetRoomRows,
  ROOMS_HIDDEN_KEY,
  ROOMS_SEEN_KEY,
  useRoomRows,
  useRoomRowsPoll,
} from '../useRoomRows'

let mockSession: { sessionOpenedAt?: number } = {}
jest.mock('../../trust-tasks/module/vtaAgent', () => ({
  vtaAgent: { subscribe: () => () => undefined, getState: () => mockSession },
}))

const SAM = { did: 'did:key:z6MkSaddle', identityWords: 'Sam' }
const LAB = 'did:webvh:QmLab:lab.example'
const SEDI = 'did:webvh:QmSedi:sedi.example'
const CHOIR = 'did:webvh:QmChoir:choir.example'

const room = (roomId: string, communityDid: string): RoomSummary => ({
  roomId,
  name: toInertText(roomId),
  nameFrom: 'community',
  source: 'community',
  communityDid,
  communityName: toInertText(communityDid),
  tier: 'open',
  standing: 'member',
})
const note = (key: string, version: number): NoteSummary => ({
  key,
  version,
  author: SAM,
  updatedAt: new Date(Date.UTC(2026, 10, 18, 9, version)).toISOString(),
  status: 'active',
  pinned: false,
})

/**
 * A service whose listing answers `early` at once as a partial answer from `answered`, and resolves only when the
 * test says (`end`), with `all`, or fails (`fail`).
 */
function slowListing(early: RoomSummary[], answered: string[], all: RoomSummary[]) {
  const notes: Record<string, NoteSummary[]> = Object.fromEntries(
    all.map((r) => [r.roomId, [note(`${r.roomId}-1`, 1)]])
  )
  let end: (() => void) | undefined
  let fail: ((e: Error) => void) | undefined
  const service = {
    isSample: false,
    getRoom: jest.fn(async (roomId: string) => ({
      ...all.find((r) => r.roomId === roomId)!,
      actingAs: { did: 'did:peer:2.me' },
    })),
    listMyRooms: jest.fn(
      (options: { onPartial?: (rooms: RoomSummary[], answered: readonly string[]) => void } = {}) =>
        new Promise<RoomSummary[]>((resolve, reject) => {
          options.onPartial?.(early, answered)
          end = () => resolve(all)
          fail = reject
        })
    ),
    listNotes: jest.fn(
      async (roomId: string): Promise<NoteList> => ({
        notes: notes[roomId] ?? [],
        complete: true,
        check: { verdict: 'consistent', detail: '' },
      })
    ),
    readNote: jest.fn(
      async (roomId: string, key: string): Promise<Note> => ({
        ...(notes[roomId] ?? []).find((n) => n.key === key)!,
        body: toInertText(chatMessageBody(key, newEventId(), new Date())),
        flags: { containsLink: false, looksLikeInstruction: false },
        check: { verdict: 'consistent', detail: '' },
      })
    ),
  }
  return {
    service: service as unknown as RoomsService & typeof service,
    end: () => act(async () => end?.()),
    fail: (e: Error) => act(async () => fail?.(e)),
  }
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => undefined)
}
const mount = (service: RoomsService) => {
  renderHook(() => useRoomRowsPoll(service, true))
  return renderHook(() => useRoomRows())
}
const ids = (rows: { rows: readonly { roomId: string }[] }) => rows.rows.map((r) => r.roomId)

const SHIPPED = { ...ROOMS_PARTIAL_LISTING }
const told: RoomSummary[][] = []
let stopTelling: () => void = () => undefined
beforeEach(async () => {
  jest.useFakeTimers()
  resetRoomRows()
  await AsyncStorage.setItem(ROOMS_SEEN_KEY, '{}')
  await AsyncStorage.setItem(ROOMS_HIDDEN_KEY, '{}')
  mockSession = {}
  ;(useFocusEffect as jest.Mock).mockImplementation(() => undefined)
  Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true, configurable: true })
  jest.spyOn(AppState, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as never)
  Object.assign(ROOMS_PARTIAL_LISTING, { on: true, remoteOff: false })
  told.length = 0
  stopTelling = onRoomsListed((_s, rooms) => void told.push(rooms))
})
afterEach(() => {
  stopTelling()
  Object.assign(ROOMS_PARTIAL_LISTING, SHIPPED)
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('a community that has not answered yet', () => {
  it('does not hold back the others: their rows show, and are read, before the listing ends', async () => {
    const lab = room('planning', LAB)
    const sedi = room('vetting', SEDI)
    const l = slowListing([lab], [LAB], [lab, sedi])
    const list = mount(l.service)
    await flush()
    expect(ids(list.result.current)).toEqual(['planning'])
    expect(list.result.current.rows[0].lastPost?.text).toBe('planning-1')
    expect(list.result.current.rows[0].reading).toBeFalsy()
    // Nothing is told of a partial answer: no listener (the message cache's emptyings among them) hears it.
    expect(told).toEqual([])

    await l.end()
    await flush()
    expect(ids(list.result.current)).toEqual(['planning', 'vetting'])
    expect(told).toHaveLength(1)
    // The room read for the partial answer is not read again for the listing.
    expect(l.service.listNotes.mock.calls.filter(([roomId]) => roomId === 'planning')).toHaveLength(1)
  })

  it('keeps the rows it had of a community still to answer, as they were, until the listing ends', async () => {
    const lab = room('planning', LAB)
    const sedi = room('vetting', SEDI)
    // A first listing that read both.
    const first = slowListing([], [], [lab, sedi])
    const list = mount(first.service)
    await flush()
    await first.end()
    await flush()
    expect(ids(list.result.current)).toEqual(['planning', 'vetting'])

    // The next one: the lab answers, the SEDI community is still out.
    const next = slowListing([lab], [LAB], [lab, sedi])
    first.service.listMyRooms.mockImplementation(next.service.listMyRooms)
    await act(async () => refreshRoomRows())
    await flush()
    expect(ids(list.result.current)).toEqual(['planning', 'vetting'])
    await next.end()
    await flush()
    expect(ids(list.result.current)).toEqual(['planning', 'vetting'])
  })

  it('control: every community answering gives the same rows, in the same order, as with the switch off', async () => {
    const rooms = [room('b-room', SEDI), room('a-room', LAB), room('c-room', CHOIR)]
    const on = slowListing([rooms[1]], [LAB], rooms)
    const listOn = mount(on.service)
    await flush()
    await on.end()
    await flush()
    const withPartial = listOn.result.current.rows.map((r) => [r.roomId, r.lastPost?.text])

    resetRoomRows()
    Object.assign(ROOMS_PARTIAL_LISTING, { remoteOff: true })
    const off = slowListing([rooms[1]], [LAB], rooms)
    const listOff = mount(off.service)
    await flush()
    // Off: no partial answer is asked for, and nothing shows until the listing ends.
    expect(off.service.listMyRooms).toHaveBeenCalledWith({})
    expect(ids(listOff.result.current)).toEqual([])
    await off.end()
    await flush()
    expect(listOff.result.current.rows.map((r) => [r.roomId, r.lastPost?.text])).toEqual(withPartial)
  })

  // A guard on the property, not on today's mechanism (ac): a partial listing is one where the rooms of the communities
  // still to answer are absent because nobody has answered yet, never because they are gone, and it must never cost a
  // person their kept chats. Today no path could (no listener hears a partial: the first row; and emptyGoneRooms empties
  // only rooms a listing names as gone), so no mutant of today's code fails here; a later change that routes partials
  // into anything that empties absent rooms would.
  it("never empties the kept posts of a community still to answer, with the message cache's listeners bound", async () => {
    const SHIPPED_CACHE = { ...ROOMS_MESSAGE_CACHE }
    Object.assign(ROOMS_MESSAGE_CACHE, { on: true, remoteOff: false })
    setMessageCacheBiometryGate(async () => true)
    resetMessageCache()
    try {
      const ME = 'did:peer:2.me'
      const wallet = cacheWallet()
      // Bound as the app binds it: its onRoomsListed listener (emptyGoneRooms) hears every listing told.
      await bindMessageCache(wallet, async () => [
        { communityDid: LAB, personaDid: ME },
        { communityDid: SEDI, personaDid: ME },
      ])
      await keepRoomPosts(
        wallet,
        { personaDid: ME, roomId: 'vetting', communityDid: SEDI },
        [{ key: 'v1', version: 1, author: 'did:peer:them', writtenAt: new Date().toISOString(), body: 'kept words' }],
        Date.now()
      )
      const lab = room('planning', LAB)
      const sedi = room('vetting', SEDI)
      const l = slowListing([lab], [LAB], [lab, sedi])
      Object.assign(l.service, { runsOn: wallet })
      const list = mount(l.service)
      await flush()
      expect(ids(list.result.current)).toEqual(['planning'])
      expect((await readRoomPosts(wallet, ME, 'vetting'))?.posts.map((p) => p.body)).toEqual(['kept words'])
      await l.end()
      await flush()
      expect((await readRoomPosts(wallet, ME, 'vetting'))?.posts.map((p) => p.body)).toEqual(['kept words'])
    } finally {
      resetMessageCache()
      Object.assign(ROOMS_MESSAGE_CACHE, SHIPPED_CACHE)
    }
  })

  it('control: no community answering fails as today, the rows read before kept', async () => {
    const l = slowListing([], [], [])
    const list = mount(l.service)
    await flush()
    await l.fail(new Error('no community answered'))
    await flush()
    expect(list.result.current.failed).toBe(true)
    expect(ids(list.result.current)).toEqual([])
    expect(told).toEqual([])
  })
})

describe("the rooms service's partial answers", () => {
  /** A rooms service over the lab and SEDI communities; SEDI's listing waits for `sediAnswers`. */
  function serviceOver(sedi: 'answers' | 'unreachable' | 'waits') {
    let release: () => void = () => undefined
    const sediWaits = new Promise<void>((resolve) => (release = resolve))
    const backend = {
      runsOn: undefined,
      agentLinked: () => true,
      agentServedTypes: async () => [ROOMS_TASK.keysList02, ROOMS_TASK.keysRead, ROOMS_TASK.keysBrowse04],
      agentTask: jest.fn(async () => ({ rooms: [] })),
      communities: async () => [
        { did: LAB, personaDid: 'did:peer:2.me' },
        { did: SEDI, personaDid: 'did:peer:2.me' },
      ],
      communityTask: jest.fn(async (communityDid: string) => {
        const item = (roomId: string) => ({
          roomId,
          host: communityDid,
          visibility: 'open',
          state: 'admitted',
          label: roomId,
        })
        if (communityDid === LAB) return { items: [item('planning')] }
        if (sedi === 'unreachable') throw new Error('network down')
        if (sedi === 'waits') await sediWaits
        return { items: [item('vetting')] }
      }),
      sendCompleted: jest.fn(async () => ({})),
      newId: () => 'id-1',
      leaveCommunity: jest.fn(async () => undefined),
      decodeBase64Url: (v: string) => Buffer.from(v, 'base64url').toString('utf8'),
      encodeBase64Url: (v: string) => Buffer.from(v, 'utf8').toString('base64url'),
      hiddenOffers: async () => [],
      hideOffer: jest.fn(async () => undefined),
      warn: jest.fn(),
    } as unknown as RoomsBackend
    return { service: new AgentRoomsService(backend, undefined, { sleep: async () => undefined }), release }
  }
  const settle = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  }

  it("tells each community's rooms as it answers, never after the listing ends", async () => {
    jest.useRealTimers()
    const { service, release } = serviceOver('waits')
    const partials: [string[], readonly string[]][] = []
    const listing = service.listMyRooms({
      onPartial: (rooms, answered) => partials.push([rooms.map((r) => r.roomId), answered]),
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(partials).toEqual([[['planning'], [LAB]]])
    release()
    const all = await listing
    expect(all.map((r) => r.roomId)).toEqual(['planning', 'vetting'])
    // Nothing is told once the listing has ended (the last community's answer may come with the end, harmlessly: the
    // listing replaces it).
    const toldByTheEnd = partials.length
    await settle()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(partials).toHaveLength(toldByTheEnd)
  })

  it("a partial answer is not the member's rooms: a room it holds is read only from the listing", async () => {
    jest.useRealTimers()
    const { service, release } = serviceOver('waits')
    const listing = service.listMyRooms({ onPartial: () => undefined })
    await new Promise((resolve) => setTimeout(resolve, 10))
    let got = false
    const room = service.getRoom('planning').then(() => (got = true))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(got).toBe(false)
    release()
    await listing
    await room
    expect(got).toBe(true)
  })

  it("control: the failure rules are the final listing's: one community unreachable still lists the other", async () => {
    jest.useRealTimers()
    const { service } = serviceOver('unreachable')
    const all = await service.listMyRooms({ onPartial: () => undefined })
    expect(all.map((r) => r.roomId)).toEqual(['planning'])
  })

  it('control: switched off, nothing is told', async () => {
    jest.useRealTimers()
    Object.assign(ROOMS_PARTIAL_LISTING, { remoteOff: true })
    const { service } = serviceOver('answers')
    const onPartial = jest.fn()
    await service.listMyRooms({ onPartial })
    expect(onPartial).not.toHaveBeenCalled()
  })
})
