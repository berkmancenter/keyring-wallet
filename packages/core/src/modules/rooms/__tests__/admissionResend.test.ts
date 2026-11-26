/**
 * An accept answered "admission pending" is asked again after 30 s, 1, 2 and 5 min, in the foreground only, and the
 * member is told once when they're in. It stops at the first answer that isn't "still settling", when the offer's
 * terms are no longer the ones agreed, and when the member accepts again themselves; a try that fails to reach the
 * community waits for the next.
 */
import { act, renderHook } from '@testing-library/react-native'
import { AppState, DeviceEventEmitter } from 'react-native'

import { ADMISSION_RESEND_MS, resendAdmission, stopAllAdmissionResends } from '../admissionResend'
import { createSampleRoomsService } from '../sample/sampleRooms'
import { type OfferPreview, RoomsRefused, type RoomsService } from '../types'
import { ROOM_ADMITTED_EVENT, useRoomOffer } from '../useRoomOffer'

const OFFER = 'offer:did%3Awebvh%3Alab:planning'
const preview = (over: Partial<OfferPreview['offer']> = {}, token = 't'): OfferPreview =>
  ({
    token,
    offer: {
      offerId: OFFER,
      roomId: 'planning',
      roomName: 'Planning',
      communityDid: 'did:webvh:lab',
      communityName: 'Keyring Lab',
      tier: 'open',
      verbs: ['read', 'write'],
      ...over,
    },
    actingAs: { did: 'did:key:z6MkMe' },
  }) as OfferPreview

const pending = () => new RoomsRefused('acceptOffer', 'admissionPending', true)
let tokens = 0
const service = (accept: jest.Mock, now: () => OfferPreview = () => preview({}, `t${++tokens}`)) =>
  ({
    previewOffer: jest.fn(async () => now()),
    acceptOffer: accept,
  }) as unknown as RoomsService & { previewOffer: jest.Mock; acceptOffer: jest.Mock }

let heard: unknown[]
let sub: { remove: () => void }
let appState: string
let onAppState: ((s: string) => void) | undefined
beforeEach(() => {
  jest.useFakeTimers()
  heard = []
  sub = DeviceEventEmitter.addListener(ROOM_ADMITTED_EVENT, (e) => heard.push(e))
  appState = 'active'
  onAppState = undefined
  // A plain property on the mock: read through a getter for the test, put back after.
  Object.defineProperty(AppState, 'currentState', { get: () => appState, configurable: true })
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, listener: (s: string) => void) => {
    onAppState = listener
    return { remove: () => (onAppState = undefined) }
  }) as never)
})
const startState = AppState.currentState
afterEach(() => {
  Object.defineProperty(AppState, 'currentState', { value: startState, writable: true, configurable: true })
  stopAllAdmissionResends()
  sub.remove()
  jest.useRealTimers()
  jest.restoreAllMocks()
})

// One wait at a time: a single long advance would hide a chain that stalls or doubles.
const step = (ms: number) => act(async () => void (await jest.advanceTimersByTimeAsync(ms)))

describe('asking again after "admission pending"', () => {
  test('asked after 30 s, then 1 min; admitted on the second, said once, and nothing more is asked', async () => {
    const accept = jest.fn().mockRejectedValueOnce(pending()).mockResolvedValueOnce({ roomId: 'planning' })
    const s = service(accept)
    resendAdmission(s, preview())
    await step(ADMISSION_RESEND_MS[0] - 1)
    expect(accept).not.toHaveBeenCalled()
    await step(1)
    expect(accept).toHaveBeenCalledTimes(1)
    expect(heard).toEqual([])
    await step(ADMISSION_RESEND_MS[1])
    expect(accept).toHaveBeenCalledTimes(2)
    // Each try reads the offer again: a preview token is good for one accept.
    expect(accept.mock.calls.map((c) => c[0])).toEqual(['t1', 't2'])
    expect(heard).toEqual([{ roomId: 'planning', roomName: 'Planning' }])
    await step(ADMISSION_RESEND_MS[2])
    await step(ADMISSION_RESEND_MS[3])
    expect(accept).toHaveBeenCalledTimes(2)
    expect(heard).toHaveLength(1)
  })

  test('only in the foreground: a try due in the background waits for the app to come back', async () => {
    const accept = jest.fn().mockResolvedValue({ roomId: 'planning' })
    const s = service(accept)
    resendAdmission(s, preview())
    appState = 'background'
    await step(ADMISSION_RESEND_MS[0])
    expect(s.previewOffer).not.toHaveBeenCalled()
    appState = 'active'
    await act(async () => onAppState?.('active'))
    expect(accept).toHaveBeenCalledTimes(1)
    expect(heard).toHaveLength(1)
  })

  test('stops at a refusal that is the answer (the offer gone), and after the last wait', async () => {
    const gone = jest.fn().mockRejectedValue(new RoomsRefused('acceptOffer', 'notFound', false))
    resendAdmission(service(gone), preview())
    for (const ms of ADMISSION_RESEND_MS) await step(ms)
    expect(gone).toHaveBeenCalledTimes(1)

    const still = jest.fn().mockRejectedValue(pending())
    resendAdmission(service(still), preview())
    for (const ms of ADMISSION_RESEND_MS) await step(ms)
    expect(still).toHaveBeenCalledTimes(ADMISSION_RESEND_MS.length)
    await step(ADMISSION_RESEND_MS[3] * 2)
    expect(still).toHaveBeenCalledTimes(ADMISSION_RESEND_MS.length)
    expect(heard).toEqual([])
  })

  test('a try that does not reach the community waits for the next', async () => {
    const accept = jest
      .fn()
      .mockRejectedValueOnce(new Error('agent unreachable'))
      .mockResolvedValueOnce({ roomId: 'planning' })
    resendAdmission(service(accept), preview())
    await step(ADMISSION_RESEND_MS[0])
    await step(ADMISSION_RESEND_MS[1])
    expect(accept).toHaveBeenCalledTimes(2)
    expect(heard).toHaveLength(1)
  })

  test('an offer whose terms changed is not accepted: the member decides again', async () => {
    const accept = jest.fn().mockResolvedValue({ roomId: 'planning' })
    const s = service(accept, () => preview({ verbs: ['read', 'write', 'curate'] }, 'changed'))
    resendAdmission(s, preview())
    for (const ms of ADMISSION_RESEND_MS) await step(ms)
    expect(s.previewOffer).toHaveBeenCalledTimes(1)
    expect(accept).not.toHaveBeenCalled()
    expect(heard).toEqual([])
  })
})

describe('from the offer screen', () => {
  test('"admission pending" starts the tries; the member accepting again stops them', async () => {
    const s = createSampleRoomsService()
    const { result, unmount } = renderHook(() => useRoomOffer(s, 'o1'))
    await act(async () => undefined)
    const accept = jest.spyOn(s, 'acceptOffer').mockRejectedValueOnce(pending())
    const reread = jest.spyOn(s, 'previewOffer')
    await act(async () => void (await result.current.accept()))
    expect(accept).toHaveBeenCalledTimes(1)
    const readsBefore = reread.mock.calls.length
    await step(ADMISSION_RESEND_MS[0])
    expect(reread.mock.calls).toHaveLength(readsBefore + 1)
    expect(heard).toEqual([{ roomId: 'did:webvh:sample:kernel-notes', roomName: 'Kernel notes' }])
    unmount()
  })

  test('a refusal that is the answer starts nothing (control for the test above)', async () => {
    const s = createSampleRoomsService()
    const { result, unmount } = renderHook(() => useRoomOffer(s, 'o1'))
    await act(async () => undefined)
    jest.spyOn(s, 'acceptOffer').mockRejectedValueOnce(new RoomsRefused('acceptOffer', 'notAMember', false))
    const reread = jest.spyOn(s, 'previewOffer')
    await act(async () => void (await result.current.accept()))
    for (const ms of ADMISSION_RESEND_MS) await step(ms)
    expect(reread).not.toHaveBeenCalled()
    expect(heard).toEqual([])
    unmount()
  })

  test('the member accepting again stops tries already under way', async () => {
    const s = createSampleRoomsService()
    const { result, unmount } = renderHook(() => useRoomOffer(s, 'o1'))
    await act(async () => undefined)
    jest.spyOn(s, 'acceptOffer').mockRejectedValueOnce(pending()).mockRejectedValueOnce(new Error('offline'))
    await act(async () => void (await result.current.accept()))
    // Accepting again from the screen, before the first background try is due.
    await act(async () => void (await result.current.accept()))
    const reread = jest.spyOn(s, 'previewOffer')
    for (const ms of ADMISSION_RESEND_MS) await step(ms)
    expect(reread).not.toHaveBeenCalled()
    unmount()
  })
})
