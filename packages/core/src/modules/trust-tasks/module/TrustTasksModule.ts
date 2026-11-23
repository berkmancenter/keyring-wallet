/**
 * TrustTasksModule
 *
 * Registers the Trust Tasks seam with Credo's dependency injection: the
 * document repository, the service, and the binding-0.2 message handler.
 * Follows the VRC module's factory-registration pattern (no decorators).
 *
 * The message handler only *receives and retains*: ceremony semantics
 * (which spec governs a document, how to reply) belong to the ceremony
 * layer registered on top (milestone 2). An inbound message with no
 * connection is retained but never trusted — see TrustTasksService's
 * identity-mapping note.
 *
 * @module trust-tasks/module/TrustTasksModule
 */

import { Module, DependencyManager, InjectionSymbols, EventEmitter } from '@credo-ts/core'
import { DidCommMessageHandlerRegistry } from '@credo-ts/didcomm'

import { TrustTaskMessage } from '../messages/TrustTaskMessage'
import { TrustTaskDocumentRepository } from '../services/TrustTaskDocumentRepository'
import { TrustTasksService } from '../services/TrustTasksService'

export class TrustTasksModule implements Module {
  public register(dependencyManager: DependencyManager) {
    dependencyManager.container.register(TrustTaskDocumentRepository, {
      useFactory: (container: any) => {
        const storageService = container.resolve(InjectionSymbols.StorageService)
        const eventEmitter = container.resolve(EventEmitter)
        return new TrustTaskDocumentRepository(storageService, eventEmitter)
      },
    } as any)

    dependencyManager.container.register(TrustTasksService, {
      useFactory: (container: any) => {
        return new TrustTasksService(container.resolve(TrustTaskDocumentRepository))
      },
    } as any)
  }

  /**
   * Register the inbound carriage handler. Called by the agent-configuration
   * layer after initialization (the registry is didcomm-module state, not
   * container state).
   */
  public static registerMessageHandler(
    messageHandlerRegistry: DidCommMessageHandlerRegistry,
    onDocument: (
      document: Record<string, unknown>,
      context: { connectionId?: string; senderDid?: string; recipientDid?: string }
    ) => void | Promise<void>
  ) {
    messageHandlerRegistry.registerMessageHandler({
      supportedMessages: [TrustTaskMessage],
      handle: async (messageContext: any) => {
        const document = (messageContext.message as TrustTaskMessage).document
        if (!document) return undefined
        await onDocument(document, {
          connectionId: messageContext.connection?.id,
          senderDid: messageContext.connection?.theirDid,
          recipientDid: messageContext.connection?.did,
        })
        return undefined
      },
    })
  }
}
