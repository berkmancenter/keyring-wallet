/**
 * The polls backend on the app's existing legs, as rooms has: the person's own agent through `vtaAgent`, each
 * community through `vtiAgent` as the identity the phone joined it with, and the ballot box over its own HTTPS door.
 * Nothing new is opened to the agent or the community.
 *
 * @module polls/agentPollsBackend
 */
import type { Agent } from '@credo-ts/core'

import { getKeyed, listKeyed, putKeyed, withKeyLock } from '../trust-tasks/module/keyedRecords'
import { vtaAgent } from '../trust-tasks/module/vtaAgent'
import { vtiAgent } from '../trust-tasks/module/vtiAgent'
import { canConnectAs, personaForCommunity, VtiKeysNotHeld, VtiNoIdentity } from '../trust-tasks/module/sharedIdentity'
import { GenericRecordsCommunityStore } from '../trust-tasks/module/VtiCommunityStore'
import { GenericRecordsIdentityStore } from '../trust-tasks/module/VtiIdentityStore'
import { GenericRecordsTspPeerRevisionStore } from '../trust-tasks/module/vtiTsp'

import { createBallotBoxDoor } from './ballotBoxDoor'
import type { PollRecord, PollRecordStore, PollsBackend } from './pollService'

/** This phone's poll records: one per (community, poll), across every agent linked to it. */
const RECORD_TYPE = 'keyring/polls'
const KIND = 'poll'

const keyOf = (community: string, electionId: string) => `${community} ${electionId}`

export function createPollRecordStore(agent: Agent): PollRecordStore {
  return {
    get: (community, electionId) => getKeyed<PollRecord>(agent, RECORD_TYPE, KIND, keyOf(community, electionId)),
    put: (record) =>
      putKeyed(
        agent,
        RECORD_TYPE,
        KIND,
        keyOf(record.community, record.electionId),
        record as unknown as Record<string, unknown>
      ),
    list: () => listKeyed<PollRecord>(agent, RECORD_TYPE, KIND),
  }
}

/** A polls listing read (`vtc/elections/list`, `vtc/elections/show`, any version): a screen's, not a step's. */
export const isPollsListing = (type: string): boolean => /\/vtc\/elections\/(list|show)\/[\d.]+$/.test(type)

export function createAgentPollsBackend(agent: Agent, options: { mediatorDid?: string } = {}): PollsBackend {
  const identityStore = new GenericRecordsIdentityStore(agent)
  const communityStore = new GenericRecordsCommunityStore(agent)
  // The session to a community is the persona the phone joined it with, held while the task runs: a read and a
  // ticket request are the person's own acts, and hold it as an ordinary caller does. A listing read leaves no claim on
  // the session after it (`claims: false`): each one renewed it, and another community's rooms were refused for as long
  // as the polls were open (34VR-Y58H, 277.8, 11-03). A ticket request still does.
  const asPersona = async <T>(community: string, fn: () => Promise<T>, claims = true): Promise<T> => {
    // As rooms: the identity kept for this community, or the one its membership names (sharedIdentity, IN-517).
    const persona = await personaForCommunity(identityStore, communityStore, community)
    if (!persona) {
      agent.config?.logger?.warn?.('[Polls] no identity for the community: nothing asked (noIdentity)')
      throw new VtiNoIdentity('polls: this phone holds no identity for that community')
    }
    if (!canConnectAs(persona)) {
      agent.config?.logger?.warn?.("[Polls] the identity's keys are not on the phone yet: nothing asked (keysNotHeld)")
      throw new VtiKeysNotHeld("polls: this identity's keys are not on this phone yet")
    }
    return vtiAgent.holding(agent, options.mediatorDid, persona, fn, {
      peerRevisionStore: new GenericRecordsTspPeerRevisionStore(agent),
      reason: 'polls',
      claims,
    })
  }
  // The signed-in client rooms use: `task` and what the agent serves, nothing else.
  const client = async () => {
    const c = await vtaAgent.roomsClient(agent)
    if (!c) throw new Error('polls: no agent is linked to this phone')
    return c
  }

  return {
    communityTask: (community, type, payload) =>
      asPersona(community, () => vtiAgent.communityTask(community, type, payload), !isPollsListing(type)),
    sendCompleted: (community, document) => asPersona(community, () => vtiAgent.sendCompleted(community, document)),
    agentTask: async (type, payload) =>
      (await (await client()).task(type, payload as Record<string, unknown>)) as Record<string, unknown>,
    agentServedTypes: async () => (await vtaAgent.roomsClient(agent))?.supportedTypes(),
    currentAgent: () => vtaAgent.agentAddress(),
    linkedAgents: () => (vtaAgent.getState().agents ?? []).map((a) => a.vtaDid),
    voterTarget: async (community) => {
      const persona = await personaForCommunity(identityStore, communityStore, community)
      return persona ? { contextId: persona.contextId, community, member: persona.did } : undefined
    },
    records: createPollRecordStore(agent),
    door: createBallotBoxDoor(agent),
    serially: (key, work) => withKeyLock(`polls|${key}`, work),
    now: () => Date.now(),
    random: () => Math.random(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    warn: (message) => agent.config.logger.warn(message),
  }
}
