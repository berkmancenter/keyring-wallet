/**
 * VRC Display Module
 *
 * This module provides a modular system for displaying W3C VC credentials
 * with custom field extraction and UI customization based on credential type.
 *
 * Usage:
 * ```typescript
 * import { credentialDisplayRegistry, initializeDisplayHandlers } from './display'
 *
 * // Initialize handlers (call once at app startup)
 * initializeDisplayHandlers()
 *
 * // Get display info for a credential
 * const credential = credentialRecord.credential
 * const displayInfo = credentialDisplayRegistry.getDisplayInfo(credential)
 * ```
 */

// Export types
export type {
  W3cCredentialJson,
  W3cIssuerObject,
  CredentialButtonText,
  CredentialTerminology,
  CredentialDisplayResult,
  CredentialDisplayHandler,
} from './types'

// Export classes and functions
export {
  Attribute,
  Field,
  extractIssuerObject,
  hasCredentialType,
  formatDidForDisplay,
  formatDateForDisplay,
} from './types'

// Export registry
export { credentialDisplayRegistry, isDTGCredential, isRelationshipCredential } from './displayRegistry'

// Export handlers
export { RelationshipCredentialHandler, relationshipCredentialHandler } from './handlers/RelationshipCredentialHandler'

// Export terminology defaults
export { defaultCredentialTerminology, contactTerminology } from './terminology/defaults'

// Re-export core credential display types for convenience
export type {
  ICredentialDisplayRegistry,
  W3cCredentialJsonForDisplay,
  CredentialDisplayResult as CoreCredentialDisplayResult,
  CredentialButtonText as CoreCredentialButtonText,
} from '../../../types/credential-display'

export { isDTGCredentialType } from '../../../types/credential-display'
