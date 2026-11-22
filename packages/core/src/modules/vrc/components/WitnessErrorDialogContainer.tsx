/**
 * WitnessErrorDialogContainer
 *
 * Self-contained component that manages and displays the WitnessErrorDialog.
 * Drop this component anywhere in your app tree to enable witness error handling UI.
 *
 * Usage:
 * ```tsx
 * // In App.tsx or a root component:
 * <WitnessErrorDialogContainer />
 * ```
 */

import React from 'react'
import WitnessErrorDialog from './WitnessErrorDialog'
import { useWitnessErrorDialog } from '../hooks/useWitnessErrorDialog'

/**
 * Container component that manages WitnessErrorDialog visibility and state.
 * Subscribes to vrcFlowStore error events automatically.
 */
const WitnessErrorDialogContainer: React.FC = () => {
  const {
    error,
    isVisible,
    isRetrying,
    onRetry,
    onCancel,
    onProceedWithout,
  } = useWitnessErrorDialog()

  // Don't render anything if no error
  if (!isVisible || !error) {
    return null
  }

  return (
    <WitnessErrorDialog
      visible={isVisible}
      errorType={error.type}
      errorMessage={error.message}
      witnessName={error.witnessName}
      contactName={error.contactName}
      isRetrying={isRetrying}
      onRetry={error.onRetry ? onRetry : undefined}
      onCancel={onCancel}
      onProceedWithout={error.onProceedWithout ? onProceedWithout : undefined}
    />
  )
}

export default WitnessErrorDialogContainer
