/**
 * After an inactivity lock and the PIN, the app opens where the person was
 * (utils/navReturn.ts); after a log out it does not. Drives the real
 * AuthProvider's lockOutUser, with the store and services stubbed.
 */
import { render } from '@testing-library/react-native'
import React, { useContext } from 'react'
import { DeviceEventEmitter } from 'react-native'

import { AuthContext, AuthProvider, LockoutReason } from '../src/contexts/auth'
import { Screens, Stacks } from '../src/types/navigators'
import { noteNavigationState, restoreReturnState, setReturnNavigationRef } from '../src/utils/navReturn'
import { WALLET_LOCKED_EVENT } from '../src/utils/walletLocked'

const mockDispatch = jest.fn()
jest.mock('../src/contexts/store', () => ({
  useStore: () => [
    { onboarding: {}, preferences: {}, migration: {}, authentication: { didAuthenticate: true } },
    mockDispatch,
  ],
}))
jest.mock('../src/container-api', () => ({
  TOKENS: { FN_PIN_HASH_ALGORITHM: 'hash', UTIL_LOGGER: 'logger' },
  useServices: () => [jest.fn(), { info: jest.fn(), warn: jest.fn(), error: jest.fn() }],
}))

const chatOpen = {
  type: 'stack',
  index: 1,
  routes: [{ name: Stacks.TabStack }, { name: Screens.Chat, params: { connectionId: 'conn-1' } }],
}

function lockWith(reason: LockoutReason) {
  let auth: AuthContext | undefined
  const Probe = () => {
    auth = useContext(AuthContext)
    return null
  }
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  )
  ;(auth as AuthContext).lockOutUser(reason)
}

describe('the screen after a lock', () => {
  const ref = { isReady: () => true, resetRoot: jest.fn() }
  beforeEach(() => {
    ref.resetRoot.mockClear()
    setReturnNavigationRef(ref as any)
    noteNavigationState(chatOpen as any)
  })

  it('an inactivity lock comes back to the open chat', () => {
    lockWith(LockoutReason.Timeout)
    expect(restoreReturnState(Screens.MyAgent)).toBe(true)
    const state = ref.resetRoot.mock.calls[0][0]
    expect(state.routes[state.index]).toMatchObject({ name: Screens.Chat, params: { connectionId: 'conn-1' } })
  })

  it('a log out does not', () => {
    lockWith(LockoutReason.Logout)
    expect(restoreReturnState(Screens.MyAgent)).toBe(false)
    expect(ref.resetRoot).not.toHaveBeenCalled()
  })
})

// What is kept only while the wallet is open (bring back's card reads) goes on both.
describe('a lock or a log out is told to what is kept while unlocked', () => {
  it.each([LockoutReason.Timeout, LockoutReason.Logout])('%s', (reason) => {
    const heard = jest.fn()
    const sub = DeviceEventEmitter.addListener(WALLET_LOCKED_EVENT, heard)
    lockWith(reason)
    sub.remove()
    expect(heard).toHaveBeenCalledWith(reason)
  })
})
