/**
 * Display Registry for W3C VC Credentials
 *
 * This registry manages credential display handlers and provides
 * a unified interface for extracting display information from
 * different credential types.
 *
 * This registry implements ICredentialDisplayRegistry from core
 * to allow decoupled registration via the container system.
 */

import { Field } from '@bifold/oca/build/legacy'
import {
  CredentialDisplayHandler,
  CredentialButtonText,
  CredentialTerminology,
  W3cCredentialJson,
  CredentialDisplayResult,
} from './types'
import { defaultCredentialTerminology } from './terminology/defaults'

/**
 * Default button text (translation keys) when no handler matches
 */
const DEFAULT_BUTTON_TEXT: CredentialButtonText = {
  accept: 'Global.Accept',
  decline: 'Global.Decline',
}

/**
 * Registry for credential display handlers
 */
class CredentialDisplayRegistry {
  private handlers: CredentialDisplayHandler[] = []

  /**
   * Register a new display handler
   * @param handler The handler to register
   */
  register(handler: CredentialDisplayHandler): void {
    this.handlers.push(handler)
    // Sort handlers by priority (highest first)
    this.handlers.sort((a, b) => b.priority - a.priority)
  }

  /**
   * Unregister a handler by its credential types
   * @param credentialTypes The credential types to match for removal
   */
  unregister(credentialTypes: string[]): void {
    this.handlers = this.handlers.filter((h) => !credentialTypes.every((type) => h.credentialTypes.includes(type)))
  }

  /**
   * Find the appropriate handler for a credential
   * @param credential The W3C credential JSON
   * @returns The matching handler or undefined
   */
  findHandler(credential: W3cCredentialJson): CredentialDisplayHandler | undefined {
    if (!credential) {
      return undefined
    }
    return this.handlers.find((handler) => handler.canHandle(credential))
  }

  /**
   * Get display information for a credential
   * @param credential The W3C credential JSON
   * @returns Display result with fields and button text
   */
  getDisplayInfo(credential: W3cCredentialJson): CredentialDisplayResult {
    if (!credential) {
      return {
        fields: [],
        buttonText: DEFAULT_BUTTON_TEXT,
        matched: false,
      }
    }
    const handler = this.findHandler(credential)

    if (handler) {
      return {
        fields: handler.extractFields(credential),
        buttonText: handler.getButtonText(),
        matched: true,
        credentialTypeName: handler.getCredentialTypeName?.(),
      }
    }

    // No handler found - return empty fields with default buttons
    return {
      fields: [],
      buttonText: DEFAULT_BUTTON_TEXT,
      matched: false,
    }
  }

  /**
   * Check if a credential type has a registered handler
   * @param credential The W3C credential JSON
   * @returns true if a handler exists
   */
  hasHandler(credential: W3cCredentialJson): boolean {
    return this.findHandler(credential) !== undefined
  }

  /**
   * Get button text for a credential
   * @param credential The W3C credential JSON
   * @returns Button text configuration
   */
  getButtonText(credential: W3cCredentialJson): CredentialButtonText {
    const handler = this.findHandler(credential)
    return handler ? handler.getButtonText() : DEFAULT_BUTTON_TEXT
  }

  /**
   * Get display fields for a credential
   * @param credential The W3C credential JSON
   * @returns Array of fields for display
   */
  getFields(credential: W3cCredentialJson): Field[] {
    const handler = this.findHandler(credential)
    return handler ? handler.extractFields(credential) : []
  }

  /**
   * Get UI terminology for a credential
   * @param credential The W3C credential JSON
   * @returns Terminology object with translation keys
   */
  getTerminology(credential: W3cCredentialJson): CredentialTerminology {
    if (!credential) {
      return defaultCredentialTerminology
    }
    const handler = this.findHandler(credential)
    return handler?.getTerminology?.() ?? defaultCredentialTerminology
  }

  /**
   * Get all registered handlers (for debugging/testing)
   */
  getRegisteredHandlers(): ReadonlyArray<CredentialDisplayHandler> {
    return [...this.handlers]
  }

  /**
   * Clear all registered handlers (mainly for testing)
   */
  clear(): void {
    this.handlers = []
  }
}

/**
 * Global singleton instance of the display registry
 */
export const credentialDisplayRegistry = new CredentialDisplayRegistry()

/**
 * Convenience function to check if a credential is a DTGCredential
 */
export function isDTGCredential(credential: W3cCredentialJson): boolean {
  if (!credential?.type) {
    return false
  }
  const types = Array.isArray(credential.type) ? credential.type : [credential.type]
  return types.some((t) => typeof t === 'string' && t.includes('DTGCredential'))
}

/**
 * Convenience function to check if a credential is a RelationshipCredential
 */
export function isRelationshipCredential(credential: W3cCredentialJson): boolean {
  if (!credential?.type) {
    return false
  }
  const types = Array.isArray(credential.type) ? credential.type : [credential.type]
  return types.some((t) => typeof t === 'string' && t.includes('RelationshipCredential'))
}
