/**
 * The root that makes the agent-connect screens' hooks work (backlog 2, fb-W1): it builds the production services for
 * the VTA this phone administers and mounts them, so the routes the UI/UX lane registers inside it (`MyAgentStack`)
 * reach real logic. Behind the developer switch: with `isAgentConnectEnabled()` false it renders nothing, and the
 * release gate keeps that switch off in every release.
 *
 * - `connectedAgentsServices(agent, vtaDid, vtaAgent, personas)`: the app's Credo agent, the VTA the phone is linked
 *   to (its administrator), `vtaAgent` for the signed-in session, and the phone's personas.
 * - With `isHcpEnabled()`, also the HCP ports (`hcpVtaPort`, `HcpConnectionStore`, `vtaAgent`'s approvals), given to
 *   the services (their reconcile runs `reconcileHcpApprovals`) and mounted for the HCP hooks. With HCP off none is
 *   built.
 * - **Decided here:** with no administered VTA (no agent, or no link in the `linked` state) it renders nothing too,
 *   never an error screen.
 * - **Decided here:** once mounted, it runs the services' reconcile once, so the repairs it holds (the pairing, the
 *   revoke, the HCP approvals in flight, the sweep, Keep it connected, the VDC re-issue) run when the agent surface
 *   opens and not only when a list is opened. "Approved but not recorded" relies on this (`hcp/reconcile.ts`).
 *
 * @module connected-agents/ConnectedAgentsRoot
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useEffect, useMemo, useSyncExternalStore } from 'react'

import { vtaAgent, type VtaAgentState } from '../trust-tasks/module/vtaAgent'
import { GenericRecordsIdentityStore } from '../trust-tasks/module/VtiIdentityStore'
import { isAgentConnectEnabled } from './agentConnectFlag'
import { ConnectedAgentsProvider } from './ConnectedAgentsProvider'
import { isHcpEnabled } from './hcp/hcpFlag'
import { HcpPortsProvider, hcpPorts } from './hcp/hooks'
import { connectedAgentsServices } from './services'

/**
 * The VTA this phone administers: the linked agent's DID while the link is `linked`, else undefined (not linked, still
 * linking, or revoked, when the phone no longer holds an entry there).
 */
export function administeredVtaDid(state: Pick<VtaAgentState, 'link'>): string | undefined {
  return state.link.kind === 'linked' ? state.link.vtaDid : undefined
}

const administered = () => administeredVtaDid(vtaAgent.getState())

const Mounted: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { agent } = useAgent()
  const vtaDid = useSyncExternalStore(vtaAgent.subscribe, administered)
  const built = useMemo(() => {
    if (!agent || !vtaDid) return undefined
    const personas = () => new GenericRecordsIdentityStore(agent).listPersonas()
    const hcp = isHcpEnabled() ? hcpPorts(agent, vtaDid, vtaAgent) : undefined
    return { services: connectedAgentsServices(agent, vtaDid, vtaAgent, personas, Date.now, hcp), hcp }
  }, [agent, vtaDid])

  useEffect(() => {
    void built?.services.reconcile().catch(() => undefined)
  }, [built])

  if (!built) return null
  const inner = built.hcp ? <HcpPortsProvider ports={built.hcp}>{children}</HcpPortsProvider> : children
  return <ConnectedAgentsProvider services={built.services}>{inner}</ConnectedAgentsProvider>
}

/** Renders `children` inside the agent-connect services, only when agent connect is on and a VTA is administered. */
export const ConnectedAgentsRoot: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  isAgentConnectEnabled() ? <Mounted>{children}</Mounted> : null
