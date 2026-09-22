/**
 * The agent screen after linking: it starts from what the person wants — two
 * doors and where they are on the journey — and the vetter role appears only
 * when a grant stands, never as a locked button up front.
 */
import { act, render } from '@testing-library/react-native'
import React from 'react'
import { DeviceEventEmitter } from 'react-native'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import { VTI_PERSONA_DELIVERIES_EVENT } from '../module/vtiPersonaInbox'
import VtaAgentHome from '../screens/VtaAgentHome'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
const mockGrantState = jest.fn()
jest.mock('../module/vtiGrantState', () => ({
  ownVetterGrantState: (...args: unknown[]) => mockGrantState(...args),
}))

type Setter = { set(next: Record<string, unknown>): void }
type Rec = { tags: Record<string, string>; content: Record<string, unknown> }

const communityDid = 'did:webvh:QmCommunity:vtc.example.org'
const personaDid = 'did:webvh:QmPersona:vta.example.org:p'
const persona: Rec = {
  tags: { recordType: 'keyring/vti-identity', kind: 'persona', key: communityDid },
  content: {
    communityDid,
    vtaDid: 'did:webvh:example:vta',
    did: personaDid,
    contextId: 'vta',
    vtaKeyIds: { signing: 's', keyAgreement: 'k' },
    kmsKeyIds: { signing: 'ks', keyAgreement: 'kk' },
    createdAt: '2026-09-22T00:00:00Z',
  },
}
const grant: Rec = {
  tags: { recordType: 'keyring/vti-community', kind: 'credential', key: 'g1' },
  content: { kind: 'vetter-grant', communityDid, subjectDid: personaDid, credential: {}, receivedAt: '2026-09-22T00:00:00Z' },
}

function fakeAgent(records: Rec[]) {
  return {
    agent: {
      genericRecords: {
        findAllByQuery: async (query: Record<string, string>) =>
          records
            .filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v))
            .map((r) => ({ ...r, id: 'r' })),
      },
      config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
    },
  }
}

describe('Your agent — after linking', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockGrantState.mockReset()
    mockGrantState.mockResolvedValue({ state: 'none' })
    const controller = vtaAgent as unknown as Setter
    controller.set({
      introSeen: true,
      activity: [],
      link: {
        kind: 'linked',
        vtaDid: 'did:webvh:example:vta',
        label: 'bob',
        linkedAt: '2026-09-22T00:00:00Z',
        connection: { kind: 'online', since: 0 },
      },
    })
  })
  afterEach(() => jest.useRealTimers())

  const renderHome = async (records: Rec[]) => {
    const mockUseAgent = useAgent as jest.Mock
    mockUseAgent.mockReturnValue(fakeAgent(records))
    const tree = render(
      <BasicAppContext>
        <VtaAgentHome />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    return tree
  }

  it('a new person sees the journey and two doors, and no vetting button', async () => {
    const tree = await renderHome([])
    expect(tree.getByTestId(testIdWithKey('AgentJourney'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('AgentInvited'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('AgentJoinCommunity'))).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('AgentVetOthers'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('AgentVetterCard'))).toBeNull()
  })

  it('a grant that stands shows "You can now vet people" with the desk', async () => {
    mockGrantState.mockResolvedValue({ state: 'active', statusChecked: true })
    const tree = await renderHome([persona, grant])
    expect(tree.getByTestId(testIdWithKey('AgentVetterCard'))).toHaveTextContent(/VtaLink.YouCanVet/)
    expect(tree.getByTestId(testIdWithKey('AgentVetOthers'))).toBeTruthy()
  })

  it('a revoked grant says so, and offers no desk', async () => {
    mockGrantState.mockResolvedValue({ state: 'revoked', checkedAt: '2026-09-22T00:00:00Z' })
    const tree = await renderHome([persona, grant])
    expect(tree.getByTestId(testIdWithKey('AgentVetterLapsed'))).toHaveTextContent('VtaLink.VetterRevoked')
    expect(tree.queryByTestId(testIdWithKey('AgentVetOthers'))).toBeNull()
  })

  it('a grant that arrives while the screen is open shows without leaving it', async () => {
    const records = [persona]
    const tree = await renderHome(records)
    expect(tree.queryByTestId(testIdWithKey('AgentVetterCard'))).toBeNull()
    records.push(grant)
    mockGrantState.mockResolvedValue({ state: 'active', statusChecked: true })
    await act(async () => {
      DeviceEventEmitter.emit(VTI_PERSONA_DELIVERIES_EVENT, { communityDid, kinds: ['vetter-grant'] })
      jest.advanceTimersByTime(10)
    })
    expect(tree.getByTestId(testIdWithKey('AgentVetterCard'))).toBeTruthy()
  })
})
