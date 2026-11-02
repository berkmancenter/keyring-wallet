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

export function createAgentPollsBackend(agent: Agent, options: { mediatorDid?: string } = {}): PollsBackend {
  const identityStore = new GenericRecordsIdentityStore(agent)
  // The session to a community is the persona the phone joined it with, held while the task runs: a read and a
  // ticket request are the person's own acts, and hold it as an ordinary caller does.
  const asPersona = async <T>(community: string, fn: () => Promise<T>): Promise<T> => {
    const persona = await identityStore.getPersona(community)
    if (!persona) throw new Error('polls: this phone holds no identity for that community')
    return vtiAgent.holding(agent, options.mediatorDid, persona, fn, {
      peerRevisionStore: new GenericRecordsTspPeerRevisionStore(agent),
      reason: 'polls',
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
      asPersona(community, () => vtiAgent.communityTask(community, type, payload)),
    sendCompleted: (community, document) => asPersona(community, () => vtiAgent.sendCompleted(community, document)),
    agentTask: async (type, payload) =>
      (await (await client()).task(type, payload as Record<string, unknown>)) as Record<string, unknown>,
    agentServedTypes: async () => (await vtaAgent.roomsClient(agent))?.supportedTypes(),
    currentAgent: () => vtaAgent.agentAddress(),
    linkedAgents: () => (vtaAgent.getState().agents ?? []).map((a) => a.vtaDid),
    voterTarget: async (community) => {
      const persona = await identityStore.getPersona(community)
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
