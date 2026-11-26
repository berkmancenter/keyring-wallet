/**
 * A room's screen tells the rooms service when the person navigates to it, and only then: the app coming back to the
 * foreground with the room still open is not the person entering it. That difference is what keeps a room they marked
 * unread on another device unread on this phone when they pick it up (real/readMarkers.ts).
 */
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import type { RoomsService } from '../types'
import { useInViewAndActive } from '../useInViewAndActive'
import { useRoomEntered } from '../useRoomEntered'

let mockFocused = true
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }))

let onAppState: ((state: string) => void) | undefined
const focus = (focused: boolean) => void (mockFocused = focused)
const serviceWith = (roomEntered = jest.fn()) =>
  ({ roomEntered }) as unknown as RoomsService & { roomEntered: jest.Mock }

beforeEach(() => {
  focus(true)
  Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true, configurable: true })
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, listener: (s: string) => void) => {
    onAppState = listener
    return { remove: jest.fn() }
  }) as never)
})
afterEach(() => jest.restoreAllMocks())

/** The room's screen as Room.tsx has it: in view while focused and the app is active, and telling when it is entered. */
const screen = (service: RoomsService | undefined, roomId = 'room:1') =>
  renderHook(
    (props: { service: RoomsService | undefined; roomId: string }) => {
      useRoomEntered(props.service, props.roomId)
      return useInViewAndActive()
    },
    { initialProps: { service, roomId } }
  )

describe('entering a room', () => {
  it('is told when the screen first shows', () => {
    const service = serviceWith()
    screen(service)
    expect(service.roomEntered.mock.calls).toEqual([['room:1']])
  })

  it('is not the app going to the background and coming back with the room still open, though the room leaves view and returns', () => {
    const service = serviceWith()
    const { result } = screen(service)
    act(() => onAppState?.('background'))
    expect(result.current).toBe(false)
    act(() => onAppState?.('active'))
    // In view again: what was hung on that transition would have fired here.
    expect(result.current).toBe(true)
    expect(service.roomEntered).toHaveBeenCalledTimes(1)
  })

  it('is navigating away and back (control)', () => {
    const service = serviceWith()
    const { rerender } = screen(service)
    focus(false)
    rerender({ service, roomId: 'room:1' })
    expect(service.roomEntered).toHaveBeenCalledTimes(1)
    focus(true)
    rerender({ service, roomId: 'room:1' })
    expect(service.roomEntered).toHaveBeenCalledTimes(2)
  })

  it('is told for another room shown on the same screen, and never while the screen is not focused', () => {
    const service = serviceWith()
    const { rerender } = screen(service)
    rerender({ service, roomId: 'room:2' })
    expect(service.roomEntered.mock.calls).toEqual([['room:1'], ['room:2']])
    focus(false)
    rerender({ service, roomId: 'room:3' })
    expect(service.roomEntered).toHaveBeenCalledTimes(2)
  })

  it('a service that arrives after the screen showed is told once; one that replaces another is not told again', () => {
    const first = serviceWith()
    const { rerender } = screen(undefined)
    rerender({ service: first, roomId: 'room:1' })
    expect(first.roomEntered).toHaveBeenCalledTimes(1)
    const second = serviceWith()
    rerender({ service: second, roomId: 'room:1' })
    expect(second.roomEntered).not.toHaveBeenCalled()
  })

  it('a service that keeps no markers is asked nothing (the sample)', () => {
    expect(() => screen({} as RoomsService)).not.toThrow()
  })
})
