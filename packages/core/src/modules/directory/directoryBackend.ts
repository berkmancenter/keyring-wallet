/**
 * The directory's leg to each community: the persona session the rooms already open (`createAgentRoomsBackend`),
 * so the directory opens nothing new and signs as no one else.
 *
 * @module directory/directoryBackend
 */
import type { Agent } from '@credo-ts/core'

import { createAgentRoomsBackend } from '../rooms/real/agentRoomsBackend'

import type { DirectoryBackend } from './directoryService'

export function createDirectoryBackend(agent: Agent, options: { mediatorDid?: string } = {}): DirectoryBackend {
  const rooms = createAgentRoomsBackend(agent, options)
  return { communityTask: (communityDid, type, payload) => rooms.communityTask(communityDid, type, payload) }
}
