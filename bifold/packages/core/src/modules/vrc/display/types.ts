/**
 * Types for modular W3C VC credential display handlers
 *
 * This system allows different credential types to define their own
 * display fields and UI customizations.
 */

import { Attribute, Field } from '@bifold/oca/build/legacy'

export { Attribute, Field }

/**
 * W3C Credential JSON structure (simplified for display purposes)
 */
export interface W3cCredentialJson {
  '@context': string[]
  type: string[]
  issuer: string | W3cIssuerObject
  issuanceDate?: string
  validFrom?: string
  validUntil?: string
  expirationDate?: string
  credentialSubject: Record<string, unknown>
  [key: string]: unknown
}

/**
 * W3C Issuer object structure
 */
export interface W3cIssuerObject {
  id: string
  name?: string
  email?: string
  organization?: string
  [key: string]: unknown
}

/**
 * Button text configuration for credential offer screen
 */
export interface CredentialButtonText {
  accept: string
  decline: string
}

/**
 * Complete UI terminology for a credential type
 *
 * All values are translation keys, not translated strings.
 * This allows each credential subtype (RelationshipCredential, RCard, etc.)
 * to provide its own terminology while keeping the translation system intact.
 */
export interface CredentialTerminology {
  // Nouns
  /** Singular form: "contact", "r-card", "credential" */
  singular: string
  /** Plural form: "contacts", "r-cards", "credentials" */
  plural: string

  // Screen titles
  /** Offer screen title: "Contact Request", "Credential Offer" */
  offerScreenTitle: string
  /** Detail screen title: "Contact Details", "Credential Details" */
  detailScreenTitle: string

  // Offer flow
  /** "{issuer} is offering you a contact/credential" */
  isOfferingYou: string
  /** Decline modal title: "Decline contact request?" */
  declineTitle: string
  /** Decline confirmation: "Yes, decline this contact" */
  confirmDecline: string
  /** Success message: "Contact added to your wallet" */
  addedToWallet: string
  /** On the way message: "Your contact is on the way" */
  onTheWay: string

  // Detail/remove flow
  /** Label for issuer/connection: "Connected with", "Issued by" */
  issuedByLabel: string
  /** Remove modal title: "Remove contact from your wallet" */
  removeTitle: string
  /** Remove button label: "Remove Contact" */
  removeButtonLabel: string
  /** Remove modal caption explaining what happens */
  removeCaption: string
  /** Toast message: "Contact removed" */
  removedConfirmation: string

  // Empty state
  /** Empty list message: "You don't have any contacts yet" */
  emptyListMessage: string
  /** Add button: "Add Contact", "Scan QR Code" */
  addItemButton: string

  // Tour steps
  /** Tour title: "Add Contacts", "Add Credentials" */
  tourAddTitle: string
  /** Tour description for adding items */
  tourAddDescription: string

  // Chat message text
  /** Chat message when offer received: "Contact offer received", "Credential offer received" */
  chatOfferTitle: string
  /** Chat message when credential received: "Contact received", "Credential received" */
  chatReceivedTitle: string
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
  /** Human-readable name of the credential type */
  credentialTypeName?: string
}

/**
 * Interface for credential display handlers
 *
 * Each handler is responsible for:
 * - Determining if it can handle a credential type
 * - Extracting display fields from the credential
 * - Providing custom UI text (button labels, etc.)
 */
export interface CredentialDisplayHandler {
  /**
   * Credential types this handler supports.
   * Handler matches if ANY of these types are present in the credential's type array.
   */
  readonly credentialTypes: string[]

  /**
   * Priority for handler selection (higher = checked first)
   * More specific handlers (e.g., RelationshipCredential) should have higher priority
   * than base handlers (e.g., DTGCredential)
   */
  readonly priority: number

  /**
   * Check if this handler can process the given credential
   * @param credential The W3C credential JSON
   * @returns true if this handler should be used
   */
  canHandle(credential: W3cCredentialJson): boolean

  /**
   * Extract display fields from the credential
   * @param credential The W3C credential JSON
   * @returns Array of Field objects for display
   */
  extractFields(credential: W3cCredentialJson): Field[]

  /**
   * Get custom button text for the credential offer screen
   * @returns Object with translation keys for accept/decline buttons
   */
  getButtonText(): CredentialButtonText

  /**
   * Get the human-readable name for this credential type
   * @returns Human-readable credential type name (e.g., "Relationship Credential")
   */
  getCredentialTypeName?(): string

  /**
   * Get complete UI terminology for this credential type
   * @returns Object with translation keys for all UI text
   */
  getTerminology?(): CredentialTerminology
}

/**
 * Helper function to safely extract issuer object from credential
 */
export function extractIssuerObject(credential: W3cCredentialJson): W3cIssuerObject {
  const { issuer } = credential

  if (typeof issuer === 'string') {
    return { id: issuer }
  }

  if (issuer && typeof issuer === 'object') {
    return issuer as W3cIssuerObject
  }

  return { id: 'unknown' }
}

/**
 * Helper function to check if credential has a specific type
 */
export function hasCredentialType(credential: W3cCredentialJson, type: string): boolean {
  if (!credential || !credential.type) {
    return false
  }
  const types = Array.isArray(credential.type) ? credential.type : [credential.type]
  return types.some((t) => typeof t === 'string' && t.includes(type))
}

/**
 * Helper function to format a DID for display (truncated with ellipsis)
 */
export function formatDidForDisplay(did: string, maxLength: number = 30): string {
  if (!did || did.length <= maxLength) {
    return did
  }

  // Show prefix and last portion
  const prefix = did.substring(0, 12)
  const suffix = did.substring(did.length - 8)
  return `${prefix}...${suffix}`
}

/**
 * Helper function to format a date string for display
 */
export function formatDateForDisplay(dateString: string | undefined): string {
  if (!dateString) {
    return ''
  }

  try {
    const date = new Date(dateString)
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateString
  }
}
