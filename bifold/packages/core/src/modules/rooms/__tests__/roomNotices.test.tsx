/**
 * Room notices, said wherever the member is: a new room offer (a tap opens it), an admission, and a post that didn't
 * send while its room was not on screen (a tap sends it again, as the same event). Each is said once: an offer
 * already said is not said again after a lock (the navigator mounts again) or a relaunch (memory gone, the kept list
 * read back). The words are in en, fr and pt-BR.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, renderHook } from '@testing-library/react-native'
import i18n from 'i18next'
import { DeviceEventEmitter } from 'react-native'
import Toast from 'react-native-toast-message'

import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'
import { Screens, Stacks, TabStacks } from '../../../types/navigators'
import { sampleCapabilities } from '../capabilities'
import { ACCESS_KEPT_KEY, resetAccessKept } from '../roomAccess'
import {
  accessWords,
  OFFERS_SAID_KEY,
  offeredWords,
  postFailedWords,
  resetOffersSaid,
  useRoomNotices,
} from '../roomNotices'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { RoomOffer, RoomsService, RoomSummary } from '../types'
import { ROOM_ADMITTED_EVENT, useRoomOffer } from '../useRoomOffer'
import { refreshRoomRows, resetRoomRows } from '../useRoomRows'
import { ROOM_POST_FAILED_EVENT, useRoomSend } from '../useRoomSend'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
let mockService: RoomsService | undefined
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
const mockNavigate = jest.fn()
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}))
// The app's logger, the one service the notices take from the container: the rows poll logs through it.
const mockLogger = { info: jest.fn() }
jest.mock('../../../container-api', () => ({
  ...jest.requireActual('../../../container-api'),
  useServices: () => [mockLogger],
}))
jest.mock('../../trust-tasks/module/vtaAgent', () => ({
  vtaAgent: { subscribe: () => () => undefined, getState: () => ({ link: { kind: 'linked' } }) },
}))

const LAB = 'did:webvh:QmLab:lab.example'
const offer = (room: string): RoomOffer => ({
  offerId: `offer:${encodeURIComponent(LAB)}:${room}`,
  roomId: room,
  roomName: room as RoomOffer['roomName'],
  communityDid: LAB,
  communityName: 'Keyring Lab' as RoomOffer['communityName'],
  tier: 'open',
  verbs: ['read', 'write'],
})
const offering = (offers: () => RoomOffer[], isSample = false) =>
  ({
    isSample,
    capabilities: jest.fn(async () => sampleCapabilities()),
    listOffers: jest.fn(async () => offers()),
  }) as unknown as RoomsService & { listOffers: jest.Mock }

const flush = () => act(async () => undefined)
const navigate = mockNavigate
let show: jest.SpyInstance

beforeEach(async () => {
  resetOffersSaid()
  await AsyncStorage.setItem(OFFERS_SAID_KEY, '[]')
  navigate.mockClear()
  show = jest.spyOn(Toast, 'show').mockImplementation(() => undefined)
  jest.spyOn(Toast, 'hide').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

const toast = (n: number) => show.mock.calls[n][0]

describe('a new room offer', () => {
  test('is said once, wherever the member is, and a tap opens it; a lock or a relaunch does not say it again', async () => {
    let offers = [offer('planning')]
    const service = offering(() => offers)
    mockService = service
    const first = renderHook(() => useRoomNotices())
    await flush()
    expect(show).toHaveBeenCalledTimes(1)
    expect(toast(0)).toMatchObject({ text1: 'Rooms.NoticeOffered', text2: 'Rooms.NoticeSeeOffer', position: 'bottom' })
    act(() => toast(0).onPress())
    expect(navigate).toHaveBeenCalledWith(Stacks.TabStack, {
      screen: TabStacks.MessageStack,
      params: { screen: Screens.RoomOffer, initial: false, params: { offerRef: offers[0].offerId } },
    })
    first.unmount()

    // A lock and unlock: the navigator mounts again and asks at once.
    const relocked = renderHook(() => useRoomNotices())
    await flush()
    expect(service.listOffers).toHaveBeenCalledTimes(2)
    relocked.unmount()

    // A relaunch: what was in memory is gone, and the kept list is read back.
    resetOffersSaid()
    const relaunched = renderHook(() => useRoomNotices())
    await flush()
    expect(service.listOffers).toHaveBeenCalledTimes(3)
    expect(show).toHaveBeenCalledTimes(1)
    relaunched.unmount()

    // A second offer arrives: only it is said (control: the same poll does say a new one).
    offers = [offer('planning'), offer('welcome-desk')]
    const later = renderHook(() => useRoomNotices())
    await flush()
    expect(show).toHaveBeenCalledTimes(2)
    act(() => toast(1).onPress())
    expect(navigate).toHaveBeenLastCalledWith(Stacks.TabStack, {
      screen: TabStacks.MessageStack,
      params: { screen: Screens.RoomOffer, initial: false, params: { offerRef: offers[1].offerId } },
    })
    later.unmount()
  })

  test('the offers kept are short hashes, not the ids that name a community and room', async () => {
    mockService = offering(() => [offer('planning')])
    const hook = renderHook(() => useRoomNotices())
    await flush()
    const kept = (await AsyncStorage.getItem(OFFERS_SAID_KEY)) as string
    expect(JSON.parse(kept)).toEqual([expect.stringMatching(/^[0-9a-f]{16}$/)])
    expect(kept).not.toContain('planning')
    expect(kept).not.toContain('lab.example')
    hook.unmount()
  })

  test('several at once are counted, and a tap opens Messages, whose offers card lists them', async () => {
    mockService = offering(() => [offer('planning'), offer('welcome-desk')])
    const hook = renderHook(() => useRoomNotices())
    await flush()
    expect(show).toHaveBeenCalledTimes(1)
    expect(toast(0)).toMatchObject({ text1: 'Rooms.NoticeOfferedMany', text2: 'Rooms.NoticeSeeOffers' })
    act(() => toast(0).onPress())
    expect(navigate).toHaveBeenCalledWith(Stacks.TabStack, {
      screen: TabStacks.MessageStack,
      params: { screen: Screens.Messages },
    })
    hook.unmount()
  })

  test('the sample rooms say nothing: their offers are fixtures', async () => {
    const service = offering(() => [offer('planning')], true)
    mockService = service
    const hook = renderHook(() => useRoomNotices())
    await flush()
    expect(service.listOffers).toHaveBeenCalledTimes(1)
    expect(show).not.toHaveBeenCalled()
    hook.unmount()
  })
})

describe('an admission', () => {
  test('an accept the community answers is said; one that fails is not', async () => {
    const heard: unknown[] = []
    const sub = DeviceEventEmitter.addListener(ROOM_ADMITTED_EVENT, (e) => heard.push(e))
    try {
      const service = createSampleRoomsService()
      const refused = renderHook(() => useRoomOffer(service, 'o1'))
      await flush()
      jest.spyOn(service, 'acceptOffer').mockRejectedValueOnce(new Error('community unreachable'))
      await act(async () => void (await refused.result.current.accept()))
      expect(heard).toEqual([])
      await act(async () => void (await refused.result.current.accept()))
      expect(heard).toEqual([{ roomId: 'did:webvh:sample:kernel-notes', roomName: 'Kernel notes' }])
      refused.unmount()
    } finally {
      sub.remove()
    }

    mockService = undefined
    const hook = renderHook(() => useRoomNotices())
    act(() => {
      DeviceEventEmitter.emit(ROOM_ADMITTED_EVENT, { roomId: 'r', roomName: 'Kernel notes' })
    })
    expect(show).toHaveBeenCalledTimes(1)
    expect(toast(0)).toMatchObject({ type: 'success', text1: 'Rooms.NoticeAdmitted', position: 'bottom' })
    hook.unmount()
  })
})

describe("a post that didn't send", () => {
  const writing = () =>
    ({
      prepareWrite: jest.fn(async () => ({ token: 't' })),
      confirmWrite: jest.fn(async () => ({ key: 'note/1', version: 1 })),
    }) as unknown as RoomsService & { prepareWrite: jest.Mock; confirmWrite: jest.Mock }

  test('on screen it is marked in the room and says nothing more', async () => {
    const heard: unknown[] = []
    const sub = DeviceEventEmitter.addListener(ROOM_POST_FAILED_EVENT, (e) => heard.push(e))
    const service = writing()
    service.confirmWrite.mockRejectedValueOnce(new Error('agent unreachable'))
    const room = renderHook(() => useRoomSend(service, 'r1', () => undefined, { onScreen: true, roomName: 'Planning' }))
    await act(async () => void room.result.current.send('On my way.'))
    await flush()
    expect(room.result.current.pending.map((p) => p.state)).toEqual(['failed'])
    expect(heard).toEqual([])
    room.unmount()
    sub.remove()
  })

  test('away from its room it is said, still kept for the room, and a tap sends the same event again', async () => {
    mockService = undefined
    const notices = renderHook(() => useRoomNotices())
    const service = writing()
    const room = renderHook(() => useRoomSend(service, 'r1', () => undefined, { onScreen: true, roomName: 'Planning' }))
    let release: () => void = () => undefined
    service.confirmWrite.mockImplementationOnce(
      () => new Promise((_, reject) => (release = () => reject(new Error('agent unreachable'))))
    )
    await act(async () => void room.result.current.send('On my way.'))
    // The member leaves the room while it is still sending.
    room.unmount()
    await act(async () => release())
    expect(show).toHaveBeenCalledTimes(1)
    expect(toast(0)).toMatchObject({
      type: 'error',
      text1: 'Rooms.NoticePostFailed',
      text2: 'Rooms.NoticeTryAgain',
      position: 'bottom',
    })

    // Back in the room, the post is there, marked.
    const back = renderHook(() => useRoomSend(service, 'r1', () => undefined, { onScreen: false }))
    expect(back.result.current.pending.map((p) => [p.text, p.state])).toEqual([['On my way.', 'failed']])

    // The notice's tap sends it again, as the same event.
    await act(async () => toast(0).onPress())
    await flush()
    const keys = service.prepareWrite.mock.calls.map((c) => (c as unknown as [string, { idempotencyKey: string }])[1])
    expect(keys).toHaveLength(2)
    expect(keys[1].idempotencyKey).toBe(keys[0].idempotencyKey)
    expect(back.result.current.pending.map((p) => p.state)).toEqual(['sent'])
    back.unmount()
    notices.unmount()
  })
})

describe('room access', () => {
  const summary = (roomId: string, over: Partial<RoomSummary> = {}): RoomSummary => ({
    roomId,
    name: roomId as RoomSummary['name'],
    nameFrom: 'community',
    source: 'community',
    communityDid: LAB,
    tier: 'open',
    standing: 'member',
    ...over,
  })
  // The rows poll lists the member's rooms; reading each room's posts fails here, which the rows shrug off.
  const listing = (rooms: () => RoomSummary[], isSample = false) =>
    ({
      ...offering(() => [], isSample),
      listMyRooms: jest.fn(async () => rooms()),
    }) as unknown as RoomsService
  const soon = () => new Date(Date.now() + 5 * 86_400_000 + 60_000).toISOString()

  beforeEach(async () => {
    resetRoomRows()
    resetAccessKept()
    await AsyncStorage.setItem(ACCESS_KEPT_KEY, '{}')
  })

  test('access ending is said once, from the rows poll, and a tap opens the room in Messages', async () => {
    const rooms = [summary('planning', { validUntil: soon() })]
    mockService = listing(() => rooms)
    const notices = renderHook(() => useRoomNotices())
    await flush()
    await flush()
    const said = show.mock.calls.map(([options]) => options).filter((o) => o.text1 === 'Rooms.NoticeAccessEndsIn')
    expect(said).toHaveLength(1)
    expect(said[0]).toMatchObject({ type: 'warn', text2: 'Rooms.NoticeSeeRoom', position: 'bottom' })
    act(() => said[0].onPress())
    expect(navigate).toHaveBeenCalledWith(Stacks.TabStack, {
      screen: TabStacks.MessageStack,
      params: { screen: Screens.Room, initial: false, params: { roomId: 'planning' } },
    })

    refreshRoomRows()
    await flush()
    await flush()
    expect(show.mock.calls.filter(([o]) => o.text1 === 'Rooms.NoticeAccessEndsIn')).toHaveLength(1)
    notices.unmount()
  })

  test('several rooms ending at once are counted, and a tap opens Messages', async () => {
    mockService = listing(() => [summary('planning', { validUntil: soon() }), summary('board', { validUntil: soon() })])
    const notices = renderHook(() => useRoomNotices())
    await flush()
    await flush()
    const said = show.mock.calls.map(([o]) => o).filter((o) => o.text1 === 'Rooms.NoticeAccessEndingMany')
    expect(said).toHaveLength(1)
    act(() => said[0].onPress())
    expect(navigate).toHaveBeenCalledWith(Stacks.TabStack, {
      screen: TabStacks.MessageStack,
      params: { screen: Screens.Messages },
    })
    notices.unmount()
  })

  test('a room removed after it was seen is said, with nothing to open; one first seen removed is not', async () => {
    let rooms = [summary('planning'), summary('board', { standing: 'removed' })]
    mockService = listing(() => rooms)
    const notices = renderHook(() => useRoomNotices())
    await flush()
    await flush()
    expect(show.mock.calls.filter(([o]) => String(o.text1).startsWith('Rooms.NoticeRemoved'))).toHaveLength(0)

    rooms = [summary('planning', { standing: 'removed' }), summary('board', { standing: 'removed' })]
    refreshRoomRows()
    await flush()
    await flush()
    const said = show.mock.calls.map(([o]) => o).filter((o) => o.text1 === 'Rooms.NoticeRemoved')
    expect(said).toHaveLength(1)
    expect(said[0].onPress).toBeUndefined()
    notices.unmount()
  })

  test("the rows poll's line reaches the app's log, so a report says when the rows came", async () => {
    mockLogger.info.mockClear()
    mockService = listing(() => [summary('planning')])
    const notices = renderHook(() => useRoomNotices())
    await flush()
    await flush()
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/^\[Rooms:rows\] 1 rooms listed, /))
    notices.unmount()
  })

  test('the sample rooms say nothing', async () => {
    mockService = listing(() => [summary('planning', { validUntil: soon() })], true)
    const notices = renderHook(() => useRoomNotices())
    await flush()
    await flush()
    expect(show.mock.calls.filter(([o]) => String(o.text1).startsWith('Rooms.NoticeAccess'))).toHaveLength(0)
    notices.unmount()
  })
})

describe('the words', () => {
  test.each([
    ['en', en],
    ['fr', fr],
    ['pt-BR', ptBr],
  ])('%s: each names what it is about, with nothing left unfilled', async (lng, resources) => {
    const i = i18n.createInstance()
    await i.init({ lng, resources: { [lng]: { translation: resources } }, interpolation: { escapeValue: false } })
    const t = i.t.bind(i)
    const one = offeredWords([offer('planning')], t)
    const many = offeredWords([offer('planning'), offer('welcome-desk')], t)
    const said = [
      one.text1,
      one.text2,
      many.text1,
      many.text2,
      t('Rooms.NoticeAdmitted', { room: 'Planning' }),
      postFailedWords('Planning', t),
      postFailedWords(undefined, t),
      t('Rooms.NoticeTryAgain'),
    ]
    const planning = { roomId: 'planning', name: 'Planning' } as RoomSummary
    const board = { roomId: 'board', name: 'Board' } as RoomSummary
    const access = [
      accessWords({ kind: 'ending', rooms: [{ room: planning, days: 5 }] }, t),
      accessWords({ kind: 'ending', rooms: [{ room: planning, days: 1 }] }, t),
      accessWords({ kind: 'ending', rooms: [{ room: planning, days: 0 }] }, t),
      accessWords({ kind: 'gone', rooms: [{ room: planning, ended: false }] }, t),
      accessWords({ kind: 'gone', rooms: [{ room: planning, ended: true }] }, t),
    ]
    const counted = [
      accessWords(
        {
          kind: 'ending',
          rooms: [
            { room: planning, days: 5 },
            { room: board, days: 3 },
          ],
        },
        t
      ),
      accessWords(
        {
          kind: 'gone',
          rooms: [
            { room: planning, ended: false },
            { room: board, ended: true },
          ],
        },
        t
      ),
    ]
    for (const words of [...access, ...counted]) {
      expect(words.text1).not.toMatch(/\{\{|Rooms\./)
      if (words.text2) expect(words.text2).not.toMatch(/\{\{|Rooms\./)
    }
    for (const words of access) expect(words.text1).toContain('Planning')
    expect(access[0].text1).toContain('5')
    expect(new Set(access.map((w) => w.text1)).size).toBe(access.length)
    for (const words of counted) expect(words.text1).toContain('2')
    for (const words of said) {
      expect(words).not.toMatch(/\{\{|Rooms\./)
    }
    expect(one.text1).toContain('Keyring Lab')
    expect(many.text1).toContain('2')
    expect(said[4]).toContain('Planning')
    expect(said[5]).toContain('Planning')
  })
})
