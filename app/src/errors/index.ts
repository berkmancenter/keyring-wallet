/**
 * Keyring Wallet Error Handling Module (ported from bc-wallet-mobile)
 *
 * This module provides a centralized error handling framework that:
 * - Uses a registry of predefined errors with technical messages
 * - Integrates with the ErrorModal for user-facing error display
 * - Supports native alerts via ErrorAlertContext
 * - Provides remote logging via the app logger (Loki)
 *
 * ## Recommended Usage (React Components)
 *
 * Use the `useErrorAlert()` hook for the cleanest API:
 *
 * ```typescript
 * import { useErrorAlert } from '@/contexts/ErrorAlertContext'
 *
 * const MyComponent = () => {
 *   const { emitErrorModal, emitAlert } = useErrorAlert()
 *
 *   // Show error via ErrorModal
 *   emitErrorModal('Error Title', 'Something went wrong', appErrorInstance)
 *
 *   // Show informational native alert
 *   emitAlert('Update available', 'A new version is ready', {
 *     actions: [{ text: 'Update Now', onPress: updateApp }],
 *   })
 * }
 * ```
 */

// AppError class
export { AppError, isAppError, isHandledAppError } from './appError'

// Error registry and types
export {
  ErrorCategory,
  ErrorRegistry,
  ErrorSeverity,
  type ErrorDefinition,
  type ErrorRegistryKey,
} from './errorRegistry'

// Error handler utilities
export {
  ensureAppError,
  extractErrorMessage,
  getErrorDefinition,
  getErrorDefinitionFromAppEventCode,
  getRegistryAppError,
  isDeviceStorageFullError,
  toBifoldError,
} from './errorHandler'
