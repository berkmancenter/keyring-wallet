/**
 * useWitnessErrorDialog Hook
 *
 * Provides state and handlers for displaying the WitnessErrorDialog component.
 * Subscribes to vrcFlowStore error events and manages dialog visibility.
 *
 * Usage:
 * ```tsx
 * const { error, isVisible, isRetrying, onRetry, onCancel, onProceedWithout } = useWitnessErrorDialog()
 *
 * return (
 *   <WitnessErrorDialog
 *     visible={isVisible}
 *     errorType={error?.type || 'network-error'}
 *     errorMessage={error?.message}
 *     witnessName={error?.witnessName}
 *     contactName={error?.contactName}
 *     isRetrying={isRetrying}
 *     onRetry={error?.onRetry ? onRetry : undefined}
 *     onCancel={onCancel}
 *     onProceedWithout={error?.onProceedWithout ? onProceedWithout : undefined}
 *   />
 * )
 * ```
 */

import { useState, useEffect, useCallback } from 'react'
import { vrcFlowStore, type VrcFlowError } from '../witnessStatusStore'

export interface UseWitnessErrorDialogResult {
  /** Current error state (null if no error) */
  error: VrcFlowError | null
  /** Connection ID associated with the error */
  connectionId: string | null
  /** Whether the dialog should be visible */
  isVisible: boolean
  /** Whether a retry operation is in progress */
  isRetrying: boolean
  /** Handler for retry button - wraps error.onRetry with loading state */
  onRetry: () => Promise<void>
  /** Handler for cancel button - clears error and flow state */
  onCancel: () => void
  /** Handler for proceed without witness - wraps error.onProceedWithout */
  onProceedWithout: () => Promise<void>
}

/**
 * Hook to manage WitnessErrorDialog state
 *
 * Subscribes to vrcFlowStore error events and provides handlers for dialog actions.
 * Automatically shows dialog when an error is set and hides when cleared.
 */
export function useWitnessErrorDialog(): UseWitnessErrorDialogResult {
  const [error, setError] = useState<VrcFlowError | null>(null)
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)

  // Subscribe to flow errors
  useEffect(() => {
    const handleError = ({ connectionId: connId, error: flowError }: { connectionId: string; error: VrcFlowError }) => {
      setError(flowError)
      setConnectionId(connId)
      setIsRetrying(false)
    }

    const handleErrorCleared = ({ connectionId: connId }: { connectionId: string }) => {
      // Only clear if it's the same connection
      if (connId === connectionId) {
        setError(null)
        setConnectionId(null)
        setIsRetrying(false)
      }
    }

    vrcFlowStore.on('flowError', handleError)
    vrcFlowStore.on('flowErrorCleared', handleErrorCleared)

    // Check if there's already an error on mount
    const errorConnections = vrcFlowStore.getErrorConnections()
    if (errorConnections.length > 0) {
      const firstConnId = errorConnections[0]
      const existingError = vrcFlowStore.getError(firstConnId)
      if (existingError) {
        setError(existingError)
        setConnectionId(firstConnId)
      }
    }

    return () => {
      vrcFlowStore.off('flowError', handleError)
      vrcFlowStore.off('flowErrorCleared', handleErrorCleared)
    }
  }, [connectionId])

  const onRetry = useCallback(async () => {
    if (!error?.onRetry || !connectionId) return

    setIsRetrying(true)
    try {
      await error.onRetry()
    } catch (retryError) {
      // Error will be set by the retry handler if needed
      console.error('[WitnessErrorDialog] Retry failed:', retryError)
    } finally {
      setIsRetrying(false)
    }
  }, [error, connectionId])

  const onCancel = useCallback(() => {
    if (connectionId) {
      // Clear error state
      vrcFlowStore.clearError(connectionId)
      // Also clear flow state so user can try again later
      vrcFlowStore.clearFlow(connectionId)
    }
    setError(null)
    setConnectionId(null)
    setIsRetrying(false)
  }, [connectionId])

  const onProceedWithout = useCallback(async () => {
    if (!error?.onProceedWithout || !connectionId) return

    try {
      await error.onProceedWithout()
    } catch (proceedError) {
      console.error('[WitnessErrorDialog] Proceed without witness failed:', proceedError)
    }
    // Error should be cleared by the handler
  }, [error, connectionId])

  return {
    error,
    connectionId,
    isVisible: error !== null,
    isRetrying,
    onRetry,
    onCancel,
    onProceedWithout,
  }
}

export default useWitnessErrorDialog
