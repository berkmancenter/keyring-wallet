/**
 * Biometric Confirmation Context
 *
 * UI-based biometric confirmation for VRC signing.
 * This context provides a way to trigger the biometric confirmation modal
 * from background VRC issuance code. It bridges the gap between the
 * non-React VRC manager and the React UI layer.
 *
 * @module biometric-confirmation
 */

import React, { createContext, useCallback, useContext, useState, useRef } from 'react'

import BiometricConfirmationModal from '../components/modals/BiometricConfirmationModal'

export type BiometricConfirmationStatus = 'confirmed' | 'cancelled' | 'error' | 'not_available'

export interface BiometricConfirmationRequest {
  counterpartyName: string
  connectionId: string
  timestamp: string
  /**
   * Skip native biometric (loadWalletKey) because hardware signing
   * will trigger its own biometric prompt
   */
  skipNativeBiometric?: boolean
}

export interface BiometricConfirmationResponse {
  status: BiometricConfirmationStatus
  timestamp: string
  error?: string
}

export interface BiometricConfirmationContextType {
  /**
   * Request biometric confirmation from the user via modal
   * Returns a promise that resolves when user completes or cancels
   */
  requestConfirmation: (
    counterpartyName: string,
    connectionId: string
  ) => Promise<BiometricConfirmationResponse>

  /**
   * Current pending request (for modal to display)
   */
  pendingRequest: BiometricConfirmationRequest | null

  /**
   * Whether modal is currently visible
   */
  isModalVisible: boolean

  /**
   * Called by modal when user confirms with biometrics
   */
  onConfirm: () => void

  /**
   * Called by modal when user cancels
   */
  onCancel: () => void

  /**
   * Called by modal when biometric fails with error
   */
  onError: (error: string) => void
}

export const BiometricConfirmationContext = createContext<BiometricConfirmationContextType>(
  null as unknown as BiometricConfirmationContextType
)

export const useBiometricConfirmation = (): BiometricConfirmationContextType => {
  const context = useContext(BiometricConfirmationContext)
  if (!context) {
    throw new Error('useBiometricConfirmation must be used within a BiometricConfirmationProvider')
  }
  return context
}

// Global reference for non-React code to access the context
let globalRequestConfirmation:
  | ((counterpartyName: string, connectionId: string, skipNativeBiometric?: boolean) => Promise<BiometricConfirmationResponse>)
  | null = null

/**
 * Request biometric confirmation from non-React code (e.g., VRC manager)
 * This is the bridge between the Credo event handlers and the React UI
 *
 * @param skipNativeBiometric - If true, skip loadWalletKey biometric
 *   because hardware signing will trigger its own biometric prompt
 */
export async function requestBiometricConfirmationUI(
  counterpartyName: string,
  connectionId: string,
  skipNativeBiometric: boolean = false
): Promise<BiometricConfirmationResponse> {
  if (!globalRequestConfirmation) {
    console.warn('[BiometricConfirmation] Provider not mounted, falling back to allow')
    return {
      status: 'not_available',
      timestamp: new Date().toISOString(),
      error: 'BiometricConfirmationProvider not mounted',
    }
  }

  return globalRequestConfirmation(counterpartyName, connectionId, skipNativeBiometric)
}

export const BiometricConfirmationProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [pendingRequest, setPendingRequest] = useState<BiometricConfirmationRequest | null>(null)
  const [isModalVisible, setIsModalVisible] = useState(false)

  // Use ref to store the resolve function for the current request
  const resolveRef = useRef<((response: BiometricConfirmationResponse) => void) | null>(null)

  const requestConfirmation = useCallback(
    async (counterpartyName: string, connectionId: string, skipNativeBiometric: boolean = false): Promise<BiometricConfirmationResponse> => {
      const timestamp = new Date().toISOString()

      console.log(`[BiometricConfirmation] Request received for ${counterpartyName}`)
      console.log(`[BiometricConfirmation] Skip native biometric: ${skipNativeBiometric}`)

      // Create a promise that will be resolved when user completes action
      return new Promise((resolve) => {
        resolveRef.current = resolve

        setPendingRequest({
          counterpartyName,
          connectionId,
          timestamp,
          skipNativeBiometric,
        })
        setIsModalVisible(true)
      })
    },
    []
  )

  const onConfirm = useCallback(() => {
    console.log('[BiometricConfirmation] User confirmed with biometrics')
    if (resolveRef.current) {
      resolveRef.current({
        status: 'confirmed',
        timestamp: new Date().toISOString(),
      })
      resolveRef.current = null
    }
    setIsModalVisible(false)
    setPendingRequest(null)
  }, [])

  const onCancel = useCallback(() => {
    console.log('[BiometricConfirmation] User cancelled')
    if (resolveRef.current) {
      resolveRef.current({
        status: 'cancelled',
        timestamp: new Date().toISOString(),
      })
      resolveRef.current = null
    }
    setIsModalVisible(false)
    setPendingRequest(null)
  }, [])

  const onError = useCallback((error: string) => {
    console.log(`[BiometricConfirmation] Error: ${error}`)
    if (resolveRef.current) {
      resolveRef.current({
        status: 'error',
        timestamp: new Date().toISOString(),
        error,
      })
      resolveRef.current = null
    }
    setIsModalVisible(false)
    setPendingRequest(null)
  }, [])

  // Register the global function for non-React access
  React.useEffect(() => {
    globalRequestConfirmation = requestConfirmation
    console.log('[BiometricConfirmation] Provider mounted, global function registered')

    return () => {
      globalRequestConfirmation = null
      console.log('[BiometricConfirmation] Provider unmounted, global function cleared')
    }
  }, [requestConfirmation])

  const value: BiometricConfirmationContextType = {
    requestConfirmation,
    pendingRequest,
    isModalVisible,
    onConfirm,
    onCancel,
    onError,
  }

  return (
    <BiometricConfirmationContext.Provider value={value}>
      {children}
      <BiometricConfirmationModal />
    </BiometricConfirmationContext.Provider>
  )
}

export default BiometricConfirmationProvider


