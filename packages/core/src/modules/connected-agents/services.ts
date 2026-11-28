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
import { consentPendingOf, VTA_TASK, type VtaClient } from '../trust-tasks/module/VtaClient'
import { AgentActions, type RevokeEntryPort } from './actions'
import type { AgentAccessPort } from './carriage'
import type { AdministratorSigner } from './deviceEnrolDraft'
import type { AgentActionsPort, ConnectedAgentsServices } from './ConnectedAgentsProvider'
import type { HcpPorts } from './hcp/hooks'
import { reconcileHcpApprovals } from './hcp/reconcile'
import { deleteMemory, previewDelete, type DeleteMemoryPorts } from './deleteMemory'
import { AgentConnectDriver } from './driver'
import { entryContexts, readAgentEntries, type EntryRead } from './entryRead'
import {
  keepConnected,
  KeepConnectedIntentStore,
  keepConnectedOffered,
  settleKeepConnected,
  type KeepConnectedPorts,
} from './keepConnected'
import { connectGuard, countMemory, createMemory, pickerMemories, type MemoryPort } from './memories'
import { reconcileAgents, removeAgentEntries, type RevokeDeps, type RevokeVta } from './revoke'
import { AgentConnectionStore, KeyedLockoutStore, KeyedSpentRequestStore } from './store'
import type { AgentConnection } from './types'
import type { VdcSignPort } from './vdc'
import { reissueDueGrants } from './vdcReissue'

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
  // Step 7.10's two calls (#1077): the listing by device and key, and `acl/revoke` of one subject.
  const revokeVta: RevokeVta = {
    findAgentEntries: (query) => on((c) => c.findAgentEntries(query)),
    revokeSubject: (did) => on((c) => c.revokeSubject(did)),
  }
  // Tasks this phone sends about its own VTA's access list or contexts: a rule that holds them may name this phone as
  // the approver, so a hold is refused at once rather than waited on (approvalRules.ts, PHONE_SENDS).
  const ownTask = (type: string, payload: Record<string, unknown>) =>
    on((c) => c.task(type, payload, 30000, {}, undefined, { waitForConsent: false }))
  const listAcl = () => on((c) => c.listAcl())
  return { access, vdcSign, memory, revokeVta, ownTask, listAcl }
}

/**
 * Remove's revoke of a listed entry (`AgentActions`' `revokeEntry`): `gone` only when a full listing no longer shows
 * it, and a VTA that gave no answer throws, which Remove answers as `unreachable`.
 *
 * With a `deviceId`, `removeAgentEntries` (#1077) revokes and re-lists by the device. Without one it would answer
 * `noDeviceId` at once, so here the stored key is revoked (a refusal, such as `subjectNotPresent`, is ignored: the
 * listing decides) and the VTA is listed by that key: `gone` only when that listing is complete and shows no entry
 * under it. Remove reaches this only once its own listing showed the entry, so this does not prove a rotated entry
 * gone; it proves the stored key no longer holds one.
 */
export function revokeEntryPort(vta: RevokeVta): RevokeEntryPort {
  return async (record) => {
    if (record.deviceId) {
      const outcome = await removeAgentEntries(vta, record)
      if (outcome.kind === 'unreachable') throw new Error('the VTA did not answer the revoke')
      return { gone: outcome.kind === 'revoked' }
    }
    try {
      await vta.revokeSubject(record.agentDid)
    } catch {
      // A refusal or a lost call: the listing below decides.
    }
    const found = await vta.findAgentEntries({ subject: record.agentDid })
    return { gone: found.complete && found.matches.length === 0 }
  }
}

/**
 * The services for the VTA this phone administers. The administrator DID is read from the session when it signs
 * (it changes when the phone's key is rotated); with none, signing fails and the pairing fails as unreachable.
 *
 * `hcp` is given only with `isHcpEnabled()` (`ConnectedAgentsRoot` builds it): the reconcile then also runs
 * `reconcileHcpApprovals` over those ports. Without it no HCP port is built and the reconcile has no HCP step.
 */
export function connectedAgentsServices(
  agent: Agent,
  vtaDid: string,
  session: VtaSession,
  personas: PersonaSource,
  clock: () => number = Date.now,
  hcp?: HcpPorts
): ConnectedAgentsServices {
  const { access, vdcSign, memory, revokeVta, ownTask, listAcl } = vtaPorts(agent, vtaDid, session)
  const connections = new AgentConnectionStore(agent)
  const randomBytes = (length: number) => agent.kms.randomBytes({ length })
  const agentActions = new AgentActions({
    clock,
    access,
    connections,
    vdcSign,
    revokeEntry: revokeEntryPort(revokeVta),
  })
  // Step 7.16's delete (#1090). The delete is sent with `waitForConsent: false`; `approvalRules.test.ts` scans only
  // `trust-tasks/module`, so `services.test.ts` checks it.
  const deletePorts: DeleteMemoryPorts = {
    listEntries: listAcl,
    deleteContext: async (id, force) => {
      // version-pinned: §3.15 names vta/contexts/delete/1.2
      await ownTask(VTA_TASK.contextsDelete12, { id, force })
    },
    isHeld: (error) => consentPendingOf(error) !== undefined,
    task: memory.task,
    store: connections,
  }
  // Step 7.28's "Keep it connected" (fb-4): built, and offered only once `KEEP_CONNECTED_MEASURED` is true. Its intent
  // is written under `keyring/keep-connected` before the update is sent, and the reconcile settles any it left.
  const keepIntents = new KeepConnectedIntentStore(agent)
  const keepPorts: KeepConnectedPorts = { clock, access, task: ownTask, vdcSign, connections, intents: keepIntents }
  const actions: AgentActionsPort = {
    widen: (agentId, memoryId) => agentActions.widen(agentId, memoryId),
    narrow: (agentId, memoryId) => agentActions.narrow(agentId, memoryId),
    restore: (agentId) => agentActions.restore(agentId),
    retryPending: (agentId) => agentActions.retryPending(agentId),
    extend: (agentId) => agentActions.extend(agentId),
    remove: (agentId) => agentActions.remove(agentId),
    // The one path for the act (fb-W1): a screen asks `useKeepConnectedOffered` first, then calls this, and
    // `keepConnected` itself refuses an agent it is not offered for (`notOffered`).
    keepConnected: (agentId) => keepConnected(keepPorts, agentId),
  }
  // Step 7.10's revoke, for the routed container's own `revokeAgentConnection(deps, id)` (`useRevokeDeps`): the same
  // store and VTA calls the reconcile uses, so a revoke left `revoking` is the one the reconcile runs again. `tellAgent`
  // stays absent until the chat's control messages (fb-C3) give one.
  const revokeDeps: RevokeDeps<AgentConnection> = { store: connections, vta: revokeVta, now: clock }
  // The entries as the last reconcile read them, by record id: the details' drift reads these, never a fresh listing.
  let lastReads: ReadonlyMap<string, EntryRead> = new Map()
  const step = async (run: () => Promise<unknown>) => {
    try {
      await run()
    } catch {
      // Each step stands alone: one failing (the VTA not answering, a record that cannot be written) does not stop
      // the next, and the reconcile is asked again at the next opening.
    }
  }
  const reconcileOnce = async () => {
    await step(async () => (await driverFor(() => undefined)).reconcilePairing())
    await step(() => reconcileAgents(revokeDeps))
    // Only with the HCP ports, which the root builds only with `isHcpEnabled()`: no HCP port, no HCP step.
    if (hcp) {
      await step(() =>
        reconcileHcpApprovals({ store: hcp.store, source: hcp.source, port: hcp.port, clock: hcp.clock })
      )
    }
    await step(() => agentActions.sweepNotFinished())
    await step(() => settleKeepConnected({ access, connections, intents: keepIntents }))
    // A store that cannot be read leaves no reads: no drift is shown from an older reconcile, and nothing is due.
    let records: AgentConnection[] = []
    lastReads = new Map()
    await step(async () => {
      records = await connections.list()
      lastReads = await readAgentEntries(access, records)
    })
    await step(() => reissueDueGrants({ clock, vdcSign, connections }, records, lastReads))
  }
  // One reconcile at a time: one asked while another runs joins it, so the root's opening reconcile and a list's own
  // never run the same repairs side by side (`reconcileHcpApprovals` sends each revoke once per run).
  let reconciling: Promise<void> | undefined
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
    // In order, each step catching its own failure: records still pairing get their grant or become Not finished; a
    // revoke left `revoking` runs again and an active or expired agent is listed (§3.9, #1077); with the HCP ports, the
    // HCP approvals in flight are completed or their grants revoked, and retiring grants revoked (§7.27 track C, part
    // 3); those Not finished for 10 minutes are removed (§3.10); a "Keep it connected" left unfinished is settled from a
    // fresh read of its entry (§7.28, fb-4), before the reads below so a record it makes persistent is read and
    // re-issued as one; each active or expired agent's entry is read once, kept for drift; and grants with 48 hours or
    // less left are re-issued from those reads (§3.4).
    reconcile: () => {
      if (!reconciling) reconciling = reconcileOnce().finally(() => (reconciling = undefined))
      return reconciling
    },
    entryContexts: (agentId) => entryContexts(lastReads.get(agentId)),
    previewDelete: (memoryId) => previewDelete(deletePorts, memoryId),
    deleteMemory: (memoryId, confirmed) => deleteMemory(deletePorts, memoryId, confirmed),
    keepConnectedOffered: async (agentId) => {
      const record = await connections.get(agentId)
      return record !== undefined && keepConnectedOffered(record, clock())
    },
    actions,
    revokeDeps,
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
