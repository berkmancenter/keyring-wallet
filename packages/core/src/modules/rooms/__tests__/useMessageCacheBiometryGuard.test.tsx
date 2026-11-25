/** Biometric unlock turned off, wherever it is turned off, empties the rooms' kept posts at once (rooms/messageCache). */
import { renderHook } from '@testing-library/react-native'
import React from 'react'

import { StoreContext } from '../../../contexts/store'
import { useMessageCacheBiometryGuard } from '../useMessageCacheBiometryGuard'

const mockNote = jest.fn(async (_on: boolean) => undefined)
jest.mock('../messageCache', () => ({ noteBiometricUnlock: (on: boolean) => mockNote(on) }))

const withBiometry = (useBiometry: boolean) => {
  const value = [{ preferences: { useBiometry } }, jest.fn()] as never
  return ({ children }: { children: React.ReactNode }) => (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  )
}

beforeEach(() => mockNote.mockClear())

it('says biometric unlock is off the moment it goes off, once', () => {
  let on = true
  const hook = renderHook(() => useMessageCacheBiometryGuard(), {
    wrapper: ({ children }) => withBiometry(on)({ children }),
  })
  expect(mockNote.mock.calls).toEqual([[true]])
  on = false
  hook.rerender({})
  hook.rerender({})
  expect(mockNote.mock.calls).toEqual([[true], [false]])
})

it('control: on throughout, it says on once and nothing more', () => {
  const hook = renderHook(() => useMessageCacheBiometryGuard(), { wrapper: withBiometry(true) })
  hook.rerender({})
  expect(mockNote.mock.calls).toEqual([[true]])
})
