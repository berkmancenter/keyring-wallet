/**
 * The hooks the HCP screens call (backlog 2, fb-W1), over one set of HCP ports: `ConnectedAgentsRoot` builds them
 * with {@link hcpPorts} only when `isHcpEnabled()`, mounts them with {@link HcpPortsProvider}, and gives the same
 * ports to the services, whose reconcile runs `reconcileHcpApprovals` over them. A test passes fakes.
 *
 * - {@link useHcpConnections}: the HCP connections, after the reconcile (as `useAgentConnections` reconciles first).
 * - {@link useHcpApproveFlow}: scan, match and approve (`./approveFlow.ts`) over `vtaAgent`'s approvals, writing the
 *   approval in flight before the approval and the connection after it (`./store.ts`).
 * - {@link useHcpActions}: Revoke (`./revoke.ts`) and a new memory (`./newMemory.ts`).
 *
 * Every result is the existing function's own: a code or copy key the screens word. Nothing here logs a payload, a
 * response or the match number.
 *
 * @module connected-agents/hcp/hooks
 */
import type { Agent } from '@credo-ts/core'
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'

import { useConnectedAgentsServices, useLoaded } from '../ConnectedAgentsProvider'
import { PairingLockout } from '../lockout'
import type { VtaSession } from '../services'
import { KeyedLockoutStore } from '../store'
import { vtaAgentApprovalSource, type HcpApprovalSource } from './approvals'
import { createHcpApproveFlow, type HcpApproveFlow, type HcpApproveState } from './approveFlow'
import { addHcpMemory, type HcpAddMemoryInput, type HcpAddMemoryResult } from './newMemory'
import { revokeHcpGrant, type HcpRevokeResult } from './revoke'
import { beginHcpApproval, HcpConnectionStore, recordHcpApproval } from './store'
import type { HcpConnection, HcpConnectLink } from './types'
import { hcpVtaPort, type HcpVtaPort } from './vtaPort'

/** Everything the HCP hooks and the HCP reconcile use, behind one object. */
export interface HcpPorts {
  /** The person's own VTA, as its Management Client (`hcpVtaPort`). */
  port: HcpVtaPort
  /** The HCP connections, approvals in flight and retiring grants (`HcpConnectionStore`). */
  store: HcpConnectionStore
  /** The consent requests the VTA sent (`vtaAgent`'s approvals). */
  source: HcpApprovalSource
  /** The base path's wrong-number lockout, shared with pairing (`../lockout.ts`). */
  lockout: Pick<PairingLockout, 'state' | 'recordWrongNumber'>
  /** The VTA session, for the manager DID a new memory is about. */
  session: Pick<VtaSession, 'getState'>
  clock: () => Date
}

/**
 * The HCP ports for the VTA this phone administers: built by `ConnectedAgentsRoot` only when `isHcpEnabled()`. The
 * lockout is the base path's own store (`KeyedLockoutStore`), so a wrong number here counts toward the same lockout.
 */
export function hcpPorts(
  agent: Agent,
  vtaDid: string,
  session: VtaSession,
  clock: () => number = Date.now,
  source: HcpApprovalSource = vtaAgentApprovalSource()
): HcpPorts {
  return {
    port: hcpVtaPort(agent, vtaDid, session),
    store: new HcpConnectionStore(agent),
    source,
    lockout: new PairingLockout(new KeyedLockoutStore(agent), clock),
    session,
    clock: () => new Date(clock()),
  }
}

const HcpPortsContext = createContext<HcpPorts | undefined>(undefined)

export const HcpPortsProvider: React.FC<{ ports: HcpPorts; children?: React.ReactNode }> = ({ ports, children }) =>
  React.createElement(HcpPortsContext.Provider, { value: ports }, children)

/** The HCP ports; outside an {@link HcpPortsProvider} (HCP off) it throws, so no HCP screen runs without them. */
export function useHcpPorts(): HcpPorts {
  const ports = useContext(HcpPortsContext)
  if (!ports) throw new Error('useHcpPorts must be used inside an HcpPortsProvider (HCP is off)')
  return ports
}

/**
 * The HCP connections, revoked ones included (`./status.ts` words each). Opening the list reconciles first, as
 * `useAgentConnections` does, so an approval left in flight is completed or revoked before the list is read.
 */
export function useHcpConnections(): { connections: HcpConnection[]; loading: boolean; refresh: () => Promise<void> } {
  const services = useConnectedAgentsServices()
  const { store } = useHcpPorts()
  const load = useCallback(async () => {
    await services.reconcile().catch(() => undefined)
    return store.list()
  }, [services, store])
  const { value, loading, refresh } = useLoaded(load, [] as HcpConnection[])
  return { connections: value, loading, refresh }
}

/**
 * States in which leaving the screen cancels the flow (`cancel` denies a request found; see the hook). Not `idle`:
 * nothing has started, and React's development double mount would otherwise end the flow before it starts.
 */
const CANCEL_ON_LEAVE = new Set<HcpApproveState['state']>(['waiting', 'numberEntry', 'approve'])

/**
 * The HCP approve flow (step 7.27 track C, part 2), one per mounted screen: `start` with the name the person gave and
 * the scanned link (`readHcpConnectLink`), then `typeNumber`, then `approve` (its `decide` runs the phone's owner
 * check). `state` follows the flow.
 *
 * Approve writes the approval in flight first (`beginHcpApproval`) and the connection after (`recordHcpApproval`):
 * "approved but not recorded" is completed by the reconcile (`reconcileHcpApprovals`, in `services.reconcile`).
 *
 * **Decided here:** leaving the screen before Approve is pressed is a Cancel: the flow's subscription and timers end,
 * and a request already found is denied, as Cancel denies it. Once Approve is pressed it is left to finish.
 */
export function useHcpApproveFlow(): {
  state: HcpApproveState
  start: (input: { name: string; link: HcpConnectLink }) => Promise<HcpApproveState>
  typeNumber: (digits: string) => Promise<HcpApproveState>
  approve: () => Promise<HcpApproveState>
  cancel: () => Promise<HcpApproveState>
} {
  const ports = useHcpPorts()
  const [flow] = useState<HcpApproveFlow>(() =>
    createHcpApproveFlow({
      source: ports.source,
      lockout: ports.lockout,
      clock: ports.clock,
      beforeApprove: beginHcpApproval(ports.store),
      onApproved: recordHcpApproval(ports.store),
      threadInUse: (threadId) => ports.store.hasThread(threadId),
    })
  )
  useEffect(
    () => () => {
      if (CANCEL_ON_LEAVE.has(flow.state().state)) void flow.cancel().catch(() => undefined)
    },
    [flow]
  )
  const state = useSyncExternalStore(flow.subscribe, flow.state)
  return useMemo(
    () => ({
      state,
      start: (input) => flow.start(input),
      typeNumber: (digits) => flow.typeNumber(digits),
      approve: () => flow.approve(),
      cancel: () => flow.cancel(),
    }),
    [flow, state]
  )
}

/**
 * The HCP actions: `revoke` an HCP connection's grant by its record id (sent once; a refusal or an unreachable VTA
 * leaves the record unchanged), and `newMemory` (its subject the session's manager DID). Each answers the function's
 * own result; the screen refreshes its own listing after.
 */
export function useHcpActions(): {
  revoke: (id: string) => Promise<HcpRevokeResult>
  newMemory: (input: HcpAddMemoryInput) => Promise<HcpAddMemoryResult>
} {
  const { port, store, session, clock } = useHcpPorts()
  return useMemo(
    () => ({
      revoke: (id: string) => revokeHcpGrant({ port, store, clock }, id),
      newMemory: (input: HcpAddMemoryInput) => addHcpMemory({ port, session }, input),
    }),
    [port, store, session, clock]
  )
}
