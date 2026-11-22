/**
 * Which rooms service a screen gets: none with the flag off (and no sample is even made), the registered one
 * when the app has registered it, else the sample when the build carries it, else none. And the Developer
 * switch is offered only where a development build or the sample rooms can feed it.
 */
import { renderHook } from '@testing-library/react-native'
import React from 'react'

import { ContainerProvider, TOKENS } from '../../../container-api'
import type { RoomsService } from '../types'

const mockState = { preferences: { featureRooms: false } }
jest.mock('../../../contexts/store', () => ({ useStore: () => [mockState, jest.fn()] }))
const mockCreateSample = jest.fn()
jest.mock('../sample/sampleRooms', () => {
  const actual = jest.requireActual('../sample/sampleRooms')
  return {
    ...actual,
    createSampleRoomsService: (...args: unknown[]) => {
      mockCreateSample(...args)
      return actual.createSampleRoomsService(...args)
    },
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  useRoomsService,
  resetSampleRoomsService,
  roomsSwitchAvailable,
  sampleRoomsBundled,
} = require('../useRoomsService')

const containerWith = (registered?: RoomsService) => ({
  resolve: (token: string) => {
    if (token === TOKENS.UTIL_ROOMS_SERVICE && registered) return registered
    throw new Error(`unregistered ${token}`)
  },
})
const hook = (container: ReturnType<typeof containerWith>) =>
  renderHook(() => useRoomsService(), {
    wrapper: ({ children }: React.PropsWithChildren) => (
      <ContainerProvider value={container as never}>{children}</ContainerProvider>
    ),
  })

beforeEach(() => {
  mockState.preferences.featureRooms = false
  mockCreateSample.mockClear()
  resetSampleRoomsService()
})

describe('the rooms service a screen gets', () => {
  test('flag off: none, and no sample is made', () => {
    const { result } = hook(containerWith({ isSample: false } as RoomsService))
    expect(result.current).toBeUndefined()
    expect(mockCreateSample).not.toHaveBeenCalled()
  })

  test('flag on with a registered service: that one, not the sample', () => {
    mockState.preferences.featureRooms = true
    const real = { isSample: false } as RoomsService
    const { result } = hook(containerWith(real))
    expect(result.current).toBe(real)
    expect(mockCreateSample).not.toHaveBeenCalled()
  })

  test('flag on with nothing registered: the sample, one per app run', () => {
    mockState.preferences.featureRooms = true
    expect(sampleRoomsBundled).toBe(true)
    const first = hook(containerWith()).result.current
    const second = hook(containerWith()).result.current
    expect(first?.isSample).toBe(true)
    expect(second).toBe(first)
    expect(mockCreateSample).toHaveBeenCalledTimes(1)
  })
})

describe('a build carrying the sample rooms', () => {
  test('with the sample bundled, the switch is offered even outside a development build (an internal install)', () => {
    const dev = (global as { __DEV__?: boolean }).__DEV__
    try {
      ;(global as { __DEV__?: boolean }).__DEV__ = false
      expect(roomsSwitchAvailable()).toBe(true)
    } finally {
      ;(global as { __DEV__?: boolean }).__DEV__ = dev
    }
  })
})
