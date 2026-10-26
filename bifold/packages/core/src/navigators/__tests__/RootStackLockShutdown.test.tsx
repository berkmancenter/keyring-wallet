/**
 * A fast re-unlock started a new agent while the lock-out's shutdown of the old one was still running: two agents on
 * one Askar store. RootStack's start waits for that shutdown and proceeds only once the old store reads closed
 * (utils/lockShutdown.ts).
 */
import { act, render } from '@testing-library/react-native'
import React from 'react'

import RootStack from '../RootStack'

jest.mock('@bifold/react-hooks', () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => children,
}))
jest.mock('@credo-ts/askar', () => ({ AskarStoreManager: class AskarStoreManager {} }))
jest.mock('../MainStack', () => () => null)
jest.mock('../../modules/vrc/components/RelationshipProposalModal', () => () => null)
jest.mock('../../modules/vrc/components/ContinuityCheckModal', () => () => null)
jest.mock('../../modules/vrc/components/LocalityPreflightModal', () => () => null)
jest.mock('../../modules/trust-tasks/components/CredentialExchangeQueryModal', () => () => null)
jest.mock('../../modules/openid/context/OpenIDCredentialRecordProvider', () => ({
  OpenIDCredentialRecordProvider: ({ children }: { children: unknown }) => children,
}))
jest.mock('../../modules/vrc/context/VrcNameCacheProvider', () => ({
  VrcNameCacheProvider: ({ children }: { children: unknown }) => children,
}))
jest.mock('../../modules/vrc/context/WitnessConnectionProvider', () => ({
  WitnessConnectionProvider: ({ children }: { children: unknown }) => children,
}))
jest.mock('../../contexts/activity', () => ({ ActivityProvider: ({ children }: { children: unknown }) => children }))
jest.mock('../../contexts/biometric-confirmation', () => ({
  BiometricConfirmationProvider: ({ children }: { children: unknown }) => children,
}))
// The draft flush is chat/draft.ts's own concern; here the shutdown runs once it is done.
jest.mock('../../modules/chat/draft', () => ({
  afterChatDrafts: (shutdown: () => Promise<void>) => Promise.resolve().then(shutdown),
}))

const mockStore = { stateLoaded: true, authentication: { didAuthenticate: true } }
jest.mock('../../contexts/store', () => ({ useStore: () => [mockStore, jest.fn()] }))

/** The old agent's Askar store, as its store manager reports it. */
const mockStores = { open: true, isStoreOpen: jest.fn(), closeStore: jest.fn() }
const mockOldAgent = { context: {}, dependencyManager: { resolve: () => mockStores } }
let mockAgent: unknown = mockOldAgent
let mockFinishShutdown: () => void = () => undefined
const mockShutdown = jest.fn(
  () =>
    new Promise<void>((resolve) => {
      mockFinishShutdown = resolve
    })
)
const mockInitializeAgent = jest.fn(async () => undefined)
let mockStart: (walletSecret: unknown) => Promise<void> = async () => undefined
jest.mock('../../container-api', () => ({
  TOKENS: { HOOK_USE_AGENT_SETUP: 'agentSetup', STACK_ONBOARDING: 'onboarding', LOAD_STATE: 'loadState' },
  useServices: () => [
    () => ({ agent: mockAgent, initializeAgent: mockInitializeAgent, shutdownAndClearAgentIfExists: mockShutdown }),
    ({ initializeAgent }: { initializeAgent: (walletSecret: unknown) => Promise<void> }) => {
      mockStart = initializeAgent
      return null
    },
    jest.fn(async () => undefined),
  ],
}))

const secret = { id: 'wallet', key: 'key', salt: 'salt' }

/** Lets every pending promise callback run. */
const settle = () => act(async () => await new Promise((resolve) => setImmediate(resolve)))

/**
 * Mounts unlocked with the old agent running, then locks out: the lock-out's shutdown starts (once the draft flush
 * has settled) and is left running.
 */
const lockOut = async () => {
  mockStore.authentication.didAuthenticate = true
  const view = render(<RootStack />)
  mockStore.authentication.didAuthenticate = false
  view.rerender(<RootStack />)
  await settle()
  expect(mockShutdown).toHaveBeenCalledTimes(1)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAgent = mockOldAgent
  mockStores.open = true
  mockStores.isStoreOpen.mockImplementation(() => mockStores.open)
  mockStores.closeStore.mockImplementation(async () => undefined)
})

describe('RootStack: a start after a lock-out waits for the old agent to let go of its store', () => {
  it('does not start a new agent while the lock-out shutdown is still running', async () => {
    await lockOut()
    const started = mockStart(secret)
    await settle()
    expect(mockInitializeAgent).not.toHaveBeenCalled()

    // The shutdown completes and closed the store.
    mockStores.open = false
    mockFinishShutdown()
    await act(async () => await started)
    expect(mockInitializeAgent).toHaveBeenCalledWith(secret)
  })

  it('refuses when the old store is still open after the shutdown, and Retry starts once it has closed', async () => {
    await lockOut()
    // A module's shutdown threw before credo closed the store, and closing it directly fails too.
    mockStores.closeStore.mockImplementation(async () => {
      throw new Error('Error closing store')
    })
    const started = mockStart(secret)
    mockFinishShutdown()
    await act(async () => await expect(started).rejects.toThrow('RootStack.LastSessionNotClosed'))
    expect(mockInitializeAgent).not.toHaveBeenCalled()

    // Splash's Retry calls the same start again: it re-checks the same shutdown's store, now closed.
    mockStores.open = false
    await act(async () => await mockStart(secret))
    expect(mockInitializeAgent).toHaveBeenCalledWith(secret)
  })

  it('closes a store the shutdown left open, and then starts', async () => {
    await lockOut()
    mockStores.closeStore.mockImplementation(async () => {
      mockStores.open = false
    })
    const started = mockStart(secret)
    mockFinishShutdown()
    await act(async () => await started)
    expect(mockStores.closeStore).toHaveBeenCalledTimes(1)
    expect(mockInitializeAgent).toHaveBeenCalledWith(secret)
  })

  it('at launch, with no agent yet, the start is not held', async () => {
    mockAgent = undefined
    mockStore.authentication.didAuthenticate = false
    render(<RootStack />)
    await settle()
    expect(mockShutdown).toHaveBeenCalledTimes(1)
    const started = mockStart(secret)
    mockFinishShutdown()
    await act(async () => await started)
    expect(mockInitializeAgent).toHaveBeenCalledWith(secret)
    expect(mockStores.isStoreOpen).not.toHaveBeenCalled()
  })

  it('a start with no lock-out before it is not held', async () => {
    mockStore.authentication.didAuthenticate = true
    render(<RootStack />)
    expect(mockShutdown).not.toHaveBeenCalled()
    await act(async () => await mockStart(secret))
    expect(mockInitializeAgent).toHaveBeenCalledWith(secret)
  })
})
