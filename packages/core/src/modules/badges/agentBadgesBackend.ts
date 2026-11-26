/**
 * The badges client's leg to each community: the identity session the rooms and the directory already use
 * (`createAgentRoomsBackend`), so badges open nothing new and sign as no one else. With sessions phase B on, a
 * community's ask goes over its identity's own session as the rooms' do.
 *
 * @module badges/agentBadgesBackend
 */
import type { Agent } from '@credo-ts/core'

import { createAgentRoomsBackend } from '../rooms/real/agentRoomsBackend'

import type { BadgesBackend } from './badgeService'

export function createAgentBadgesBackend(agent: Agent, options: { mediatorDid?: string } = {}): BadgesBackend {
  const rooms = createAgentRoomsBackend(agent, options)
  return { communityTask: (communityDid, type, payload) => rooms.communityTask(communityDid, type, payload) }
}
