/**
 * Tests for useWitnessErrorDialog hook
 *
 * Tests the hook that provides state and handlers for the WitnessErrorDialog component.
 * The hook subscribes to vrcFlowStore error events and manages dialog visibility.
 */

import { renderHook, act, waitFor } from '@testing-library/react-native'
import { EventEmitter } from 'events'

import type { VrcFlowError, VrcFlowErrorType } from '../../../../src/modules/vrc/witnessStatusStore'

// Create a mock vrcFlowStore
const createMockVrcFlowStore = () => {
  const emitter = new EventEmitter()
  const flowErrors = new Map<string, VrcFlowError>()

  return {
    ...emitter,
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      emitter.on(event, handler)
      return emitter
    }),
    off: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      emitter.off(event, handler)
      return emitter
    }),
    emit: jest.fn((event: string, ...args: unknown[]) => {
      return emitter.emit(event, ...args)
    }),
    setError: jest.fn((connectionId: string, error: Omit<VrcFlowError, 'timestamp'>) => {
      const fullError: VrcFlowError = { ...error, timestamp: new Date() }
      flowErrors.set(connectionId, fullError)
      emitter.emit('flowError', { connectionId, error: fullError })
    }),
    getError: jest.fn((connectionId: string) => flowErrors.get(connectionId)),
    getErrorConnections: jest.fn(() => Array.from(flowErrors.keys())),
    clearError: jest.fn((connectionId: string) => {
      flowErrors.delete(connectionId)
      emitter.emit('flowErrorCleared', { connectionId })
    }),
    clearFlow: jest.fn((connectionId: string) => {
      flowErrors.delete(connectionId)
    }),
    // Expose internal map for test manipulation
    _flowErrors: flowErrors,
    _emitter: emitter,
  }
}

// Type for our mock store
type MockVrcFlowStore = ReturnType<typeof createMockVrcFlowStore>

let mockVrcFlowStore: MockVrcFlowStore

// Mock the witnessStatusStore module
jest.mock('../../../../src/modules/vrc/witnessStatusStore', () => ({
  get vrcFlowStore() {
    return mockVrcFlowStore
  },
}))

// Import the hook after mocking
import { useWitnessErrorDialog } from '../../../../src/modules/vrc/hooks/useWitnessErrorDialog'

// Helper to create a test error
const createTestError = (
  type: VrcFlowErrorType = 'network-error',
  overrides: Partial<VrcFlowError> = {}
): VrcFlowError => ({
  type,
  message: 'Test error message',
  witnessName: 'Test Witness',
  contactName: 'Test Contact',
  timestamp: new Date(),
  ...overrides,
})

describe('useWitnessErrorDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVrcFlowStore = createMockVrcFlowStore()
  })

  afterEach(() => {
    // Clean up any remaining listeners
    mockVrcFlowStore._emitter.removeAllListeners()
  })

  describe('Initial state', () => {
    it('should have error as null initially', () => {
      const { result } = renderHook(() => useWitnessErrorDialog())

      expect(result.current.error).toBeNull()
    })

    it('should have isVisible as false initially', () => {
      const { result } = renderHook(() => useWitnessErrorDialog())

      expect(result.current.isVisible).toBe(false)
    })

    it('should have isRetrying as false initially', () => {
      const { result } = renderHook(() => useWitnessErrorDialog())

      expect(result.current.isRetrying).toBe(false)
    })

    it('should have connectionId as null initially', () => {
      const { result } = renderHook(() => useWitnessErrorDialog())

      expect(result.current.connectionId).toBeNull()
    })

    it('should subscribe to vrcFlowStore events on mount', () => {
      renderHook(() => useWitnessErrorDialog())

      expect(mockVrcFlowStore.on).toHaveBeenCalledWith('flowError', expect.any(Function))
      expect(mockVrcFlowStore.on).toHaveBeenCalledWith('flowErrorCleared', expect.any(Function))
    })

    it('should unsubscribe from vrcFlowStore events on unmount', () => {
      const { unmount } = renderHook(() => useWitnessErrorDialog())

      unmount()

      expect(mockVrcFlowStore.off).toHaveBeenCalledWith('flowError', expect.any(Function))
      expect(mockVrcFlowStore.off).toHaveBeenCalledWith('flowErrorCleared', expect.any(Function))
    })
  })

  describe('Error event handling', () => {
    it('should update error state when vrcFlowStore emits flowError', async () => {
      const { result } = renderHook(() => useWitnessErrorDialog())
      const testError = createTestError()
      const connectionId = 'conn-123'

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId, error: testError })
      })

      await waitFor(() => {
        expect(result.current.error).toEqual(testError)
      })
    })

    it('should set isVisible to true when error is set', async () => {
      const { result } = renderHook(() => useWitnessErrorDialog())
      const testError = createTestError()

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId: 'conn-123', error: testError })
      })

      await waitFor(() => {
        expect(result.current.isVisible).toBe(true)
      })
    })

    it('should capture connectionId from the event', async () => {
      const { result } = renderHook(() => useWitnessErrorDialog())
      const testError = createTestError()
      const connectionId = 'conn-456'

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId, error: testError })
      })

      await waitFor(() => {
        expect(result.current.connectionId).toBe(connectionId)
      })
    })

    it('should reset isRetrying to false when new error is received', async () => {
      const { result } = renderHook(() => useWitnessErrorDialog())
      const testError = createTestError('network-error', {
        onRetry: jest.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 1000))
        ),
      })

      // First set an error with retry in progress
      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId: 'conn-123', error: testError })
      })

      // Start a retry (which would set isRetrying to true)
      act(() => {
        result.current.onRetry()
      })

      // Before the retry completes, receive a new error
      const newError = createTestError('witness-timeout')
      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId: 'conn-456', error: newError })
      })

      await waitFor(() => {
        expect(result.current.isRetrying).toBe(false)
      })
    })

    it('should handle different error types correctly', async () => {
      const { result } = renderHook(() => useWitnessErrorDialog())
      const errorTypes: VrcFlowErrorType[] = [
        'witness-timeout',
        'vp-submission-failed',
        'session-timeout',
        'counterparty-not-connected',
        'biometric-cancelled',
        'biometric-failed',
        'stale-witness',
        'network-error',
      ]

      for (const errorType of errorTypes) {
        const testError = createTestError(errorType)

        act(() => {
          mockVrcFlowStore._emitter.emit('flowError', {
            connectionId: `conn-${errorType}`,
            error: testError,
          })
        })

        await waitFor(() => {
          expect(result.current.error?.type).toBe(errorType)
        })
      }
    })
  })

  describe('Error cleared handling', () => {
    it('should clear error when flowErrorCleared is emitted for same connectionId', async () => {
      const { result } = renderHook(() => useWitnessErrorDialog())
      const testError = createTestError()
      const connectionId = 'conn-123'

      // Set an error first
      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId, error: testError })
      })

      await waitFor(() => {
        expect(result.current.error).not.toBeNull()
      })

      // Clear the error
      act(() => {
        mockVrcFlowStore._emitter.emit('flowErrorCleared', { connectionId })
      })

      await waitFor(() => {
        expect(result.current.error).toBeNull()
      })
    })

    it('should set isVisible to false when error is cleared', async () => {
      const { result } = renderHook(() => useWitnessErrorDialog())
      const testError = createTestError()
      const connectionId = 'conn-123'

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId, error: testError })
      })

      await waitFor(() => {
        expect(result.current.isVisible).toBe(true)
      })

      act(() => {
        mockVrcFlowStore._emitter.emit('flowErrorCleared', { connectionId })
      })

      await waitFor(() => {
        expect(result.current.isVisible).toBe(false)
      })
    })

    it('should NOT clear error if flowErrorCleared is for different connectionId', async () => {
      const { result } = renderHook(() => useWitnessErrorDialog())
      const testError = createTestError()
      const connectionId = 'conn-123'
      const differentConnectionId = 'conn-456'

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId, error: testError })
      })

      await waitFor(() => {
        expect(result.current.error).not.toBeNull()
        expect(result.current.connectionId).toBe(connectionId)
      })

      // Try to clear with different connectionId
      act(() => {
        mockVrcFlowStore._emitter.emit('flowErrorCleared', { connectionId: differentConnectionId })
      })

      // Error should still be present
      expect(result.current.error).not.toBeNull()
      expect(result.current.isVisible).toBe(true)
    })

    it('should reset connectionId to null when error is cleared', async () => {
      const { result } = renderHook(() => useWitnessErrorDialog())
      const testError = createTestError()
      const connectionId = 'conn-123'

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId, error: testError })
      })

      await waitFor(() => {
        expect(result.current.connectionId).toBe(connectionId)
      })

      act(() => {
        mockVrcFlowStore._emitter.emit('flowErrorCleared', { connectionId })
      })

      await waitFor(() => {
        expect(result.current.connectionId).toBeNull()
      })
    })

    it('should reset isRetrying to false when error is cleared', async () => {
      const { result } = renderHook(() => useWitnessErrorDialog())
      const testError = createTestError('network-error', {
        onRetry: jest.fn().mockResolvedValue(undefined),
      })
      const connectionId = 'conn-123'

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId, error: testError })
      })

      await waitFor(() => {
        expect(result.current.error).not.toBeNull()
      })

      act(() => {
        mockVrcFlowStore._emitter.emit('flowErrorCleared', { connectionId })
      })

      await waitFor(() => {
        expect(result.current.isRetrying).toBe(false)
      })
    })
  })

  describe('onRetry behavior', () => {
    it('should set isRetrying to true while callback executes', async () => {
      let resolveRetry: () => void
      const retryPromise = new Promise<void>((resolve) => {
        resolveRetry = resolve
      })
      const mockOnRetry = jest.fn().mockReturnValue(retryPromise)
      const testError = createTestError('network-error', { onRetry: mockOnRetry })
      const connectionId = 'conn-123'

      const { result } = renderHook(() => useWitnessErrorDialog())

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId, error: testError })
      })

      await waitFor(() => {
        expect(result.current.error).not.toBeNull()
      })

      // Start retry
      act(() => {
        result.current.onRetry()
      })

      // Should be retrying
      await waitFor(() => {
        expect(result.current.isRetrying).toBe(true)
      })

      // Complete retry
      await act(async () => {
        resolveRetry!()
        await retryPromise
      })

      await waitFor(() => {
        expect(result.current.isRetrying).toBe(false)
      })
    })

    it('should call error.onRetry', async () => {
      const mockOnRetry = jest.fn().mockResolvedValue(undefined)
      const testError = createTestError('network-error', { onRetry: mockOnRetry })
      const connectionId = 'conn-123'

      const { result } = renderHook(() => useWitnessErrorDialog())

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId, error: testError })
      })

      await waitFor(() => {
        expect(result.current.error).not.toBeNull()
      })

      await act(async () => {
        await result.current.onRetry()
      })

      expect(mockOnRetry).toHaveBeenCalledTimes(1)
    })

    it('should set isRetrying to false after completion', async () => {
      const mockOnRetry = jest.fn().mockResolvedValue(undefined)
      const testError = createTestError('network-error', { onRetry: mockOnRetry })
      const connectionId = 'conn-123'

      const { result } = renderHook(() => useWitnessErrorDialog())

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId, error: testError })
      })

      await waitFor(() => {
        expect(result.current.error).not.toBeNull()
      })

      await act(async () => {
        await result.current.onRetry()
      })

      expect(result.current.isRetrying).toBe(false)
    })

    it('should handle retry errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      const mockOnRetry = jest.fn().mockRejectedValue(new Error('Retry failed'))
      const testError = createTestError('network-error', { onRetry: mockOnRetry })
      const connectionId = 'conn-123'

      const { result } = renderHook(() => useWitnessErrorDialog())

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId, error: testError })
      })

      await waitFor(() => {
        expect(result.current.error).not.toBeNull()
      })

      // Should not throw
      await act(async () => {
        await result.current.onRetry()
      })

      expect(result.current.isRetrying).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[WitnessErrorDialog] Retry failed:',
        expect.any(Error)
      )

      consoleErrorSpy.mockRestore()
    })

    it('should do nothing if error.onRetry is not defined', async () => {
      const testError = createTestError('network-error', { onRetry: undefined })
      const connectionId = 'conn-123'

      const { result } = renderHook(() => useWitnessErrorDialog())

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId, error: testError })
      })

      await waitFor(() => {
        expect(result.current.error).not.toBeNull()
      })

      // Should not throw
      await act(async () => {
        await result.current.onRetry()
      })

      expect(result.current.isRetrying).toBe(false)
    })

    it('should do nothing if connectionId is null', async () => {
      const { result } = renderHook(() => useWitnessErrorDialog())

      // No error set, connectionId is null
      await act(async () => {
        await result.current.onRetry()
      })

      expect(result.current.isRetrying).toBe(false)
    })
  })

  describe('onCancel behavior', () => {
    it('should clear error state', async () => {
      const testError = createTestError()
      const connectionId = 'conn-123'

      const { result } = renderHook(() => useWitnessErrorDialog())

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId, error: testError })
      })

      await waitFor(() => {
        expect(result.current.error).not.toBeNull()
      })

      act(() => {
        result.current.onCancel()
      })

      expect(result.current.error).toBeNull()
    })

    it('should call vrcFlowStore.clearError', async () => {
      const testError = createTestError()
      const connectionId = 'conn-123'

      const { result } = renderHook(() => useWitnessErrorDialog())

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId, error: testError })
      })

      await waitFor(() => {
        expect(result.current.error).not.toBeNull()
      })

      act(() => {
        result.current.onCancel()
      })

      expect(mockVrcFlowStore.clearError).toHaveBeenCalledWith(connectionId)
    })

    it('should call vrcFlowStore.clearFlow', async () => {
      const testError = createTestError()
      const connectionId = 'conn-123'

      const { result } = renderHook(() => useWitnessErrorDialog())

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId, error: testError })
      })

      await waitFor(() => {
        expect(result.current.error).not.toBeNull()
      })

      act(() => {
        result.current.onCancel()
      })

      expect(mockVrcFlowStore.clearFlow).toHaveBeenCalledWith(connectionId)
    })

    it('should reset all state', async () => {
      const testError = createTestError()
      const connectionId = 'conn-123'

      const { result } = renderHook(() => useWitnessErrorDialog())

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId, error: testError })
      })

      await waitFor(() => {
        expect(result.current.error).not.toBeNull()
      })

      act(() => {
        result.current.onCancel()
      })

      expect(result.current.error).toBeNull()
      expect(result.current.connectionId).toBeNull()
      expect(result.current.isRetrying).toBe(false)
      expect(result.current.isVisible).toBe(false)
    })

    it('should not call store methods if connectionId is null', () => {
      const { result } = renderHook(() => useWitnessErrorDialog())

      act(() => {
        result.current.onCancel()
      })

      expect(mockVrcFlowStore.clearError).not.toHaveBeenCalled()
      expect(mockVrcFlowStore.clearFlow).not.toHaveBeenCalled()
    })
  })

  describe('onProceedWithout behavior', () => {
    it('should call error.onProceedWithout when available', async () => {
      const mockOnProceedWithout = jest.fn().mockResolvedValue(undefined)
      const testError = createTestError('witness-timeout', { onProceedWithout: mockOnProceedWithout })
      const connectionId = 'conn-123'

      const { result } = renderHook(() => useWitnessErrorDialog())

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId, error: testError })
      })

      await waitFor(() => {
        expect(result.current.error).not.toBeNull()
      })

      await act(async () => {
        await result.current.onProceedWithout()
      })

      expect(mockOnProceedWithout).toHaveBeenCalledTimes(1)
    })

    it('should handle errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      const mockOnProceedWithout = jest.fn().mockRejectedValue(new Error('Proceed failed'))
      const testError = createTestError('witness-timeout', { onProceedWithout: mockOnProceedWithout })
      const connectionId = 'conn-123'

      const { result } = renderHook(() => useWitnessErrorDialog())

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId, error: testError })
      })

      await waitFor(() => {
        expect(result.current.error).not.toBeNull()
      })

      // Should not throw
      await act(async () => {
        await result.current.onProceedWithout()
      })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[WitnessErrorDialog] Proceed without witness failed:',
        expect.any(Error)
      )

      consoleErrorSpy.mockRestore()
    })

    it('should do nothing if error.onProceedWithout is not defined', async () => {
      const testError = createTestError('network-error', { onProceedWithout: undefined })
      const connectionId = 'conn-123'

      const { result } = renderHook(() => useWitnessErrorDialog())

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId, error: testError })
      })

      await waitFor(() => {
        expect(result.current.error).not.toBeNull()
      })

      // Should not throw
      await act(async () => {
        await result.current.onProceedWithout()
      })
    })

    it('should do nothing if connectionId is null', async () => {
      const { result } = renderHook(() => useWitnessErrorDialog())

      // No error set, connectionId is null
      await act(async () => {
        await result.current.onProceedWithout()
      })

      // Should not throw
    })
  })

  describe('Existing error on mount', () => {
    it('should pick up existing error from vrcFlowStore on mount', () => {
      const connectionId = 'conn-existing'
      const existingError = createTestError('stale-witness')

      // Pre-populate the mock store with an error
      mockVrcFlowStore._flowErrors.set(connectionId, existingError)
      mockVrcFlowStore.getErrorConnections.mockReturnValue([connectionId])
      mockVrcFlowStore.getError.mockReturnValue(existingError)

      const { result } = renderHook(() => useWitnessErrorDialog())

      expect(result.current.error).toEqual(existingError)
      expect(result.current.connectionId).toBe(connectionId)
      expect(result.current.isVisible).toBe(true)
    })

    it('should pick up first error if multiple errors exist on mount', () => {
      const connectionId1 = 'conn-1'
      const connectionId2 = 'conn-2'
      const error1 = createTestError('network-error')
      const error2 = createTestError('witness-timeout')

      mockVrcFlowStore._flowErrors.set(connectionId1, error1)
      mockVrcFlowStore._flowErrors.set(connectionId2, error2)
      mockVrcFlowStore.getErrorConnections.mockReturnValue([connectionId1, connectionId2])
      mockVrcFlowStore.getError.mockImplementation((id: string) =>
        id === connectionId1 ? error1 : error2
      )

      const { result } = renderHook(() => useWitnessErrorDialog())

      expect(result.current.error).toEqual(error1)
      expect(result.current.connectionId).toBe(connectionId1)
    })

    it('should not set error if vrcFlowStore has no errors on mount', () => {
      mockVrcFlowStore.getErrorConnections.mockReturnValue([])

      const { result } = renderHook(() => useWitnessErrorDialog())

      expect(result.current.error).toBeNull()
      expect(result.current.connectionId).toBeNull()
      expect(result.current.isVisible).toBe(false)
    })

    it('should handle edge case where getError returns undefined', () => {
      const connectionId = 'conn-empty'

      mockVrcFlowStore.getErrorConnections.mockReturnValue([connectionId])
      mockVrcFlowStore.getError.mockReturnValue(undefined)

      const { result } = renderHook(() => useWitnessErrorDialog())

      expect(result.current.error).toBeNull()
      expect(result.current.connectionId).toBeNull()
    })
  })

  describe('Return value shape', () => {
    it('should return all expected properties', () => {
      const { result } = renderHook(() => useWitnessErrorDialog())

      expect(result.current).toHaveProperty('error')
      expect(result.current).toHaveProperty('connectionId')
      expect(result.current).toHaveProperty('isVisible')
      expect(result.current).toHaveProperty('isRetrying')
      expect(result.current).toHaveProperty('onRetry')
      expect(result.current).toHaveProperty('onCancel')
      expect(result.current).toHaveProperty('onProceedWithout')
    })

    it('should return functions for handlers', () => {
      const { result } = renderHook(() => useWitnessErrorDialog())

      expect(typeof result.current.onRetry).toBe('function')
      expect(typeof result.current.onCancel).toBe('function')
      expect(typeof result.current.onProceedWithout).toBe('function')
    })

    it('should return stable function references', async () => {
      const { result, rerender } = renderHook(() => useWitnessErrorDialog())

      const initialOnRetry = result.current.onRetry
      const initialOnCancel = result.current.onCancel
      const initialOnProceedWithout = result.current.onProceedWithout

      rerender({})

      // Functions should be stable (same reference) when dependencies don't change
      expect(result.current.onCancel).toBe(initialOnCancel)

      // Note: onRetry and onProceedWithout depend on error and connectionId,
      // which are null initially and don't change, so they should be stable too
      expect(result.current.onRetry).toBe(initialOnRetry)
      expect(result.current.onProceedWithout).toBe(initialOnProceedWithout)
    })
  })

  describe('Edge cases', () => {
    it('should handle rapid error/clear cycles', async () => {
      const { result } = renderHook(() => useWitnessErrorDialog())
      const connectionId = 'conn-rapid'

      // Rapid fire events
      for (let i = 0; i < 5; i++) {
        const error = createTestError('network-error', { message: `Error ${i}` })

        act(() => {
          mockVrcFlowStore._emitter.emit('flowError', { connectionId, error })
        })

        act(() => {
          mockVrcFlowStore._emitter.emit('flowErrorCleared', { connectionId })
        })
      }

      await waitFor(() => {
        expect(result.current.error).toBeNull()
        expect(result.current.isVisible).toBe(false)
      })
    })

    it('should handle error replacement (new error while current error exists)', async () => {
      const { result } = renderHook(() => useWitnessErrorDialog())
      const connectionId1 = 'conn-1'
      const connectionId2 = 'conn-2'
      const error1 = createTestError('network-error', { message: 'First error' })
      const error2 = createTestError('witness-timeout', { message: 'Second error' })

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId: connectionId1, error: error1 })
      })

      await waitFor(() => {
        expect(result.current.error?.message).toBe('First error')
      })

      act(() => {
        mockVrcFlowStore._emitter.emit('flowError', { connectionId: connectionId2, error: error2 })
      })

      await waitFor(() => {
        expect(result.current.error?.message).toBe('Second error')
        expect(result.current.connectionId).toBe(connectionId2)
      })
    })
  })
})
