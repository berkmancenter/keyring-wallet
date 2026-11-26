/**
 * AttestationStorageModule
 *
 * Module for registering the AttestationStorageRepository with Credo's dependency injection.
 * Uses factory registration to work without decorators.
 *
 * @module vrc/module/AttestationStorageModule
 */

import { Module, DependencyManager, InjectionSymbols, EventEmitter } from '@credo-ts/core'

import { AttestationStorageRepository } from '../services/AttestationStorageRepository'

/**
 * Module for registering attestation storage dependencies
 */
export class AttestationStorageModule implements Module {
  /**
   * Registers all dependencies required by this module
   */
  register(dependencyManager: DependencyManager) {
    // Register the repository using a factory that manually resolves dependencies
    // This approach works without decorators or TypeScript metadata emission
    dependencyManager.container.register(AttestationStorageRepository, {
      useFactory: (container: any) => {
        // Explicitly resolve the required dependencies
        const storageService = container.resolve(InjectionSymbols.StorageService)
        const eventEmitter = container.resolve(EventEmitter)

        // Create and return the repository instance
        return new AttestationStorageRepository(storageService, eventEmitter)
      },
    } as any)
  }
}
