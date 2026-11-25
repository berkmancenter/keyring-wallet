/**
 * The agent-kept cards hook (226) offers a card refused for its proof set
 * again once per connect, and not on every new delivery: a VTA on VTI #1868
 * (VTI-44) keeps such a card, so "On this phone only" clears on its own, and a
 * VTA that still refuses is asked once per connect, not hammered.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { DeviceEventEmitter } from 'react-native'

import { VTI_PERSONA_DELIVERIES_EVENT } from '../module/communityChanged'
import { cardVaultStateOf, resetCardVaultCache, useVtiCardVault, VAULT_RECEIVE } from '../module/vtiCardVault'

import {
  COMMUNITY,
  fakeAgent,
  fakeCommunityStore,
  fakeVault,
  persona,
  PERSONA_DID,
  vetterGrantProofSet,
} from '../../../../__tests__/helpers/cardVault'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const grantHeld = {
  kind: 'vetter-grant' as const,
  communityDid: COMMUNITY,
  subjectDid: PERSONA_DID,
  credential: vetterGrantProofSet,
  receivedAt: '2026-09-26T09:05:00Z',
}

// The agent connection, as the hook sees it: a status, and who to tell when it changes.
const mockConnection = {
  status: 'connected' as string,
  vtaDid: persona.vtaDid,
  persona,
  listeners: new Set<() => void>(),
  task: fakeVault().task,
  set(status: string) {
    this.status = status
    for (const l of [...this.listeners]) l()
  },
}
jest.mock('../module/vtaAgent', () => ({
  vtaAgent: {
    getState: () => ({ status: mockConnection.status, vtaDid: mockConnection.vtaDid }),
    subscribe: (l: () => void) => {
      mockConnection.listeners.add(l)
      return () => mockConnection.listeners.delete(l)
    },
    client: () => ({ task: (type: string, payload: Record<string, unknown>) => mockConnection.task(type, payload) }),
  },
}))

const mockCommunity = fakeCommunityStore({ held: [grantHeld] })
jest.mock('../module/VtiCommunityStore', () => ({
  ...jest.requireActual('../module/VtiCommunityStore'),
  GenericRecordsCommunityStore: jest.fn(() => mockCommunity.store),
}))
jest.mock('../module/VtiIdentityStore', () => ({
  ...jest.requireActual('../module/VtiIdentityStore'),
  GenericRecordsIdentityStore: jest.fn(() => ({ listPersonas: async () => [mockConnection.persona] })),
}))

const sends = (vault: ReturnType<typeof fakeVault>) => vault.calls.filter((c) => c.type === VAULT_RECEIVE).length

beforeEach(() => {
  resetCardVaultCache()
  mockConnection.status = 'connected'
  mockConnection.listeners.clear()
})

describe('the hook offers a proof-set card again once per connect', () => {
  it('sends it on a reconnect, and the card is kept once the agent can', async () => {
    const { agent } = fakeAgent()
    const old = fakeVault()
    mockConnection.task = old.task
    renderHook(() => useVtiCardVault(agent))
    await waitFor(() => expect(cardVaultStateOf(vetterGrantProofSet.id)).toMatchObject({ state: 'cannotKeep' }))
    expect(sends(old)).toBe(1)

    // The agent is upgraded (VTI #1868) and the phone reconnects.
    const upgraded = fakeVault({ acceptsProofSets: true })
    mockConnection.task = upgraded.task
    act(() => mockConnection.set('disconnected'))
    act(() => mockConnection.set('connected'))
    await waitFor(() => expect(cardVaultStateOf(vetterGrantProofSet.id)).toMatchObject({ state: 'kept' }))
    expect(sends(upgraded)).toBe(1)
  })

  it('does not send it again when a new delivery arrives on the same connection', async () => {
    const { agent } = fakeAgent()
    const old = fakeVault()
    mockConnection.task = old.task
    renderHook(() => useVtiCardVault(agent))
    await waitFor(() => expect(cardVaultStateOf(vetterGrantProofSet.id)).toMatchObject({ state: 'cannotKeep' }))

    act(() => {
      DeviceEventEmitter.emit(VTI_PERSONA_DELIVERIES_EVENT)
      DeviceEventEmitter.emit(VTI_PERSONA_DELIVERIES_EVENT)
    })
    // Let any run the deliveries started finish.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(sends(old)).toBe(1)
    expect(cardVaultStateOf(vetterGrantProofSet.id)).toEqual({ state: 'cannotKeep', reason: 'proofSet' })
  })
})
