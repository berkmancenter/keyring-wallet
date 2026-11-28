/**
 * `ConnectedAgentsRoot` (backlog 2, fb-W1): nothing with the flag off or with no administered VTA; with both, the
 * services for that VTA, mounted, reconciled once; the HCP ports only with `isHcpEnabled()`.
 */
import type { Agent } from '@credo-ts/core'
import { act, render } from '@testing-library/react-native'
import React from 'react'
import { Text } from 'react-native'

import { memoryGenericRecords } from '../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import { setAgentConnectEnabled } from '../agentConnectFlag'
import { useConnectedAgentsServices, type ConnectedAgentsServices } from '../ConnectedAgentsProvider'
import { administeredVtaDid, ConnectedAgentsRoot } from '../ConnectedAgentsRoot'
import { setHcpEnabled } from '../hcp/hcpFlag'
import { hcpPorts, useHcpPorts } from '../hcp/hooks'
import { connectedAgentsServices } from '../services'

jest.mock('react-native-keychain', () => ({ ACCESS_CONTROL: {}, ACCESSIBLE: {}, STORAGE_TYPE: {} }))

const VTA = 'did:webvh:QmVta:vta.example.org'

const mockAgent = { current: undefined as Agent | undefined }
jest.mock('@bifold/react-hooks', () => ({ useAgent: () => ({ agent: mockAgent.current }) }))

type Link = { kind: 'linked'; vtaDid: string } | { kind: 'notLinked' } | { kind: 'revoked'; vtaDid: string }
const mockVta = {
  link: { kind: 'notLinked' } as Link,
  listeners: new Set<() => void>(),
  getState() {
    return { link: this.link, managerDid: 'did:peer:2.admin' }
  },
  subscribe(listener: () => void) {
    mockVta.listeners.add(listener)
    return () => {
      mockVta.listeners.delete(listener)
    }
  },
  setLink(link: Link) {
    mockVta.link = link
    mockVta.listeners.forEach((l) => l())
  },
  withAgentSession: async () => {
    throw new Error('no VTA in this test')
  },
}
jest.mock('../../trust-tasks/module/vtaAgent', () => ({
  vtaAgent: {
    getState: () => mockVta.getState(),
    subscribe: (l: () => void) => mockVta.subscribe(l),
    withAgentSession: () => mockVta.withAgentSession(),
  },
}))
jest.mock('../../trust-tasks/module/VtiIdentityStore', () => ({
  GenericRecordsIdentityStore: jest.fn().mockImplementation(() => ({ listPersonas: async () => [] })),
}))

const mockReconciled: number[] = []
jest.mock('../services', () => {
  const actual = jest.requireActual('../services')
  return {
    ...actual,
    connectedAgentsServices: jest.fn((...args: Parameters<typeof actual.connectedAgentsServices>) => {
      const services = actual.connectedAgentsServices(...args)
      return {
        ...services,
        reconcile: async () => {
          mockReconciled.push(1)
        },
      }
    }),
  }
})
jest.mock('../hcp/hooks', () => {
  const actual = jest.requireActual('../hcp/hooks')
  return { ...actual, hcpPorts: jest.fn(actual.hcpPorts) }
})

const built = connectedAgentsServices as jest.MockedFunction<typeof connectedAgentsServices>
const builtHcp = hcpPorts as jest.MockedFunction<typeof hcpPorts>

const agent = () =>
  ({
    genericRecords: memoryGenericRecords(),
    kms: { randomBytes: ({ length }: { length: number }) => new Uint8Array(length).fill(7) },
  }) as unknown as Agent

let seen: { services?: ConnectedAgentsServices; hcp?: unknown; hcpError?: string } = {}
const Child: React.FC = () => {
  seen.services = useConnectedAgentsServices()
  return <Text>the agent screens</Text>
}
const HcpChild: React.FC = () => {
  seen.hcp = useHcpPorts()
  return null
}
class HcpBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  public state = { failed: false }
  public static getDerivedStateFromError() {
    return { failed: true }
  }
  public componentDidCatch(error: Error) {
    seen.hcpError = error.message
  }
  public render() {
    return this.state.failed ? null : this.props.children
  }
}

/** The root around the screens; `probeHcp` also mounts a child that reads the HCP ports. */
const root = (probeHcp = false) =>
  render(
    <ConnectedAgentsRoot>
      <Child />
      {probeHcp ? (
        <HcpBoundary>
          <HcpChild />
        </HcpBoundary>
      ) : null}
    </ConnectedAgentsRoot>
  )

beforeEach(() => {
  seen = {}
  mockReconciled.length = 0
  built.mockClear()
  builtHcp.mockClear()
  mockAgent.current = agent()
  mockVta.link = { kind: 'linked', vtaDid: VTA }
})
afterEach(() => {
  setHcpEnabled(false)
  setAgentConnectEnabled(false)
})

describe('administeredVtaDid', () => {
  it("is the linked agent's DID only while the link is linked", () => {
    expect(administeredVtaDid({ link: { kind: 'linked', vtaDid: VTA } as never })).toBe(VTA)
    expect(administeredVtaDid({ link: { kind: 'revoked', vtaDid: VTA } as never })).toBeUndefined()
    expect(administeredVtaDid({ link: { kind: 'notLinked' } })).toBeUndefined()
  })
})

describe('ConnectedAgentsRoot', () => {
  it('control: with the flag off it renders nothing and builds nothing', () => {
    const { queryByText, toJSON } = root()
    expect(queryByText('the agent screens')).toBeNull()
    expect(toJSON()).toBeNull()
    expect(built).not.toHaveBeenCalled()
    expect(builtHcp).not.toHaveBeenCalled()
  })

  it('with the flag on, renders its children inside the services for the administered VTA, reconciled once', async () => {
    setAgentConnectEnabled(true)
    const { getByText } = root()
    expect(getByText('the agent screens')).toBeTruthy()
    expect(built).toHaveBeenCalledTimes(1)
    const [givenAgent, givenVta, session, personas] = built.mock.calls[0]
    expect(givenAgent).toBe(mockAgent.current)
    expect(givenVta).toBe(VTA)
    expect(typeof session.withAgentSession).toBe('function')
    expect(await personas()).toEqual([])
    expect(seen.services).toBe(built.mock.results[0].value)
    await act(async () => undefined)
    expect(mockReconciled).toEqual([1])
  })

  it('with no administered VTA it renders nothing, never an error; a link made later mounts the services', async () => {
    setAgentConnectEnabled(true)
    mockVta.link = { kind: 'notLinked' }
    const { queryByText, toJSON } = root()
    expect(toJSON()).toBeNull()
    expect(built).not.toHaveBeenCalled()
    act(() => mockVta.setLink({ kind: 'linked', vtaDid: VTA }))
    expect(queryByText('the agent screens')).toBeTruthy()
    expect(built.mock.calls[0][1]).toBe(VTA)
  })

  it('with a revoked link, or no Credo agent, it renders nothing', () => {
    setAgentConnectEnabled(true)
    mockVta.link = { kind: 'revoked', vtaDid: VTA }
    expect(root().toJSON()).toBeNull()
    mockVta.link = { kind: 'linked', vtaDid: VTA }
    mockAgent.current = undefined
    expect(root().toJSON()).toBeNull()
    expect(built).not.toHaveBeenCalled()
  })

  it('control: with the flag on and HCP off, no HCP port is built, the services get none, and no HCP hook works', () => {
    setAgentConnectEnabled(true)
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    root(true)
    quiet.mockRestore()
    expect(builtHcp).not.toHaveBeenCalled()
    expect(built.mock.calls[0][5]).toBeUndefined()
    expect(seen.hcp).toBeUndefined()
    expect(seen.hcpError).toMatch(/HcpPortsProvider/)
  })

  it('with HCP on, the HCP ports for that VTA are built once, given to the services and mounted', () => {
    setAgentConnectEnabled(true)
    setHcpEnabled(true)
    root(true)
    expect(builtHcp).toHaveBeenCalledTimes(1)
    expect(builtHcp.mock.calls[0][1]).toBe(VTA)
    const ports = builtHcp.mock.results[0].value
    expect(built.mock.calls[0][5]).toBe(ports)
    expect(seen.hcp).toBe(ports)
  })
})
