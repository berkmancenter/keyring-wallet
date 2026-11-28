/**
 * The hooks the agent-connect screens call (the seam agreed with the UI/UX lane, 2026-11-26), over one services
 * object: production builds it from the owner's VTA session (`services.ts`), and a test passes fakes. Nothing here
 * holds copy; every state is a code the screens word.
 *
 * @module connected-agents/ConnectedAgentsProvider
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

import type { ActionResult } from './actions'
import type { DeleteMemoryResult, DeletePreview } from './deleteMemory'
import type { KeepConnectedResult } from './keepConnected'
import type { ConnectGuard, MemoryCount } from './memories'
import { countNotice } from './memories'
import type { AgentConnectChoice, NumberEntry, PairingLink, PairingState } from './pairing'
import type { RevokeDeps } from './revoke'
import { agentContacts, viewOf, type Reachability } from './status'
import type { AgentConnection, AgentView, CreateMemoryResult, PickerMemory } from './types'

/** The driver as the hooks use it (`AgentConnectDriver`). */
export interface PairingDriver {
  readonly state: PairingState
  start(choice: AgentConnectChoice): Promise<PairingState>
  scan(link: PairingLink): Promise<PairingState>
  enterNumber(digits: string): Promise<NumberEntry>
  approve(): Promise<PairingState>
  cancel(): Promise<PairingState>
  poll(): Promise<PairingState>
  settled(): Promise<unknown>
}

/** Everything the hooks read and do, behind one interface. */
export interface ConnectedAgentsServices {
  clock: () => number
  listConnections(): Promise<AgentConnection[]>
  /** The memory names by context id, for views (a context id is never shown as a name). */
  memoryNames(): Promise<Record<string, string>>
  pickerMemories(): Promise<PickerMemory[]>
  createMemory(name: string): Promise<CreateMemoryResult>
  countMemory(contextId: string): Promise<MemoryCount>
  /** The count stored at the last opening, and storing this one. */
  lastCount(agentId: string, contextId: string): Promise<number | undefined>
  saveCount(agentId: string, contextId: string, count: number): Promise<void>
  connectGuard(): Promise<ConnectGuard>
  personas(): Promise<{ did: string; name: string }[]>
  /**
   * Asked where the VDC policy is asked (§3.4): records still pairing get their grant or become Not finished, a revoke
   * left unconfirmed runs again, each agent's entry is read once, and grants close to their end are re-issued.
   */
  reconcile(): Promise<void>
  /** The contexts the agent's entry held at the last reconcile, for drift; undefined when nothing was proved. */
  entryContexts?(agentId: string): readonly string[] | undefined
  /** Step 7.16's confirmation: the memory's count and the agents bound to it. Sends no delete. */
  previewDelete(memoryId: string): Promise<DeletePreview>
  /** Step 7.16's delete, only after the owner confirmed the preview. */
  deleteMemory(memoryId: string, confirmed: true): Promise<DeleteMemoryResult>
  /**
   * Whether "Keep it connected" is offered for this agent (false while `KEEP_CONNECTED_MEASURED` is false). The act
   * itself is `actions.keepConnected`, the one path (fb-W1), so the two cannot drift apart.
   */
  keepConnectedOffered(agentId: string): Promise<boolean>
  driver(onState: (state: PairingState) => void): Promise<PairingDriver>
  /** Step 7.7's actions on one agent (`connected-agents/actions.ts`); Remove revokes a listed entry (step 7.10). */
  actions: AgentActionsPort
  /**
   * Step 7.10's revoke, for the routed container's own `revokeAgentConnection(deps, id)` (`useRevokeDeps`): the
   * connection store and the VTA's revoke calls, the same ones the reconcile runs a `revoking` record again with.
   */
  revokeDeps: RevokeDeps<AgentConnection>
  reachability?: (agentId: string) => Reachability
}

/** The actions the agent list and the details call (`AgentActions`), by the agent's record id. */
export interface AgentActionsPort {
  widen(agentId: string, memoryId: string): Promise<ActionResult>
  narrow(agentId: string, memoryId: string): Promise<ActionResult>
  restore(agentId: string): Promise<ActionResult>
  retryPending(agentId: string): Promise<ActionResult>
  extend(agentId: string): Promise<ActionResult>
  remove(agentId: string): Promise<ActionResult>
  /**
   * Step 7.28's "Keep it connected" (`connected-agents/keepConnected.ts`), the one path for the act: called only after
   * `useKeepConnectedOffered(agentId)` said true. It refuses an agent it is not offered for (`notOffered`).
   */
  keepConnected(agentId: string): Promise<KeepConnectedResult>
}

const ServicesContext = createContext<ConnectedAgentsServices | undefined>(undefined)

export const ConnectedAgentsProvider: React.FC<{ services: ConnectedAgentsServices; children?: React.ReactNode }> = ({
  services,
  children,
}) => <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>

export function useConnectedAgentsServices(): ConnectedAgentsServices {
  const services = useContext(ServicesContext)
  if (!services) throw new Error('useConnectedAgentsServices must be used inside a ConnectedAgentsProvider')
  return services
}

/** How often a pairing waiting for the agent's registration and rotation re-lists its entry (#1060 finding 11). */
export const ENROLMENT_POLL_MS = 15_000

/**
 * Run `load` on mount and on `refresh`; the last answer wins, and an unmounted hook sets nothing. Exported for the
 * HCP hooks (`hcp/hooks.ts`), not for screens.
 */
export function useLoaded<T>(
  load: () => Promise<T>,
  initial: T
): { value: T; loading: boolean; refresh: () => Promise<void> } {
  const [value, setValue] = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const live = useRef(true)
  const seq = useRef(0)
  const refresh = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true)
    try {
      const next = await load()
      if (live.current && mine === seq.current) setValue(next)
    } finally {
      if (live.current && mine === seq.current) setLoading(false)
    }
  }, [load])
  useEffect(() => {
    live.current = true
    void refresh()
    return () => {
      live.current = false
    }
  }, [refresh])
  return { value, loading, refresh }
}

/**
 * The owner's agents as views, for "AI agents" and the details. Opening it is one of the points where the VDC policy
 * is asked (§3.4), so it reconciles first.
 */
export function useAgentConnections(): { agents: AgentView[]; loading: boolean; refresh: () => Promise<void> } {
  const services = useConnectedAgentsServices()
  const load = useCallback(async () => {
    await services.reconcile().catch(() => undefined)
    const [records, names] = await Promise.all([services.listConnections(), services.memoryNames().catch(() => ({}))])
    const now = services.clock()
    return records
      .map((r) =>
        viewOf(r, {
          now,
          reach: services.reachability?.(r.id),
          names: (id) => (names as Record<string, string>)[id],
          entryContexts: services.entryContexts?.(r.id),
        })
      )
      .filter((v): v is AgentView => v !== undefined)
  }, [services])
  const { value, loading, refresh } = useLoaded(load, [] as AgentView[])
  return { agents: value, loading, refresh }
}

/** One agent's view, or undefined (not found, or still pairing). */
export function useAgentConnection(agentId: string): {
  agent?: AgentView
  loading: boolean
  refresh: () => Promise<void>
} {
  const { agents, loading, refresh } = useAgentConnections()
  return { agent: agents.find((a) => a.id === agentId), loading, refresh }
}

/** The second source for `ListContacts` (#1060 finding 10): the agents with access, by name. */
export function useAgentContacts(): { agentId: string; name: string; handle: string }[] {
  const services = useConnectedAgentsServices()
  const load = useCallback(
    async () => agentContacts(await services.listConnections(), services.clock(), services.reachability),
    [services]
  )
  return useLoaded(load, [] as { agentId: string; name: string; handle: string }[]).value
}

/**
 * The connect flow. While the pairing waits for the agent (`awaitingEnrolment`), it re-lists the entry every
 * {@link ENROLMENT_POLL_MS}. The screen calls `approve` only after the phone's face or fingerprint check passed.
 */
export function useAgentPairing(): {
  state: PairingState
  start: (choice: AgentConnectChoice) => Promise<PairingState>
  scan: (link: PairingLink) => Promise<PairingState>
  enterNumber: (digits: string) => Promise<NumberEntry>
  approve: () => Promise<PairingState>
  cancel: () => Promise<PairingState>
} {
  const services = useConnectedAgentsServices()
  const [state, setState] = useState<PairingState>({ phase: 'idle' })
  const driver = useRef<Promise<PairingDriver> | undefined>(undefined)
  const get = useCallback(() => {
    if (!driver.current) driver.current = services.driver(setState)
    return driver.current
  }, [services])

  useEffect(() => {
    if (state.phase !== 'awaitingEnrolment') return
    const timer = setInterval(() => {
      void get().then((d) => d.poll())
    }, ENROLMENT_POLL_MS)
    return () => clearInterval(timer)
  }, [state.phase, get])

  return {
    state,
    start: (choice) => get().then((d) => d.start(choice)),
    scan: (link) => get().then((d) => d.scan(link)),
    enterNumber: (digits) => get().then((d) => d.enterNumber(digits)),
    approve: () => get().then((d) => d.approve()),
    cancel: () => get().then((d) => d.cancel()),
  }
}

/** The picker's memories and "New memory" (§3.15). A created memory appears in the next listing. */
export function useMemories(): {
  memories: PickerMemory[]
  loading: boolean
  create: (name: string) => Promise<CreateMemoryResult>
} {
  const services = useConnectedAgentsServices()
  const load = useCallback(() => services.pickerMemories(), [services])
  const { value, loading, refresh } = useLoaded(load, [] as PickerMemory[])
  const create = useCallback(
    async (name: string) => {
      const result = await services.createMemory(name)
      if (result.ok) await refresh()
      return result
    },
    [services, refresh]
  )
  return { memories: value, loading, create }
}

/** The guard before the picker shows (§3.15): `checking` until whoami answers. */
export function useConnectGuard(): ConnectGuard | 'checking' {
  const services = useConnectedAgentsServices()
  const load = useCallback(() => services.connectGuard(), [services])
  return useLoaded<ConnectGuard | 'checking'>(load, 'checking').value
}

/** One memory's count as the details show it. */
export type MemoryCountView =
  | { contextId: string; failed: true }
  | {
      contextId: string
      failed: false
      count: number
      lastChange?: string
      complete: boolean
      overWarning: boolean
      rose?: number
    }

/**
 * The details' memory counts (§3.15): counted once when the details open, never on a timer, each compared with the
 * count stored at the last opening (the rise), which is then replaced.
 */
export function useMemoryCounts(agentId: string, contextIds: readonly string[]): MemoryCountView[] {
  const services = useConnectedAgentsServices()
  const key = contextIds.join('\n')
  const load = useCallback(async () => {
    const out: MemoryCountView[] = []
    for (const contextId of key ? key.split('\n') : []) {
      const counted = await services.countMemory(contextId)
      if (!counted.ok) {
        out.push({ contextId, failed: true })
        continue
      }
      const previous = await services.lastCount(agentId, contextId)
      await services.saveCount(agentId, contextId, counted.count)
      out.push({ contextId, failed: false, ...counted, ...countNotice(counted.count, previous) })
    }
    return out
  }, [services, agentId, key])
  return useLoaded(load, [] as MemoryCountView[]).value
}

/** The owner's personas, for the "Acting as" row, shown only with more than one (#1060 finding 18). */
export function usePersonas(): { did: string; name: string }[] {
  const services = useConnectedAgentsServices()
  const load = useCallback(() => services.personas(), [services])
  return useLoaded(load, [] as { did: string; name: string }[]).value
}

/**
 * Step 7.7's actions, for the list and the details (§3.15 items 4 and 5, §7.7). Each answers what the VTA did; the
 * screen has already taken the owner's decision (the biometric before a widening and Extend, a confirmation before a
 * narrowing and Restore), and refreshes its own listing after.
 */
export function useAgentActions(): AgentActionsPort {
  return useConnectedAgentsServices().actions
}

/**
 * Whether "Keep it connected" (step 7.28) is offered for this agent: the only way a screen learns it. False while it
 * loads, and false when the record cannot be read. The act is `useAgentActions().keepConnected(agentId)`, called only
 * after this said true.
 */
export function useKeepConnectedOffered(agentId: string): boolean {
  const services = useConnectedAgentsServices()
  const load = useCallback(
    async () => ({ agentId, offered: await services.keepConnectedOffered(agentId).catch(() => false) }),
    [services, agentId]
  )
  const { value, loading } = useLoaded<{ agentId?: string; offered: boolean }>(load, { offered: false })
  // Keyed by the agent: an answer for the agent shown before is never read as this one's.
  return !loading && value.agentId === agentId && value.offered
}

/**
 * The deps for step 7.10's revoke, for the routed container's own `revokeAgentConnection(deps, id)` (the release gate
 * wants that call in a routed file, so no hook here makes it). `store` is the connection store and `vta` the
 * services' `revokeVta`; `tellAgent` is absent until the chat's control messages (fb-C3) give one.
 */
export function useRevokeDeps(): RevokeDeps<AgentConnection> {
  return useConnectedAgentsServices().revokeDeps
}

/**
 * Step 7.16's delete of a memory (§3.15): `preview` for the confirmation (the count and the agents bound to it), then
 * `remove` once the owner confirmed it. Each answers a code the screen words; the screen refreshes its own listing.
 */
export function useDeleteMemory(): {
  preview: (memoryId: string) => Promise<DeletePreview>
  remove: (memoryId: string, confirmed: true) => Promise<DeleteMemoryResult>
} {
  const services = useConnectedAgentsServices()
  const preview = useCallback((memoryId: string) => services.previewDelete(memoryId), [services])
  const remove = useCallback(
    (memoryId: string, confirmed: true) => services.deleteMemory(memoryId, confirmed),
    [services]
  )
  return { preview, remove }
}
