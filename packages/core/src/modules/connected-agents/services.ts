/**
 * The production services for the agent-connect hooks: the owner's VTA through `vtaAgent`'s signed-in session, the
 * phone's administrator key for its signatures, and the connection records in the wallet (plan §7.7, #1060 finding
 * 11). Every VTA call goes through `withAgentSession`, so a call made while the session is closed signs in first.
 *
 * @module connected-agents/services
 */

import type { Agent } from '@credo-ts/core'

import { signDocumentProof, verifyDocumentProof } from '../trust-tasks/documentProof'
import { getKeyed, putKeyed } from '../trust-tasks/module/keyedRecords'
import { consentPendingOf, type VtaClient } from '../trust-tasks/module/VtaClient'
import { AgentActions } from './actions'
import type { AgentAccessPort } from './carriage'
import type { AdministratorSigner } from './deviceEnrolDraft'
import type { ConnectedAgentsServices } from './ConnectedAgentsProvider'
import { AgentConnectDriver } from './driver'
import { connectGuard, countMemory, createMemory, pickerMemories, type MemoryPort } from './memories'
import { AgentConnectionStore, KeyedLockoutStore, KeyedSpentRequestStore } from './store'
import type { VdcSignPort } from './vdc'

/** The part of `vtaAgent` these services use. */
export interface VtaSession {
  withAgentSession<T>(agent: Agent, vtaDid: string, use: (client: VtaClient) => Promise<T>): Promise<T>
  getState(): { managerDid?: string }
}

/** The personas this phone holds (`VtiIdentityStore.listPersonas`). */
export type PersonaSource = () => Promise<{ did: string; vtaDid?: string; label?: string }[]>

/**
 * The phone's administrator signer for `deviceEnrol` (`identify` for `authentication`, the grant for `assertionMethod`,
 * §7.5): the session's manager DID, read when it signs, since it changes when the phone's key is rotated. With none,
 * it refuses rather than sign as anyone else.
 */
export function administratorSigner(agent: Agent, session: Pick<VtaSession, 'getState'>): AdministratorSigner {
  const managerDid = () => {
    const did = session.getState().managerDid
    if (!did) throw new Error('no administrator key on this phone for that VTA')
    return did
  }
  return {
    get did() {
      return managerDid()
    },
    sign: async (document, proofPurpose) => signDocumentProof(agent, document, managerDid(), { proofPurpose }),
  }
}

const COUNT_RECORD_TYPE = 'keyring/agent-connection'
const COUNT_KIND = 'memory-count'

/** The owner's VTA as the ports the logic takes, each call on a signed-in session. */
export function vtaPorts(agent: Agent, vtaDid: string, session: VtaSession) {
  const on = <T>(use: (client: VtaClient) => Promise<T>) => session.withAgentSession(agent, vtaDid, use)
  const access: AgentAccessPort = {
    grantApplication: (grant) => on((c) => c.grantApplication(grant)),
    findAgentEntries: (query) =>
      on((c) => c.findAgentEntries(query)) as ReturnType<AgentAccessPort['findAgentEntries']>,
    narrowOrWidenCapabilities: (change) => on((c) => c.narrowOrWidenCapabilities(change)),
  }
  const vdcSign: VdcSignPort = { task: (type, payload) => on((c) => c.task(type, payload)) }
  const memory: MemoryPort = {
    listContexts: () => on((c) => c.listContexts()),
    createContext: (id, name) => on((c) => c.createContext(id, name)),
    whoAmI: () => on((c) => c.whoAmI()),
    task: (type, payload) => on((c) => c.task(type, payload)),
  }
  return { access, vdcSign, memory }
}

/**
 * The services for the VTA this phone administers. The administrator DID is read from the session when it signs
 * (it changes when the phone's key is rotated); with none, signing fails and the pairing fails as unreachable.
 */
export function connectedAgentsServices(
  agent: Agent,
  vtaDid: string,
  session: VtaSession,
  personas: PersonaSource,
  clock: () => number = Date.now
): ConnectedAgentsServices {
  const { access, vdcSign, memory } = vtaPorts(agent, vtaDid, session)
  const connections = new AgentConnectionStore(agent)
  const randomBytes = (length: number) => agent.kms.randomBytes({ length })
  // Step 7.10's revoke (#1077) joins as `revokeEntry` when it is on the branch; until then Remove of a listed entry
  // answers revokeUnavailable.
  const actions = new AgentActions({ clock, access, connections, vdcSign })
  return {
    clock,
    listConnections: () => connections.list(),
    memoryNames: async () =>
      Object.fromEntries(
        (await memory.listContexts()).filter((c) => typeof c.name === 'string').map((c) => [c.id, c.name as string])
      ),
    pickerMemories: () => pickerMemories(memory),
    createMemory: (name) => createMemory(memory, name, randomBytes, (error) => consentPendingOf(error) !== undefined),
    countMemory: (contextId) => countMemory(memory, contextId),
    lastCount: async (agentId, contextId) =>
      (await getKeyed<{ count?: number }>(agent, COUNT_RECORD_TYPE, COUNT_KIND, `${agentId}|${contextId}`))?.count,
    saveCount: (agentId, contextId, count) =>
      putKeyed(agent, COUNT_RECORD_TYPE, COUNT_KIND, `${agentId}|${contextId}`, { count }),
    connectGuard: () => connectGuard(memory),
    personas: async () =>
      (await personas())
        .filter((p) => p.vtaDid === undefined || p.vtaDid === vtaDid)
        .map((p) => ({ did: p.did, name: p.label ?? '' })),
    // Records still pairing get their grant or become Not finished, and those Not finished for 10 minutes are removed
    // (§3.10): the sweep drops only what the VTA no longer lists until step 7.10's revoke is here.
    reconcile: async () => {
      await (await driverFor(() => undefined)).reconcilePairing()
      await actions.sweepNotFinished()
    },
    actions,
    driver: (onState) => driverFor(onState),
  }

  function driverFor(onState: Parameters<typeof AgentConnectDriver.create>[1]) {
    return AgentConnectDriver.create(
      {
        clock,
        vtaDid,
        access,
        vdcSign,
        verify: (answer, did) => verifyDocumentProof(agent, answer, did, { proofPurpose: 'assertionMethod' }),
        administrator: administratorSigner(agent, session),
        connections,
        lockoutStore: new KeyedLockoutStore(agent),
        spent: new KeyedSpentRequestStore(agent, clock),
      },
      onState
    )
  }
}
