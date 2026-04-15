/**
 * Credential Display Registry Interface
 *
 * This interface defines the contract for credential display handlers.
 * It lives in core so that modules like VRC can implement it without
 * core needing to import VRC directly.
 */

import { Field } from '@bifold/oca/build/legacy'

/**
 * W3C Credential JSON structure (simplified for display purposes)
 */
export interface W3cCredentialJsonForDisplay {
  '@context': string[]
  type: string[]
  issuer: string | { id: string; name?: string; [key: string]: unknown }
  issuanceDate?: string
  validFrom?: string
  validUntil?: string
  expirationDate?: string
  credentialSubject: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Button text configuration for credential offer screen
 */
export interface CredentialButtonText {
  /** Translation key for accept button */
  accept: string
  /** Translation key for decline button */
  decline: string
}

/**
 * Result from a display handler containing fields and UI customizations
 */
export interface CredentialDisplayResult {
  /** Fields to display in the credential offer/details view */
  fields: Field[]
  /** Custom button text (uses translation keys) */
  buttonText: CredentialButtonText
  /** Whether this handler matched the credential */
  matched: boolean
  /** Human-readable name of the credential type (e.g., "Relationship Credential") */
  credentialTypeName?: string
}

/**
 * Complete UI terminology for a credential type
 *
 * All values are translation keys, not translated strings.
 * This allows each credential subtype to provide its own terminology.
 */
export interface CredentialTerminology {
  // Nouns
  singular: string
  plural: string

  // Screen titles
  offerScreenTitle: string
  detailScreenTitle: string

  // Offer flow
  isOfferingYou: string
  declineTitle: string
  confirmDecline: string
  addedToWallet: string
  onTheWay: string

  // Detail/remove flow
  issuedByLabel: string
  removeTitle: string
  removeButtonLabel: string
  removeCaption: string
  removedConfirmation: string

  // Empty state
  emptyListMessage: string
  addItemButton: string

  // Tour steps
  tourAddTitle: string
  tourAddDescription: string
}

/**
 * Interface for credential display registry
 *
 * This registry allows modules to register custom display handlers
 * for different credential types. Core uses this interface without
 * needing to know about specific implementations.
 */
export interface ICredentialDisplayRegistry {
  /**
   * Get display information for a credential
   * @param credential The W3C credential JSON
   * @returns Display result with fields and button text
   */
  getDisplayInfo(credential: W3cCredentialJsonForDisplay): CredentialDisplayResult

  /**
   * Check if a credential type has a registered handler
   * @param credential The W3C credential JSON
   * @returns true if a handler exists
   */
  hasHandler(credential: W3cCredentialJsonForDisplay): boolean

  /**
   * Get button text for a credential
   * @param credential The W3C credential JSON
   * @returns Button text configuration
   */
  getButtonText(credential: W3cCredentialJsonForDisplay): CredentialButtonText

  /**
   * Get display fields for a credential
   * @param credential The W3C credential JSON
   * @returns Array of fields for display
   */
  getFields(credential: W3cCredentialJsonForDisplay): Field[]

  /**
   * Get UI terminology for a credential
   * @param credential The W3C credential JSON
   * @returns Terminology object with translation keys
   */
  getTerminology(credential: W3cCredentialJsonForDisplay): CredentialTerminology
}

/**
 * Check if a credential is a DTGCredential (base type for relationship credentials)
 */
export function isDTGCredentialType(credential: W3cCredentialJsonForDisplay): boolean {
  if (!credential?.type) {
    return false
  }
  const types = Array.isArray(credential.type) ? credential.type : [credential.type]
  return types.some((t) => typeof t === 'string' && t.includes('DTGCredential'))
}
