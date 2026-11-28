/**
 * The HCP hooks (backlog 2, fb-W1) over fake ports and a real `HcpConnectionStore` on in-memory records: the list
 * reconciles first, the approve flow records before and after the approval, leaving before Approve cancels, and the
 * actions reach the VTA port.
 */
import type { Agent } from '@credo-ts/core'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import React from 'react'

import { memoryGenericRecords } from '../../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import type { VtiApproval } from '../../../trust-tasks/module/vtaAgent'
import { setAgentConnectEnabled } from '../../agentConnectFlag'
import { ConnectedAgentsProvider, type ConnectedAgentsServices } from '../../ConnectedAgentsProvider'
import type { HcpApprovalSource } from '../approvals'
import { HCP_CANCEL_REASON } from '../approveFlow'
import { setHcpEnabled } from '../hcpFlag'
import {
  HcpPortsProvider,
  useHcpActions,
  useHcpApproveFlow,
  useHcpConnections,
  useHcpPorts,
  type HcpPorts,
} from '../hooks'
import { HcpConnectionStore } from '../store'
import { HCP_ENTRIES_CREATE, HCP_GRANTS_REVOKE, type HcpConnection } from '../types'
import { CLIENT_VID, GRANT, HELD_AT, hcpApproval, LINK, NUMBER, THREAD } from './fixtures/hcpApproval'

jest.mock('../../../trust-tasks/module/vtaAgent', () => ({ vtaAgent: {} }))

const NOW = HELD_AT + 10 * 1000
const MANAGER = 'did:webvh:QmManager:vta.example.org'

function fakeSource(initial: VtiApproval[]) {
  let approvals = initial
  const listeners = new Set<() => void>()
  const decide = jest.fn(async (id: string, decision: 'approve' | 'deny', _reason?: string) => {
    approvals = approvals.map((a) =>
      a.id === id ? { ...a, status: decision === 'approve' ? 'approved' : 'denied' } : a
    )
    listeners.forEach((l) => l())
  })
  const source: HcpApprovalSource = {
    list: () => approvals,
    subscribe: (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    decide,
  }
  return { source, decide, listening: () => listeners.size }
}

function setup(approvals: VtiApproval[] = [hcpApproval()]) {
  const agent = { genericRecords: memoryGenericRecords() } as unknown as Agent
  const store = new HcpConnectionStore(agent)
  const { source, decide, listening } = fakeSource(approvals)
  const sent: { type: string; payload: Record<string, unknown> }[] = []
  const ports: HcpPorts = {
    port: {
      task: async (type, payload) => {
        sent.push({ type, payload })
        return type === HCP_ENTRIES_CREATE ? { entry: { id: 'entry-1' } } : {}
      },
    },
    store,
    source,
    lockout: { state: async () => ({ locked: false }), recordWrongNumber: async () => ({ locked: false }) },
    session: { getState: () => ({ managerDid: MANAGER }) },
    clock: () => new Date(NOW),
  }
  const order: string[] = []
  const services = {
    reconcile: async () => {
      order.push('reconcile')
    },
  } as unknown as ConnectedAgentsServices
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConnectedAgentsProvider services={services}>
      <HcpPortsProvider ports={ports}>{children}</HcpPortsProvider>
    </ConnectedAgentsProvider>
  )
  return { ports, store, decide, listening, sent, order, wrapper }
}

const connection = (change: Partial<HcpConnection> = {}): HcpConnection => ({
  id: CLIENT_VID,
  name: 'Notes',
  grantId: GRANT,
  threadId: THREAD,
  approvedAt: new Date(NOW).toISOString(),
  expiresAt: new Date(NOW + 14400 * 1000).toISOString(),
  ...change,
})

beforeEach(() => {
  setAgentConnectEnabled(true)
  setHcpEnabled(true)
})
afterEach(() => {
  setHcpEnabled(false)
  setAgentConnectEnabled(false)
})

describe('useHcpPorts', () => {
  it('outside an HcpPortsProvider (HCP off) it says so', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => renderHook(() => useHcpPorts())).toThrow(/HcpPortsProvider/)
  })
})

describe('useHcpConnections', () => {
  it('reconciles first, then lists the HCP connections', async () => {
    const { store, order, wrapper } = setup()
    const list = store.list.bind(store)
    jest.spyOn(store, 'list').mockImplementation(async () => {
      order.push('list')
      return list()
    })
    await store.put(connection())
    const { result } = renderHook(() => useHcpConnections(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(order).toEqual(['reconcile', 'list'])
    expect(result.current.connections.map((c) => c.grantId)).toEqual([GRANT])
  })
})

describe('useHcpApproveFlow', () => {
  it('scan, match and approve: the approval in flight first, then the connection', async () => {
    const { store, decide, wrapper } = setup()
    const putInFlight = jest.spyOn(store, 'putInFlight')
    const { result } = renderHook(() => useHcpApproveFlow(), { wrapper })
    expect(result.current.state).toEqual({ state: 'idle' })
    await act(async () => {
      await result.current.start({ name: 'Notes', link: LINK })
    })
    expect(result.current.state.state).toBe('numberEntry')
    await act(async () => {
      await result.current.typeNumber(NUMBER)
    })
    expect(result.current.state.state).toBe('approve')
    await act(async () => {
      await result.current.approve()
    })
    expect(result.current.state.state).toBe('approved')
    expect(putInFlight.mock.invocationCallOrder[0]).toBeLessThan(decide.mock.invocationCallOrder[0])
    expect(decide).toHaveBeenCalledWith('consent-1', 'approve')
    expect(await store.get(CLIENT_VID)).toMatchObject({ grantId: GRANT, name: 'Notes' })
    expect(await store.listInFlight()).toEqual([])
  })

  it('leaving the screen after the request was found cancels: the request is denied and the flow stops listening', async () => {
    // control: taking 'numberEntry' out of CANCEL_ON_LEAVE (hooks.ts) makes this fail: nothing is denied, and the
    // flow still listens after the screen is gone.
    const { decide, listening, wrapper } = setup()
    const { result, unmount } = renderHook(() => useHcpApproveFlow(), { wrapper })
    await act(async () => {
      await result.current.start({ name: 'Notes', link: LINK })
    })
    expect(result.current.state.state).toBe('numberEntry')
    expect(listening()).toBe(1)
    await act(async () => {
      unmount()
    })
    expect(decide).toHaveBeenCalledWith('consent-1', 'deny', HCP_CANCEL_REASON)
    expect(listening()).toBe(0)
  })

  it('leaving while still waiting for the request cancels without a deny (none was found)', async () => {
    const { decide, listening, wrapper } = setup([])
    const { result, unmount } = renderHook(() => useHcpApproveFlow(), { wrapper })
    await act(async () => {
      await result.current.start({ name: 'Notes', link: LINK })
    })
    expect(result.current.state.state).toBe('waiting')
    unmount()
    expect(decide).not.toHaveBeenCalled()
    expect(listening()).toBe(0)
  })

  it('leaving after the end sends nothing more', async () => {
    const done = setup()
    const { result, unmount } = renderHook(() => useHcpApproveFlow(), { wrapper: done.wrapper })
    await act(async () => {
      await result.current.start({ name: 'Notes', link: LINK })
      await result.current.typeNumber(NUMBER)
      await result.current.approve()
    })
    expect(result.current.state.state).toBe('approved')
    unmount()
    expect(done.decide.mock.calls).toEqual([['consent-1', 'approve']])
  })
})

describe('useHcpActions', () => {
  it("revoke sends hcp/grants/revoke for the record's grant, and marks it revoked", async () => {
    const { store, sent, wrapper } = setup()
    await store.put(connection())
    const { result } = renderHook(() => useHcpActions(), { wrapper })
    let outcome: Awaited<ReturnType<typeof result.current.revoke>> | undefined
    await act(async () => {
      outcome = await result.current.revoke(CLIENT_VID)
    })
    expect(outcome).toMatchObject({ ok: true, connection: { revokedAt: new Date(NOW).toISOString() } })
    expect(sent).toEqual([{ type: HCP_GRANTS_REVOKE, payload: { grantId: GRANT } }])
  })

  it("newMemory sends hcp/entries/create about the session's manager DID", async () => {
    const { sent, wrapper } = setup()
    const { result } = renderHook(() => useHcpActions(), { wrapper })
    let outcome: Awaited<ReturnType<typeof result.current.newMemory>> | undefined
    await act(async () => {
      outcome = await result.current.newMemory({ text: 'I prefer mornings', language: 'en', now: new Date(NOW) })
    })
    expect(outcome).toEqual({ ok: true, entry: { id: 'entry-1' } })
    expect(sent.map((s) => s.type)).toEqual([HCP_ENTRIES_CREATE])
    expect(JSON.stringify(sent[0].payload)).toContain(MANAGER)
  })
})
