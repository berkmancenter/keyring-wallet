/**
 * Unit tests for WitnessConnectionProvider
 *
 * Tests the new witness connection management:
 * - Restoring witness connections on mount
 * - Setting active witness
 * - Removing witness connections
 * - Auto-activation when announcement received
 * - State management via getState()
 */

import React from 'react'
import { renderHook, act } from '@testing-library/react-native'
import { Platform } from 'react-native'
import type { Agent } from '@credo-ts/core'

import {
  WitnessConnectionProvider,
  useWitnessConnection,
} from '../../context/WitnessConnectionProvider'

// Capture the announcement callback the provider registers, so tests can
// invoke it directly the way vrc-manager would on a real `witness-announcement`.
const mockRegisterWitnessConnectionDetectedCallback = jest.fn()
jest.mock('../../vrc-manager', () => ({
  registerWitnessSessionCallback: jest.fn(),
  registerWitnessStateGetter: jest.fn(),
  registerWitnessConnectionDetectedCallback: (cb: unknown) =>
    mockRegisterWitnessConnectionDetectedCallback(cb),
  registerWitnessValidationCallback: jest.fn(),
}))

type WitnessLocalitySupport = 'off' | 'offered' | 'required'

const mockQueryWitnessDiscovery = jest.fn(async () => undefined)
// Defaults to 'offered' — the common case of a witness that supports
// locality but doesn't require it — so existing "a preflight is scheduled"
// tests below keep exercising that path unless they override it.
const mockGetWitnessLocalitySupport = jest.fn(async () => 'offered' as WitnessLocalitySupport | null)
jest.mock('../../../trust-tasks/ceremony', () => ({
  queryWitnessDiscovery: (...args: unknown[]) => mockQueryWitnessDiscovery(...args),
  getWitnessLocalitySupport: (...args: unknown[]) => mockGetWitnessLocalitySupport(...args),
}))

// Capture the mock dispatch so we can assert on calls
const mockDispatch = jest.fn()

const DEFAULT_STORE = {
  witness: { activeWitnessConnectionId: undefined },
  preferences: { useLocalityConfirmation: true, hasSeenLocalityPreflight: false },
}

// Mock the store. The factory creates its OWN jest.fn() (no reference to a
// later `const` in this file, which the hoisted jest.mock() call would see
// as undefined) — the actual store data is wired in via `mockUseStore`
// below, obtained from the mocked module itself once it's safe to.
jest.mock('../../../../contexts/store', () => ({
  useStore: jest.fn(),
}))
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockUseStore = require('../../../../contexts/store').useStore as jest.Mock
mockUseStore.mockImplementation(() => [DEFAULT_STORE, mockDispatch])

describe('WitnessConnectionProvider', () => {
  let mockAgent: jest.Mocked<Agent>
  let mockConnectionRepository: any

  beforeEach(() => {
    mockConnectionRepository = {
      update: jest.fn().mockResolvedValue(undefined),
    }

    mockAgent = {
      modules: {
        didcomm: {
          connections: {
            getAll: jest.fn().mockResolvedValue([]),
            getById: jest.fn(),
          },
        },
      },
      dependencyManager: {
        resolve: jest.fn().mockReturnValue(mockConnectionRepository),
      },
      context: {},
    } as any

    jest.clearAllMocks()
  })

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <WitnessConnectionProvider agent={mockAgent}>{children}</WitnessConnectionProvider>
  )

  describe('Initial state', () => {
    it('should start with no witness connections', async () => {
      const { result } = renderHook(() => useWitnessConnection(), { wrapper })

      expect(result.current.allWitnessConnections).toEqual([])
      expect(result.current.connectedWitness).toBeUndefined()
      expect(result.current.isWitnessConnected()).toBe(false)
    })

    it('should restore witness connections from agent on mount', async () => {
      const mockConn = {
        id: 'conn-123',
        state: 'completed',
        metadata: {
          get: jest.fn().mockReturnValue({
            name: 'Test Witness',
            issuerDid: 'did:peer:witness123',
            connectedAt: new Date().toISOString(),
          }),
        },
      }
      mockAgent.modules.didcomm.connections.getAll = jest.fn().mockResolvedValue([mockConn])

      const { result } = renderHook(() => useWitnessConnection(), { wrapper })

      // Wait for the useEffect to run
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

      expect(result.current.allWitnessConnections).toHaveLength(1)
      expect(result.current.allWitnessConnections[0].name).toBe('Test Witness')
    })
  })

  describe('Active witness management', () => {
    it('should set active witness', async () => {
      const mockConn = {
        id: 'conn-123',
        state: 'completed',
        metadata: {
          get: jest.fn().mockReturnValue({
            name: 'Test Witness',
            issuerDid: 'did:peer:witness123',
            connectedAt: new Date().toISOString(),
          }),
        },
      }
      mockAgent.modules.didcomm.connections.getAll = jest.fn().mockResolvedValue([mockConn])

      const { result } = renderHook(() => useWitnessConnection(), { wrapper })

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

      act(() => {
        result.current.setActiveWitness('conn-123')
      })

      expect(result.current.isWitnessConnected()).toBe(true)
      expect(result.current.connectedWitness?.connectionId).toBe('conn-123')
    })

    it('should deactivate witness via disconnectWitness', async () => {
      const mockConn = {
        id: 'conn-123',
        state: 'completed',
        metadata: {
          get: jest.fn().mockReturnValue({
            name: 'Test Witness',
            issuerDid: 'did:peer:witness123',
            connectedAt: new Date().toISOString(),
          }),
        },
      }
      mockAgent.modules.didcomm.connections.getAll = jest.fn().mockResolvedValue([mockConn])

      const { result } = renderHook(() => useWitnessConnection(), { wrapper })

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

      act(() => {
        result.current.setActiveWitness('conn-123')
      })

      expect(result.current.isWitnessConnected()).toBe(true)

      act(() => {
        result.current.disconnectWitness()
      })

      expect(result.current.isWitnessConnected()).toBe(false)
      expect(result.current.connectedWitness).toBeUndefined()
    })
  })

  describe('getState()', () => {
    it('should return undefined connectedWitness when no active witness', () => {
      const { result } = renderHook(() => useWitnessConnection(), { wrapper })

      const state = result.current.getState()
      expect(state.connectedWitness).toBeUndefined()
    })

    it('should return active witness as connectedWitness', async () => {
      const mockConn = {
        id: 'conn-123',
        state: 'completed',
        metadata: {
          get: jest.fn().mockReturnValue({
            name: 'IIW Fall 2026',
            issuerDid: 'did:peer:witness123',
            connectedAt: new Date().toISOString(),
          }),
        },
      }
      mockAgent.modules.didcomm.connections.getAll = jest.fn().mockResolvedValue([mockConn])

      const { result } = renderHook(() => useWitnessConnection(), { wrapper })

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

      act(() => {
        result.current.setActiveWitness('conn-123')
      })

      const state = result.current.getState()
      expect(state.connectedWitness).toBeDefined()
      expect(state.connectedWitness?.name).toBe('IIW Fall 2026')
    })
  })

  describe('Persistence', () => {
    it('should dispatch UPDATE_WITNESS_SETTINGS when setting active witness', async () => {
      const mockConn = {
        id: 'conn-123',
        state: 'completed',
        metadata: {
          get: jest.fn().mockReturnValue({
            name: 'Test Witness',
            issuerDid: 'did:peer:witness123',
            connectedAt: new Date().toISOString(),
          }),
        },
      }
      mockAgent.modules.didcomm.connections.getAll = jest.fn().mockResolvedValue([mockConn])

      const { result } = renderHook(() => useWitnessConnection(), { wrapper })

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

      mockDispatch.mockClear()

      act(() => {
        result.current.setActiveWitness('conn-123')
      })

      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'witness/updateSettings',
        payload: [{ activeWitnessConnectionId: 'conn-123' }],
      })
    })

    it('should dispatch UPDATE_WITNESS_SETTINGS with undefined when disconnecting', async () => {
      const mockConn = {
        id: 'conn-123',
        state: 'completed',
        metadata: {
          get: jest.fn().mockReturnValue({
            name: 'Test Witness',
            issuerDid: 'did:peer:witness123',
            connectedAt: new Date().toISOString(),
          }),
        },
      }
      mockAgent.modules.didcomm.connections.getAll = jest.fn().mockResolvedValue([mockConn])

      const { result } = renderHook(() => useWitnessConnection(), { wrapper })

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

      act(() => {
        result.current.setActiveWitness('conn-123')
      })

      mockDispatch.mockClear()

      act(() => {
        result.current.disconnectWitness()
      })

      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'witness/updateSettings',
        payload: [{ activeWitnessConnectionId: undefined }],
      })
    })

    it('should restore active witness from stored ID on mount', async () => {
      const { useStore } = require('../../../../contexts/store')
      useStore.mockReturnValue([
        { witness: { activeWitnessConnectionId: 'conn-123' } },
        mockDispatch,
      ])

      const mockConn = {
        id: 'conn-123',
        state: 'completed',
        metadata: {
          get: jest.fn().mockReturnValue({
            name: 'Persisted Witness',
            issuerDid: 'did:peer:persisted123',
            connectedAt: new Date().toISOString(),
          }),
        },
      }
      mockAgent.modules.didcomm.connections.getAll = jest.fn().mockResolvedValue([mockConn])

      const { result } = renderHook(() => useWitnessConnection(), { wrapper })

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      // Should have restored the connection list
      expect(result.current.allWitnessConnections).toHaveLength(1)
      expect(result.current.allWitnessConnections[0].name).toBe('Persisted Witness')
    })
  })

  describe('Session management', () => {
    it('should set and clear active session', () => {
      const { result } = renderHook(() => useWitnessConnection(), { wrapper })

      const session = {
        sessionId: 'session-123',
        challenge: 'challenge-abc',
        domain: 'example.com',
        createdAt: new Date(),
      }

      act(() => {
        result.current.setActiveSession(session)
      })

      expect(result.current.activeSession?.sessionId).toBe('session-123')

      act(() => {
        result.current.clearActiveSession()
      })

      expect(result.current.activeSession).toBeUndefined()
    })
  })

  describe('Locality pre-flight (locality-plan.md §10.3 item 8)', () => {
    const originalPlatformOs = Platform.OS

    afterEach(() => {
      Platform.OS = originalPlatformOs
      mockUseStore.mockReturnValue([DEFAULT_STORE, mockDispatch])
    })

    async function announceWitness(overrides?: { eventName?: string }) {
      mockAgent.modules.didcomm.connections.getById = jest.fn().mockResolvedValue({
        id: 'conn-witness-1',
        did: 'did:peer:mine',
        theirDid: 'did:peer:witness123',
        metadata: { set: jest.fn() },
      })
      const { result } = renderHook(() => useWitnessConnection(), { wrapper })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      const handler = mockRegisterWitnessConnectionDetectedCallback.mock.calls.at(-1)?.[0] as (
        connectionId: string,
        announcement: { name: string; did: string; eventName?: string | null }
      ) => Promise<void>
      await act(async () => {
        await handler('conn-witness-1', {
          name: 'e2e-witness',
          did: 'did:peer:witness123',
          eventName: overrides?.eventName ?? null,
        })
      })
      return result
    }

    it('schedules a preflight prompt on Android when the setting is on and unseen', async () => {
      Platform.OS = 'android'
      const result = await announceWitness({ eventName: 'IIW Fall 2026' })

      expect(result.current.localityPreflight?.witness.eventName).toBe('IIW Fall 2026')
      expect(result.current.localityPreflight?.required).toBe(false)
    })

    it('does not schedule a prompt on iOS', async () => {
      Platform.OS = 'ios'
      const result = await announceWitness()

      expect(result.current.localityPreflight).toBeUndefined()
    })

    it('does not schedule a prompt once already seen this install', async () => {
      Platform.OS = 'android'
      mockUseStore.mockReturnValue([
        { ...DEFAULT_STORE, preferences: { ...DEFAULT_STORE.preferences, hasSeenLocalityPreflight: true } },
        mockDispatch,
      ])
      const result = await announceWitness()

      expect(result.current.localityPreflight).toBeUndefined()
    })

    it('does not schedule a prompt when locality confirmation is already off', async () => {
      Platform.OS = 'android'
      mockUseStore.mockReturnValue([
        { ...DEFAULT_STORE, preferences: { ...DEFAULT_STORE.preferences, useLocalityConfirmation: false } },
        mockDispatch,
      ])
      const result = await announceWitness()

      expect(result.current.localityPreflight).toBeUndefined()
    })

    it('carries required:true through when discovery confirms it', async () => {
      Platform.OS = 'android'
      mockGetWitnessLocalitySupport.mockResolvedValueOnce('required')
      const result = await announceWitness()

      expect(result.current.localityPreflight?.required).toBe(true)
    })

    it('fails open to required:false if the discovery check throws', async () => {
      Platform.OS = 'android'
      mockGetWitnessLocalitySupport.mockRejectedValueOnce(new Error('no answer'))
      const result = await announceWitness()

      expect(result.current.localityPreflight?.required).toBe(false)
    })

    it('does not schedule a prompt when the witness discovery-declares no locality leg at all', async () => {
      Platform.OS = 'android'
      mockGetWitnessLocalitySupport.mockResolvedValueOnce('off')
      const result = await announceWitness()

      expect(result.current.localityPreflight).toBeUndefined()
    })

    it('resolveLocalityPreflight(true) marks it seen without touching the locality setting', async () => {
      Platform.OS = 'android'
      const result = await announceWitness()
      expect(result.current.localityPreflight).toBeDefined()

      act(() => {
        result.current.resolveLocalityPreflight(true)
      })

      expect(result.current.localityPreflight).toBeUndefined()
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'preferences/markLocalityPreflightSeen' })
      )
      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'preferences/useLocalityConfirmation' })
      )
    })

    it('resolveLocalityPreflight(false) marks it seen AND turns the locality setting off', async () => {
      Platform.OS = 'android'
      const result = await announceWitness()

      act(() => {
        result.current.resolveLocalityPreflight(false)
      })

      expect(result.current.localityPreflight).toBeUndefined()
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'preferences/useLocalityConfirmation',
        payload: [false],
      })
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'preferences/markLocalityPreflightSeen' })
      )
    })
  })
})
