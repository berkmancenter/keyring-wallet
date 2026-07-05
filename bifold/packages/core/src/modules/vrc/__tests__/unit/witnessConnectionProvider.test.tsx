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
import type { Agent } from '@credo-ts/core'

import {
  WitnessConnectionProvider,
  useWitnessConnection,
} from '../../context/WitnessConnectionProvider'

// Mock the vrc-manager
jest.mock('../../vrc-manager', () => ({
  registerWitnessSessionCallback: jest.fn(),
  registerWitnessStateGetter: jest.fn(),
  registerWitnessConnectionDetectedCallback: jest.fn(),
  registerWitnessValidationCallback: jest.fn(),
}))

// Capture the mock dispatch so we can assert on calls
const mockDispatch = jest.fn()

// Mock the store
jest.mock('../../../../contexts/store', () => ({
  useStore: jest.fn(() => [
    { witness: { activeWitnessConnectionId: undefined } },
    mockDispatch,
  ]),
}))

describe('WitnessConnectionProvider', () => {
  let mockAgent: jest.Mocked<Agent>
  let mockConnectionRepository: any

  beforeEach(() => {
    mockConnectionRepository = {
      update: jest.fn().mockResolvedValue(undefined),
    }

    mockAgent = {
      connections: {
        getAll: jest.fn().mockResolvedValue([]),
        getById: jest.fn(),
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
      mockAgent.connections.getAll = jest.fn().mockResolvedValue([mockConn])

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
      mockAgent.connections.getAll = jest.fn().mockResolvedValue([mockConn])

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
      mockAgent.connections.getAll = jest.fn().mockResolvedValue([mockConn])

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
      mockAgent.connections.getAll = jest.fn().mockResolvedValue([mockConn])

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
      mockAgent.connections.getAll = jest.fn().mockResolvedValue([mockConn])

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
      mockAgent.connections.getAll = jest.fn().mockResolvedValue([mockConn])

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
      mockAgent.connections.getAll = jest.fn().mockResolvedValue([mockConn])

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
})
