import { Module, DependencyManager, InjectionSymbols, EventEmitter } from '@credo-ts/core'
import { RelationshipDidRepository } from '../repositories/RelationshipDidRepository'

/**
 * Module for registering the RelationshipDidRepository with Credo's dependency injection
 * Uses factory registration to work without decorators
 */
export class RelationshipDidModule implements Module {
  /**
   * Registers all dependencies required by this module
   */
  register(dependencyManager: DependencyManager) {
    // Register the repository using a factory that manually resolves dependencies
    // This approach works without decorators or TypeScript metadata emission
    dependencyManager.container.register(RelationshipDidRepository, {
      useFactory: (container: any) => {
        // Explicitly resolve the required dependencies
        const storageService = container.resolve(InjectionSymbols.StorageService)
        const eventEmitter = container.resolve(EventEmitter)

        // Create and return the repository instance
        return new RelationshipDidRepository(storageService, eventEmitter)
      },
    } as any)
  }
}
