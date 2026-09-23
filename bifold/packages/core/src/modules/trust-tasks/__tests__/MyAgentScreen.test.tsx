/**
 * My Agent — the connected gate and the vetting seat. Before the agent is
 * connected the screen offers exactly one thing to do (connect, with the
 * manager identity to enrol); once it is, what the agent holds appears, led
 * by the vetting entry that names the seat this phone takes.
 */
import { render, act } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import MyAgent from '../screens/MyAgent'
import { vtaAgent } from '../module/vtaAgent'
import { vtiAgent } from '../module/vtiAgent'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
// The VTA session itself is out of scope here: a client that reports itself
// connected, so the controller's `connect` is a no-op and the screen reads
// the state the test sets.
jest.mock('../module/VtaClient', () => ({
  VTA_TASK: { consentRequest: 'consent-request', consentGranted: 'consent-granted' },
  resolveVtaMediator: async () => Promise.reject(new Error('offline')),
  VtaClient: class {
    isConnected = true
    managerDid = 'did:key:z6MkManager'
    async connect() {}
    async whoAmI() {
      return {}
    }
    async ensureManagerIdentity() {
      return 'did:key:z6MkManager'
    }
  },
}))

type Setter = { set(next: Record<string, unknown>): void }
const mockUseAgent = useAgent as jest.Mock
const setVta = (next: Record<string, unknown>) => (vtaAgent as unknown as Setter).set(next)
const setVti = (next: Record<string, unknown>) => (vtiAgent as unknown as Setter).set(next)

const config = {
  mediatorDid: 'did:peer:2:mediator',
  communityDid: 'did:webvh:example:community',
  vtaDid: 'did:webvh:example:vta',
}
const personaDid = 'did:webvh:example:persona'

/** A generic-records store the screen's three stores can read from. */
function fakeAgent(records: { tags: Record<string, string>; content: Record<string, unknown> }[]) {
  return {
    agent: {
      genericRecords: {
        findAllByQuery: async (query: Record<string, string>) =>
          records
            .filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v))
            .map((r) => ({ ...r, id: 'r' })),
        save: async () => undefined,
        update: async () => undefined,
        delete: async () => undefined,
      },
      dids: { resolveDidDocument: async () => Promise.reject(new Error('offline')) },
      config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
    },
  }
}

const manager = {
  tags: { recordType: 'keyring/vti-identity', kind: 'manager', key: config.vtaDid },
  content: { vtaDid: config.vtaDid, did: 'did:key:z6MkManager', createdAt: '2026-09-18T00:00:00Z' },
}
const persona = {
  tags: { recordType: 'keyring/vti-identity', kind: 'persona', key: config.communityDid },
  content: {
    communityDid: config.communityDid,
    vtaDid: config.vtaDid,
    did: personaDid,
    contextId: 'vta',
    vtaKeyIds: { signing: 's', keyAgreement: 'k' },
    kmsKeyIds: { signing: 'ks', keyAgreement: 'kk' },
    createdAt: '2026-09-18T00:00:00Z',
  },
}
const vetterGrant = {
  tags: { recordType: 'keyring/vti-community', kind: 'credential', key: 'g1' },
  content: {
    kind: 'vetter-grant',
    communityDid: config.communityDid,
    subjectDid: personaDid,
    credential: {},
    receivedAt: '2026-09-18T00:00:00Z',
  },
}

describe('My Agent — the connected gate', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    setVta({
      status: 'disconnected',
      approvals: [],
      managerDid: undefined,
      error: undefined,
    })
    setVti({ status: 'disconnected', did: undefined, host: undefined, error: undefined })
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  test('not connected: one primary action, the identity to enrol, and none of the holdings', async () => {
    mockUseAgent.mockReturnValue(fakeAgent([]))
    const tree = render(
      <BasicAppContext>
        <MyAgent config={config} />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    expect(tree.queryByTestId(testIdWithKey('ConnectMyAgentButton'))).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('MyAgentEnrolCard'))).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('MyAgentVettingRow'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('MyAgentIdentityCard'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('MyAgentNoInvitations'))).toBeNull()
  })

  /**
   * A store build names no agent, community or mediator: testers bring their
   * own. It used to stop at "No agent is configured for this build", with the
   * link doors behind that wall, so a fresh tester could not link at all.
   */
  test('a build that names nothing: the way to link, never "not configured"', async () => {
    mockUseAgent.mockReturnValue(fakeAgent([]))
    setVta({ link: { kind: 'notLinked' } })
    const tree = render(
      <BasicAppContext>
        <MyAgent config={{}} />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    expect(tree.queryByTestId(testIdWithKey('MyAgentNotConfigured'))).toBeNull()
    expect(tree.getByTestId(testIdWithKey('LinkYourAgentButton'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('LinkWithoutQrButton'))).toBeTruthy()
    // With no agent there is nothing to connect to, so no button that could only fail.
    expect(tree.queryByTestId(testIdWithKey('ConnectMyAgentButton'))).toBeNull()
  })

  /** The one client for the VTA exists before the state is set, so mounting does not reset it. */
  const connectedTo = (agent: ReturnType<typeof fakeAgent>) => {
    vtaAgent.client(agent.agent as never, config.vtaDid)
    setVta({ status: 'connected', managerDid: 'did:key:z6MkManager', approvals: [] })
  }

  test('connected: the agent card, then the vetting entry naming the applicant seat by default', async () => {
    const agent = fakeAgent([manager, persona])
    mockUseAgent.mockReturnValue(agent)
    connectedTo(agent)
    const tree = render(
      <BasicAppContext>
        <MyAgent config={config} />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    expect(tree.queryByTestId(testIdWithKey('ConnectMyAgentButton'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('MyAgentCard'))).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('MyAgentVettingRow'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('MyAgentVettingSeat'))).toHaveTextContent('Vetting.SeatApplicant')
    expect(tree.getByTestId(testIdWithKey('MyAgentVettingOpen'))).toHaveTextContent(/Vetting.GetVetted/)
    expect(tree.getByTestId(testIdWithKey('MyAgentPersonaDid'))).toHaveTextContent(personaDid)
  })

  test('a vetter grant for this persona turns the entry into the desk', async () => {
    const agent = fakeAgent([manager, persona, vetterGrant])
    mockUseAgent.mockReturnValue(agent)
    connectedTo(agent)
    const tree = render(
      <BasicAppContext>
        <MyAgent config={config} />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    expect(tree.getByTestId(testIdWithKey('MyAgentVettingSeat'))).toHaveTextContent('Vetting.SeatVetter')
    expect(tree.getByTestId(testIdWithKey('MyAgentVettingOpen'))).toHaveTextContent(/Vetting.OpenDesk/)
  })

  test('while connecting, the step is named and nothing else is offered', async () => {
    mockUseAgent.mockReturnValue(fakeAgent([]))
    setVta({ status: 'connecting', approvals: [] })
    const tree = render(
      <BasicAppContext>
        <MyAgent config={config} />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    expect(tree.getByTestId(testIdWithKey('MyAgentConnecting'))).toHaveTextContent('MyAgent.StepSigningIn')
    expect(tree.queryByTestId(testIdWithKey('ConnectMyAgentButton'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('MyAgentVettingRow'))).toBeNull()
  })
})
