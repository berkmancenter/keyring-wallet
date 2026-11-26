/**
 * VRC Module Registration
 *
 * This module provides functions to register VRC functionality with
 * the core application. It's designed to be called during app
 * initialization to set up:
 * - Credential display handlers
 * - VRC-specific localization
 * - Container registration
 *
 * This keeps VRC modular and decoupled from core.
 */

import i18next from 'i18next'
import { DependencyContainer } from 'tsyringe'
import { TOKENS } from '../../container-api'
import { ICredentialDisplayRegistry } from '../../types/credential-display'
import { credentialDisplayRegistry } from './display/displayRegistry'
import { relationshipCredentialHandler } from './display/handlers/RelationshipCredentialHandler'
import { witnessCredentialHandler } from './display/handlers/WitnessCredentialHandler'

// Import VRC localization
import vrcEnTranslations from './localization/en.json'

/**
 * Options for VRC module registration
 */
export interface VrcRegistrationOptions {
  /** Whether to register display handlers (default: true) */
  registerDisplayHandlers?: boolean
  /** Whether to load VRC localization (default: true) */
  loadLocalization?: boolean
  /** Additional languages to load (provide object with language code -> translations) */
  additionalLanguages?: Record<string, Record<string, unknown>>
}

/**
 * Register VRC display handlers
 *
 * This registers the built-in display handlers for DTGCredential types.
 * Call this during app initialization.
 */
export function registerVrcDisplayHandlers(): void {
  // Register RelationshipCredential handler
  credentialDisplayRegistry.register(relationshipCredentialHandler)

  // Register WitnessCredential handler
  credentialDisplayRegistry.register(witnessCredentialHandler)

  // Future handlers can be registered here:
  // credentialDisplayRegistry.register(otherDTGCredentialHandler)
}

/**
 * Load VRC-specific localization resources
 *
 * This adds VRC translations to i18next using addResourceBundle.
 * Translations are merged with existing resources (not replacing).
 */
export function loadVrcLocalization(additionalLanguages?: Record<string, Record<string, unknown>>): void {
  // Add English translations (merging with existing)
  i18next.addResourceBundle('en', 'translation', vrcEnTranslations, true, true)

  // Add any additional language resources
  if (additionalLanguages) {
    Object.entries(additionalLanguages).forEach(([lang, translations]) => {
      i18next.addResourceBundle(lang, 'translation', translations, true, true)
    })
  }
}

/**
 * Register VRC display registry with the container
 *
 * This registers the credential display registry singleton with the
 * dependency injection container, allowing core components to access
 * it via the container token.
 *
 * @param container The DependencyContainer to register with
 */
export function registerVrcWithContainer(container: DependencyContainer): void {
  // Register the display registry as a singleton
  container.registerInstance(TOKENS.UTIL_CREDENTIAL_DISPLAY_REGISTRY, credentialDisplayRegistry)
}

/**
 * Initialize the VRC module
 *
 * This is the main entry point for VRC module initialization.
 * Call this during app startup to set up all VRC functionality.
 *
 * @param container The DependencyContainer for registration
 * @param options Configuration options
 *
 * @example
 * ```typescript
 * import { initializeVrcModule } from '@bifold/core/modules/vrc/register'
 *
 * // In your app initialization:
 * initializeVrcModule(container)
 * ```
 */
export function initializeVrcModule(container: DependencyContainer, options: VrcRegistrationOptions = {}): void {
  const { registerDisplayHandlers = true, loadLocalization = true, additionalLanguages } = options

  // Register display handlers
  if (registerDisplayHandlers) {
    registerVrcDisplayHandlers()
  }

  // Load localization resources
  if (loadLocalization) {
    loadVrcLocalization(additionalLanguages)
  }

  // Register with container
  registerVrcWithContainer(container)
}

/**
 * Get the credential display registry instance
 *
 * This provides direct access to the registry for advanced use cases
 * like adding custom handlers at runtime.
 *
 * @returns The credential display registry implementing ICredentialDisplayRegistry
 */
export function getCredentialDisplayRegistry(): ICredentialDisplayRegistry {
  return credentialDisplayRegistry
}
