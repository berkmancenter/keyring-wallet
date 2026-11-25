/**
 * A build without the sample rooms: a store build, where the wallet's metro config resolves the sample module
 * to a stub. The flag on gives no service, and the Developer switch is offered only in a development build.
 */
import { renderHook } from '@testing-library/react-native'
import React from 'react'

import { ContainerProvider } from '../../../container-api'
import { roomsSwitchAvailable, sampleRoomsBundled, useRoomsService } from '../useRoomsService'

jest.mock('../../../contexts/store', () => ({ useStore: () => [{ preferences: { featureRooms: true } }, jest.fn()] }))
// What the stub exports: no sample service.
jest.mock('../sample/sampleRooms', () => ({ createSampleRoomsService: undefined }))

const noneRegistered = {
  resolve: (token: string) => {
    throw new Error(`unregistered ${token}`)
  },
}

describe('a build without the sample rooms', () => {
  test('knows it carries no sample', () => {
    expect(sampleRoomsBundled).toBe(false)
  })

  test('flag on, nothing registered: no service at all', () => {
    const { result } = renderHook(() => useRoomsService(), {
      wrapper: ({ children }: React.PropsWithChildren) => (
        <ContainerProvider value={noneRegistered as never}>{children}</ContainerProvider>
      ),
    })
    expect(result.current).toBeUndefined()
  })

  test('the Developer switch only in a development build', () => {
    const g = global as { __DEV__?: boolean }
    const dev = g.__DEV__
    try {
      g.__DEV__ = false
      expect(roomsSwitchAvailable()).toBe(false)
      g.__DEV__ = true
      expect(roomsSwitchAvailable()).toBe(true)
    } finally {
      g.__DEV__ = dev
    }
  })
})
