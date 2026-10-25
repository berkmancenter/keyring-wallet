/**
 * ChatModule — registers the chat event repository with Credo's dependency
 * injection, using the factory pattern the VRC and Trust Task modules use
 * (no decorators).
 *
 * @module chat/ChatModule
 */

import type { Agent } from '@credo-ts/core'
import { Module, DependencyManager, InjectionSymbols, EventEmitter } from '@credo-ts/core'

import { ChatEventRepository } from './records/ChatEventRepository'

export class ChatModule implements Module {
  public register(dependencyManager: DependencyManager) {
    dependencyManager.container.register(ChatEventRepository, {
      useFactory: (container: any) => {
        const storageService = container.resolve(InjectionSymbols.StorageService)
        const eventEmitter = container.resolve(EventEmitter)
        return new ChatEventRepository(storageService, eventEmitter)
      },
    } as any)
  }
}

/** Resolve the repository from an agent, registering the module on first use. */
export function getChatEventRepository(agent: Agent): ChatEventRepository {
  const container = agent.dependencyManager.container
  if (!container.isRegistered(ChatEventRepository)) {
    new ChatModule().register(agent.dependencyManager)
  }
  return container.resolve(ChatEventRepository)
}
