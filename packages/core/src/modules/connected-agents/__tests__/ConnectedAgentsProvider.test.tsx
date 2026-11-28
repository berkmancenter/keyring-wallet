import { act, renderHook, waitFor } from '@testing-library/react-native'
import React from 'react'

import {
  ConnectedAgentsProvider,
  ENROLMENT_POLL_MS,
  useAgentConnection,
  useAgentConnections,
  useAgentContacts,
  useAgentPairing,
  useConnectGuard,
  useAgentActions,
  useDeleteMemory,
  useKeepConnectedOffered,
  useMemories,
  useMemoryCounts,
  usePersonas,
  useRevokeDeps,
  type ConnectedAgentsServices,
  type PairingDriver,
} from '../ConnectedAgentsProvider'
import type { PairingState } from '../pairing'
import { FIXTURE_MEMORIES, FIXTURE_NOW, RECORD_FOR_STATUS, agentRecord } from '../testing/fixtures'
import { AGENT_STATUSES } from '../types'

function fakeServices(over: Partial<ConnectedAgentsServices> = {}) {
  const reconciled: number[] = []
  const saved: { agentId: string; contextId: string; count: number }[] = []
  const services: ConnectedAgentsServices = {
    clock: () => FIXTURE_NOW,
    listConnections: async () => [
      ...AGENT_STATUSES.map((s) => RECORD_FOR_STATUS[s].record),
      agentRecord({ id: 'did:key:z6MkStillPairing', name: 'Still pairing', state: 'pairing' }),
    ],
    memoryNames: async () => FIXTURE_MEMORIES,
    pickerMemories: async () => [{ id: 'keyring-memory-educat1on', name: 'Education', containsOthers: false }],
    createMemory: async (name) => ({ ok: true, memory: { id: 'keyring-memory-newnewnewn', name } }),
    countMemory: async (contextId) =>
      contextId === 'keyring-memory-hea1thcar'
        ? { ok: true, count: 1240, lastChange: '2026-11-26T10:00:00Z', complete: true }
        : { ok: false },
    lastCount: async () => 410,
    saveCount: async (agentId, contextId, count) => {
      saved.push({ agentId, contextId, count })
    },
    connectGuard: async () => 'ok',
    personas: async () => [{ did: 'did:webvh:persona.example:ada', name: 'Ada' }],
    reconcile: async () => {
      reconciled.push(1)
    },
    previewDelete: async () => ({ ok: false, code: 'unreachable' }),
    deleteMemory: async () => ({ ok: false, code: 'unreachable' }),
    keepConnectedOffered: async () => false,
    driver: async () => {
      throw new Error('no driver in this test')
    },
    actions: {
      widen: async () => ({ ok: true }),
      narrow: async () => ({ ok: true }),
      restore: async () => ({ ok: true }),
      retryPending: async () => ({ ok: true }),
      extend: async () => ({ ok: true }),
      remove: async () => ({ ok: true }),
      keepConnected: async () => ({ ok: false, code: 'notOffered' }),
    },
    revokeDeps: {
      store: {
        list: async () => [],
        get: async () => undefined,
        update: async () => undefined,
        remove: async () => {},
      },
      vta: { findAgentEntries: async () => ({ complete: true, matches: [] }), revokeSubject: async () => ({}) },
    } as unknown as ConnectedAgentsServices['revokeDeps'],
    reachability: (id) => (id === RECORD_FOR_STATUS.unreachable.record.id ? { reachable: false } : undefined),
    ...over,
  }
  return { services, reconciled, saved }
}

const wrap =
  (services: ConnectedAgentsServices) =>
  ({ children }: { children: React.ReactNode }) => (
    <ConnectedAgentsProvider services={services}>{children}</ConnectedAgentsProvider>
  )

describe('useAgentConnections', () => {
  it('reconciles first, then gives one view per agent, each status, and never a pairing in progress', async () => {
    const { services, reconciled } = fakeServices()
    const { result } = renderHook(() => useAgentConnections(), { wrapper: wrap(services) })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(reconciled).toHaveLength(1)
    expect(result.current.agents.map((a) => a.status).sort()).toEqual([...AGENT_STATUSES].sort())
    expect(result.current.agents.some((a) => a.name === 'Still pairing')).toBe(false)
  })

  it("useAgentConnection finds one agent's view by id", async () => {
    const { services } = fakeServices()
    const id = RECORD_FOR_STATUS.connectedUntil.record.id
    const { result } = renderHook(() => useAgentConnection(id), { wrapper: wrap(services) })
    await waitFor(() => expect(result.current.agent).toBeDefined())
    expect(result.current.agent?.memories.map((m) => m.name)).toEqual(['Education', 'Healthcare'])
  })

  it("drift reaches the details: the entry's contexts as the last reconcile read them, by record id", async () => {
    const id = RECORD_FOR_STATUS.connectedUntil.record.id
    const asked: string[] = []
    const { services } = fakeServices({
      entryContexts: (agentId) => {
        asked.push(agentId)
        // The entry holds Travel, which the owner never bound, and no longer holds Healthcare.
        return agentId === id ? ['keyring-memory-educat1on', 'keyring-memory-trave1abc'] : undefined
      },
    })
    const { result } = renderHook(() => useAgentConnection(id), { wrapper: wrap(services) })
    await waitFor(() => expect(result.current.agent).toBeDefined())
    expect(result.current.agent?.drift).toEqual({
      extra: [{ id: 'keyring-memory-trave1abc', name: 'Travel' }],
      missing: [{ id: 'keyring-memory-hea1thcar', name: 'Healthcare' }],
    })
    expect(asked).toContain(id)
  })

  it('control: with no entryContexts, no view shows drift', async () => {
    // control: passing `entryContexts: []` for every record instead of `services.entryContexts?.(r.id)` in
    // useAgentConnections makes this fail (every bound memory shows as missing).
    const { services } = fakeServices()
    const { result } = renderHook(() => useAgentConnections(), { wrapper: wrap(services) })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.agents.length).toBeGreaterThan(0)
    expect(result.current.agents.filter((a) => a.drift !== undefined)).toEqual([])
  })

  it('outside a provider, a hook says so', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => renderHook(() => useAgentConnections())).toThrow(/ConnectedAgentsProvider/)
  })
})

describe('useAgentContacts (#1060 finding 10)', () => {
  it('only the agents with access, by name', async () => {
    const { services } = fakeServices()
    const { result } = renderHook(() => useAgentContacts(), { wrapper: wrap(services) })
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0))
    expect(result.current.map((c) => c.name)).toEqual(['Inbox triage', 'Not confirmed', 'Notes helper', 'Travel agent'])
  })
})

describe('useAgentPairing', () => {
  it('forwards each step, follows the driver state, and re-lists while waiting for the agent', async () => {
    jest.useFakeTimers()
    let emit: (s: PairingState) => void = () => undefined
    const polls: number[] = []
    const driver: PairingDriver = {
      state: { phase: 'idle' },
      start: jest.fn(async () => ({ phase: 'idle' }) as PairingState),
      scan: jest.fn(async () => ({ phase: 'idle' }) as PairingState),
      enterNumber: jest.fn(async () => ({ sent: true }) as const),
      approve: jest.fn(async () => ({ phase: 'idle' }) as PairingState),
      cancel: jest.fn(async () => ({ phase: 'cancelled' }) as PairingState),
      poll: jest.fn(async () => {
        polls.push(1)
        return { phase: 'idle' } as PairingState
      }),
      settled: async () => undefined,
    }
    const { services } = fakeServices({
      driver: async (onState) => {
        emit = onState
        return driver
      },
    })
    const { result } = renderHook(() => useAgentPairing(), { wrapper: wrap(services) })
    await act(async () => {
      await result.current.approve()
    })
    expect(driver.approve).toHaveBeenCalledTimes(1)
    act(() => emit({ phase: 'awaitingEnrolment' } as unknown as PairingState))
    expect(result.current.state.phase).toBe('awaitingEnrolment')
    await act(async () => {
      jest.advanceTimersByTime(ENROLMENT_POLL_MS * 2)
    })
    expect(polls).toHaveLength(2)
    act(() => emit({ phase: 'cancelled' }))
    await act(async () => {
      jest.advanceTimersByTime(ENROLMENT_POLL_MS * 2)
    })
    expect(polls).toHaveLength(2)
    jest.useRealTimers()
  })
})

describe('memories', () => {
  it('useMemories lists, and a created memory refreshes the list', async () => {
    let listed = 0
    const { services } = fakeServices({
      pickerMemories: async () => {
        listed++
        return []
      },
    })
    const { result } = renderHook(() => useMemories(), { wrapper: wrap(services) })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      expect(await result.current.create('Travel')).toEqual({
        ok: true,
        memory: { id: 'keyring-memory-newnewnewn', name: 'Travel' },
      })
    })
    expect(listed).toBe(2)
  })

  it('useConnectGuard is checking until whoami answers', async () => {
    const { services } = fakeServices({ connectGuard: async () => 'notAdministrator' })
    const { result } = renderHook(() => useConnectGuard(), { wrapper: wrap(services) })
    expect(result.current).toBe('checking')
    await waitFor(() => expect(result.current).toBe('notAdministrator'))
  })

  it('useMemoryCounts: the rise since the last opening and the warning, the new count stored, a failure kept apart', async () => {
    const { services, saved } = fakeServices()
    const { result } = renderHook(
      () => useMemoryCounts('did:key:z6MkNotes', ['keyring-memory-hea1thcar', 'keyring-memory-educat1on']),
      { wrapper: wrap(services) }
    )
    await waitFor(() => expect(result.current).toHaveLength(2))
    expect(result.current[0]).toEqual({
      contextId: 'keyring-memory-hea1thcar',
      failed: false,
      ok: true,
      count: 1240,
      lastChange: '2026-11-26T10:00:00Z',
      complete: true,
      overWarning: true,
      rose: 830,
    })
    expect(result.current[1]).toEqual({ contextId: 'keyring-memory-educat1on', failed: true })
    expect(saved).toEqual([{ agentId: 'did:key:z6MkNotes', contextId: 'keyring-memory-hea1thcar', count: 1240 }])
  })

  it("useDeleteMemory: preview and remove reach the services' step 7.16, the remove only as confirmed", async () => {
    const asked: { memoryId: string; confirmed?: true }[] = []
    const { services } = fakeServices({
      previewDelete: async (memoryId) => {
        asked.push({ memoryId })
        return { ok: true, count: { ok: true, count: 3, complete: true }, overWarning: false, agents: [] }
      },
      deleteMemory: async (memoryId, confirmed) => {
        asked.push({ memoryId, confirmed })
        return { ok: true, recordsNotUpdated: 0 }
      },
    })
    const { result } = renderHook(() => useDeleteMemory(), { wrapper: wrap(services) })
    await act(async () => {
      expect(await result.current.preview('keyring-memory-trave1abc')).toMatchObject({ ok: true, overWarning: false })
      expect(await result.current.remove('keyring-memory-trave1abc', true)).toEqual({ ok: true, recordsNotUpdated: 0 })
    })
    expect(asked).toEqual([
      { memoryId: 'keyring-memory-trave1abc' },
      { memoryId: 'keyring-memory-trave1abc', confirmed: true },
    ])
  })

  it('usePersonas gives the personas for the Acting as row', async () => {
    const { services } = fakeServices()
    const { result } = renderHook(() => usePersonas(), { wrapper: wrap(services) })
    await waitFor(() => expect(result.current).toEqual([{ did: 'did:webvh:persona.example:ada', name: 'Ada' }]))
  })
})

describe('Keep it connected: one path (fb-W1)', () => {
  it('useKeepConnectedOffered is false while it loads, then what the services answer for that agent', async () => {
    let answer: (offered: boolean) => void = () => undefined
    const asked: string[] = []
    const { services } = fakeServices({
      keepConnectedOffered: (agentId) => {
        asked.push(agentId)
        return new Promise<boolean>((resolve) => (answer = resolve))
      },
    })
    const { result } = renderHook(() => useKeepConnectedOffered('did:key:z6MkNotes'), { wrapper: wrap(services) })
    expect(result.current).toBe(false)
    await act(async () => answer(true))
    expect(result.current).toBe(true)
    expect(asked).toEqual(['did:key:z6MkNotes'])
  })

  it('control: an answer that is still loading is never shown as offered, and a failed read is not offered', async () => {
    // control: dropping `value.agentId === agentId` from useKeepConnectedOffered makes this fail: the first agent's
    // true shows for the second while its own answer is still loading.
    let calls = 0
    let second: (offered: boolean) => void = () => undefined
    const { services } = fakeServices({
      keepConnectedOffered: () => {
        calls++
        if (calls === 1) return Promise.resolve(true)
        if (calls === 2) return new Promise<boolean>((resolve) => (second = resolve))
        return Promise.reject(new Error('the store could not be read'))
      },
    })
    const { result, rerender } = renderHook(({ id }) => useKeepConnectedOffered(id), {
      wrapper: wrap(services),
      initialProps: { id: 'did:key:z6MkA' },
    })
    await waitFor(() => expect(result.current).toBe(true))
    rerender({ id: 'did:key:z6MkB' })
    expect(result.current).toBe(false)
    await act(async () => second(false))
    expect(result.current).toBe(false)
    rerender({ id: 'did:key:z6MkC' })
    await waitFor(() => expect(calls).toBe(3))
    expect(result.current).toBe(false)
  })

  it('the act is useAgentActions().keepConnected; the services carry no second keepConnected', async () => {
    const acted: string[] = []
    const { services } = fakeServices()
    services.actions.keepConnected = async (agentId) => {
      acted.push(agentId)
      return { ok: true }
    }
    const { result } = renderHook(() => useAgentActions(), { wrapper: wrap(services) })
    await act(async () => {
      expect(await result.current.keepConnected('did:key:z6MkNotes')).toEqual({ ok: true })
    })
    expect(acted).toEqual(['did:key:z6MkNotes'])
    expect('keepConnected' in services).toBe(false)
  })
})

describe('useRevokeDeps (step 7.10, fb-W1)', () => {
  it("is the services' revoke deps: the connection store and the VTA's revoke, with no tellAgent yet", () => {
    const { services } = fakeServices()
    const { result } = renderHook(() => useRevokeDeps(), { wrapper: wrap(services) })
    expect(result.current).toBe(services.revokeDeps)
    expect(result.current.tellAgent).toBeUndefined()
  })
})
