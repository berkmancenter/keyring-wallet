/**
 * Backlog 2 R1: the agent-connect routes, their containers, and the Contacts row (agent-connect plan §3.14, §3.15,
 * §6, §7.7, §7.10). The hooks are mocked (`ConnectedAgentsProvider`), so what is under test is what each container
 * draws from them and what it calls; the views' own words are their suites'.
 *
 * - With the developer switch off, My Agent registers none of the agent screens and Contacts shows no agent row.
 * - With it on, each container draws its view; AgentDetails' Revoke calls `revokeAgentConnection(deps, id)` and shows
 *   each outcome; ConnectAgent draws each pairing phase's view.
 */
import { useNavigation } from '@react-navigation/native'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { setAgentConnectEnabled } from '../../../modules/connected-agents/agentConnectFlag'
import { revokeAgentConnection } from '../../../modules/connected-agents/revoke'
import ListContacts from '../../../modules/vrc/screens/ListContacts'
import MyAgentStack from '../../../navigators/MyAgentStack'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import AgentDetailsScreen from '../AgentDetailsScreen'
import AgentMemoriesScreen from '../AgentMemoriesScreen'
import AiAgentsScreen from '../AiAgentsScreen'
import ConnectAgentScreen from '../ConnectAgentScreen'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('react-native-keychain', () => ({ ACCESS_CONTROL: {}, ACCESSIBLE: {}, STORAGE_TYPE: {} }))

// The hooks, as fakes each test sets (`mock` names, so the factory below may read them).
const mockHooks: Record<string, jest.Mock> = {}
jest.mock('../../../modules/connected-agents/ConnectedAgentsProvider', () => {
  const names = [
    'useAgentConnections',
    'useAgentConnection',
    'useAgentActions',
    'useAgentContacts',
    'useAgentPairing',
    'useConnectGuard',
    'useMemories',
    'useMemoryCounts',
    'usePersonas',
    'useKeepConnectedOffered',
    'useRevokeDeps',
    'useDeleteMemory',
  ]
  return Object.fromEntries(names.map((n) => [n, (...args: unknown[]) => mockHooks[n](...args)]))
})
jest.mock('../../../modules/connected-agents/revoke', () => ({
  ...jest.requireActual('../../../modules/connected-agents/revoke'),
  revokeAgentConnection: jest.fn(),
}))
jest.mock('../../../contexts/biometric-confirmation', () => ({
  requestBiometricConfirmationUI: jest.fn(async () => ({ status: 'confirmed', timestamp: '' })),
}))
jest.mock('../../../components/misc/ScanCamera', () => ({ __esModule: true, default: () => null }))
jest.mock('react-native-permissions', () => ({
  PERMISSIONS: { IOS: { CAMERA: 'camera' }, ANDROID: { CAMERA: 'camera' } },
  RESULTS: { GRANTED: 'granted' },
  request: jest.fn(async () => 'denied'),
}))

// The stack, as far as registration goes: the screens a Navigator was given, fragments opened.
const mockStack: { screens: { name: string; component?: unknown; options?: unknown }[] } = { screens: [] }
jest.mock('@react-navigation/stack', () => {
  const R = jest.requireActual('react')
  const collect = (children: unknown, out: { name: string }[]) =>
    R.Children.forEach(children, (child: { type?: unknown; props?: { name?: string; children?: unknown } }) => {
      if (!child) return
      if (child.type === R.Fragment) collect(child.props?.children, out)
      else if (child.props?.name) out.push(child.props as { name: string })
    })
  return {
    createStackNavigator: () => ({
      Navigator: ({ children }: { children: unknown }) => {
        const out: { name: string }[] = []
        collect(children, out)
        mockStack.screens = out
        return null
      },
      Screen: () => null,
    }),
  }
})
// Contacts' own sources, as fakes: two people, and the VTA the phone administers.
const mockCredentials: { records: unknown[] } = { records: [] }
const mockVta: { did?: string } = {}
jest.mock('../../../modules/openid/context/OpenIDCredentialRecordProvider', () => ({
  OpenIDCredentialRecordProvider: ({ children }: { children: React.ReactNode }) => children,
  useOpenIDCredentials: () => ({ openIdState: { w3cCredentialRecords: mockCredentials.records, isLoading: false } }),
}))
jest.mock('../../../modules/vrc/credentialTypes', () => ({ isPeerVrcCredential: () => true }))
jest.mock('../../../modules/vrc/utils/witnessCredentialUtils', () => ({
  getVerifiedWitnessCredentialsForSubject: () => [],
  extractWitnessInfo: () => undefined,
  hasVrcHardwareAttestation: () => false,
}))
jest.mock('../../../modules/vrc/utils/rcardDisplayUtils', () => ({ resolveContactDisplayInfo: () => ({}) }))
jest.mock('../../../modules/vrc/contacts/useContactLinks', () => ({ useContactLinks: () => new Map() }))
jest.mock('../../../modules/vrc/contacts/useContactFacts', () => ({
  useContactFacts: () => ({ hwVerified: { known: true, value: false } }),
}))
jest.mock('../../../contexts/tour/tour-context', () => ({ useTour: () => ({ start: jest.fn(), stop: jest.fn() }) }))
jest.mock('../../../modules/connected-agents/ConnectedAgentsRoot', () => ({
  ConnectedAgentsRoot: ({ children }: { children: React.ReactNode }) => children,
  administeredVtaDid: () => mockVta.did,
}))

const id = (key: string) => testIdWithKey(key)
const show = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)

const NOW = Date.parse('2026-11-28T10:00:00Z')
const agentView = (over: Record<string, unknown> = {}) => ({
  id: 'did:key:agent-1',
  name: 'Notes helper',
  handle: 'notes-helper',
  status: 'connectedUntil',
  expiresAt: NOW + 3_600_000,
  grantType: 'temporary',
  purposes: ['personalisation'],
  keyChanged: false,
  pending: [],
  memories: [{ id: 'keyring-memory-a', name: 'Work' }],
  ownerName: 'Brook',
  ...over,
})

const actions = () => ({
  widen: jest.fn(async () => ({ ok: true })),
  narrow: jest.fn(async () => ({ ok: true })),
  restore: jest.fn(async () => ({ ok: true })),
  retryPending: jest.fn(async () => ({ ok: true })),
  extend: jest.fn(async () => ({ ok: true })),
  remove: jest.fn(async () => ({ ok: true })),
  keepConnected: jest.fn(async () => ({ ok: true })),
})

const DEPS = { store: { marker: 'store' }, vta: { marker: 'vta' } }

const navigation = () => ({
  navigate: jest.fn(),
  replace: jest.fn(),
  goBack: jest.fn(),
  addListener: jest.fn(() => () => undefined),
})
type Nav = ReturnType<typeof navigation>
// A screen's navigation and route, as far as the containers use them.
const screenProps = (nav: Nav, params?: object) =>
  ({ navigation: nav, route: { key: 'r', name: 'r', params } }) as unknown as { navigation: never; route: never }

let agentActions: ReturnType<typeof actions>

beforeEach(() => {
  agentActions = actions()
  const agents = [agentView()]
  mockHooks.useAgentConnections = jest.fn(() => ({ agents, loading: false, refresh: jest.fn(async () => undefined) }))
  mockHooks.useAgentConnection = jest.fn((agentId: string) => ({
    agent: agents.find((a) => a.id === agentId),
    loading: false,
    refresh: jest.fn(async () => undefined),
  }))
  mockHooks.useAgentActions = jest.fn(() => agentActions)
  mockHooks.useAgentContacts = jest.fn(() => [])
  mockHooks.useConnectGuard = jest.fn(() => 'ok')
  mockHooks.useMemories = jest.fn(() => ({
    memories: [{ id: 'keyring-memory-a', name: 'Work', containsOthers: false }],
    loading: false,
    create: jest.fn(async () => ({ ok: false, code: 'failed' })),
  }))
  mockHooks.useMemoryCounts = jest.fn(() => [])
  mockHooks.usePersonas = jest.fn(() => [{ did: 'did:web:brook', name: 'Brook' }])
  mockHooks.useKeepConnectedOffered = jest.fn(() => false)
  mockHooks.useRevokeDeps = jest.fn(() => DEPS)
  mockHooks.useDeleteMemory = jest.fn(() => ({
    preview: jest.fn(async () => ({
      ok: true,
      count: { ok: true, count: 3, complete: true },
      overWarning: false,
      agents: [],
    })),
    remove: jest.fn(async () => ({ ok: true, recordsNotUpdated: 0 })),
  }))
  ;(revokeAgentConnection as jest.Mock).mockReset()
})

describe('AiAgentsScreen', () => {
  it('draws the list from useAgentConnections, and Open and Connect go where they say', () => {
    const nav = navigation()
    const view = show(<AiAgentsScreen {...screenProps(nav)} />)
    expect(view.getByTestId(id('AgentList'))).toBeTruthy()
    expect(view.getByText('Notes helper')).toBeTruthy()
    fireEvent.press(view.getByTestId(id('AgentRowOpen')))
    expect(nav.navigate).toHaveBeenCalledWith(Screens.AgentDetails, {
      agentId: 'did:key:agent-1',
      name: 'Notes helper',
    })
    fireEvent.press(view.getByTestId(id('AgentListConnect')))
    expect(nav.navigate).toHaveBeenCalledWith(Screens.ConnectAgent)
  })

  it('shows the loading state while the first listing is read', () => {
    mockHooks.useAgentConnections = jest.fn(() => ({ agents: [], loading: true, refresh: jest.fn() }))
    const view = show(<AiAgentsScreen {...screenProps(navigation())} />)
    expect(view.getByTestId(id('AgentListLoading'))).toBeTruthy()
  })

  it("Revoke on a row opens the details' Revoke sheet, whose Revoke is the routed call", async () => {
    ;(revokeAgentConnection as jest.Mock).mockResolvedValue({ kind: 'revoked' })
    const view = show(<AiAgentsScreen {...screenProps(navigation())} />)
    fireEvent.press(view.getByTestId(id('AgentRowRevoke')))
    fireEvent.press(view.getByTestId(id('RevokeAgentConfirm')))
    await waitFor(() => expect(revokeAgentConnection).toHaveBeenCalledWith(DEPS, 'did:key:agent-1'))
    await waitFor(() => expect(view.queryByTestId(id('RevokeAgentSheet'))).toBeNull())
  })

  it('Connect again opens Connect an agent from the expired agent', () => {
    mockHooks.useAgentConnections = jest.fn(() => ({
      agents: [agentView({ status: 'expired', expiresAt: NOW - 1 })],
      loading: false,
      refresh: jest.fn(),
    }))
    const nav = navigation()
    const view = show(<AiAgentsScreen {...screenProps(nav)} />)
    fireEvent.press(view.getByTestId(id('AgentRowConnectAgain')))
    expect(nav.navigate).toHaveBeenCalledWith(Screens.ConnectAgent, { againFrom: 'did:key:agent-1' })
    fireEvent.press(view.getByTestId(id('AgentRowRemove')))
    expect(agentActions.remove).toHaveBeenCalledWith('did:key:agent-1')
  })
})

describe('AgentDetailsScreen', () => {
  const details = (nav = navigation()) =>
    show(<AgentDetailsScreen {...screenProps(nav, { agentId: 'did:key:agent-1', name: 'Notes helper' })} />)

  it('draws the details from the hooks, with the counts and the owner', () => {
    mockHooks.useMemoryCounts = jest.fn(() => [
      { contextId: 'keyring-memory-a', failed: false, count: 12, complete: true, overWarning: false },
    ])
    const view = details()
    expect(view.getByTestId(id('AgentDetails'))).toBeTruthy()
    expect(mockHooks.useMemoryCounts).toHaveBeenCalledWith('did:key:agent-1', ['keyring-memory-a'])
    expect(view.getByTestId(id('AgentDetailsMemoryCount'))).toBeTruthy()
    // Keep it connected is offered only through useKeepConnectedOffered, which says no here.
    expect(view.queryByTestId(id('AgentDetailsKeepConnected'))).toBeNull()
  })

  it('Keep it connected shows only when useKeepConnectedOffered says so, and acts through the actions', async () => {
    mockHooks.useKeepConnectedOffered = jest.fn(() => true)
    const view = details()
    expect(mockHooks.useKeepConnectedOffered).toHaveBeenCalledWith('did:key:agent-1')
    fireEvent.press(view.getByTestId(id('AgentDetailsKeepConnected')))
    await waitFor(() => expect(agentActions.keepConnected).toHaveBeenCalledWith('did:key:agent-1'))
  })

  it('a Keep it connected that did not fully happen draws its line in place of the control (#1122 obligation 1)', async () => {
    mockHooks.useKeepConnectedOffered = jest.fn(() => true)
    agentActions.keepConnected = jest.fn(async () => ({ ok: false as const, code: 'notRecorded' as const }))
    const view = details()
    fireEvent.press(view.getByTestId(id('AgentDetailsKeepConnected')))
    await waitFor(() => expect(view.getByTestId(id('AgentDetailsKeepConnectedLine'))).toBeTruthy())
    expect(view.queryByTestId(id('AgentDetailsKeepConnected'))).toBeNull()
  })

  it('CONTROL: a Keep it connected that succeeded draws no line', async () => {
    mockHooks.useKeepConnectedOffered = jest.fn(() => true)
    agentActions.keepConnected = jest.fn(async () => ({ ok: true as const }))
    const view = details()
    fireEvent.press(view.getByTestId(id('AgentDetailsKeepConnected')))
    await waitFor(() => expect(agentActions.keepConnected).toHaveBeenCalled())
    expect(view.queryByTestId(id('AgentDetailsKeepConnectedLine'))).toBeNull()
  })

  it('Revoke calls revokeAgentConnection with the deps and the id, and closes on revoked', async () => {
    ;(revokeAgentConnection as jest.Mock).mockResolvedValue({ kind: 'revoked' })
    const view = details()
    fireEvent.press(view.getByTestId(id('AgentDetailsRevoke')))
    expect(view.getByTestId(id('RevokeAgentSheet'))).toBeTruthy()
    // The details stay mounted under the sheet.
    expect(view.getByTestId(id('AgentDetails'))).toBeTruthy()
    fireEvent.press(view.getByTestId(id('RevokeAgentConfirm')))
    await waitFor(() => expect(revokeAgentConnection).toHaveBeenCalledWith(DEPS, 'did:key:agent-1'))
    await waitFor(() => expect(view.queryByTestId(id('RevokeAgentSheet'))).toBeNull())
  })

  it.each([
    [{ kind: 'notConfirmed', reason: 'entryRemains' }, 'ConnectedAgents.RevokeNotConfirmedBody'],
    [{ kind: 'unreachable' }, 'ConnectedAgents.RevokeUnreachable'],
  ])('a revoke that came to %j keeps the sheet and says so, with Try again', async (outcome, key) => {
    ;(revokeAgentConnection as jest.Mock).mockResolvedValue(outcome)
    const view = details()
    fireEvent.press(view.getByTestId(id('AgentDetailsRevoke')))
    fireEvent.press(view.getByTestId(id('RevokeAgentConfirm')))
    await waitFor(() => expect(view.getByTestId(id('RevokeOutcomeNotice'))).toBeTruthy())
    expect(view.getByTestId(id('RevokeOutcomeNotice'))).toHaveTextContent(new RegExp(key.replace('.', '\\.')))
    expect(view.getByTestId(id('RevokeTryAgain'))).toBeTruthy()
    expect(view.getByTestId(id('RevokeAgentSheet'))).toBeTruthy()
  })

  it('Extend asks through Approve and the biometric before actions.extend', async () => {
    const view = details()
    fireEvent.press(view.getByTestId(id('AgentDetailsExtend')))
    expect(view.getByTestId(id('ConnectApprove'))).toBeTruthy()
    expect(agentActions.extend).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.press(view.getByTestId(id('ConnectApproveButton')))
    })
    await waitFor(() => expect(agentActions.extend).toHaveBeenCalledWith('did:key:agent-1'))
  })

  it('Change memories opens the picker inline', () => {
    const view = details()
    fireEvent.press(view.getByTestId(id('AgentDetailsChangeMemories')))
    expect(view.getByTestId(id('ChangeMemories'))).toBeTruthy()
    expect(view.getByTestId(id('AgentDetails'))).toBeTruthy()
  })
})

describe('ConnectAgentScreen draws each pairing phase', () => {
  const pending = {
    choice: {
      name: 'Notes helper',
      ownerPersonaDid: 'did:web:brook',
      memoryContexts: ['keyring-memory-a'],
      purposes: ['personalisation'],
    },
    link: { kind: 'fallback', agentDid: 'did:key:t', requestId: 'req-1', exp: 0 },
    vtaDid: 'did:web:vta',
    requestId: 'req-1',
    deadline: NOW + 60_000,
  }
  const pairingIn = (state: object) => {
    const pairing = {
      state,
      start: jest.fn(async () => state),
      scan: jest.fn(async () => state),
      enterNumber: jest.fn(async () => ({ sent: true })),
      approve: jest.fn(async () => state),
      cancel: jest.fn(async () => state),
    }
    mockHooks.useAgentPairing = jest.fn(() => pairing)
    return pairing
  }
  const connect = (nav = navigation()) => show(<ConnectAgentScreen {...screenProps(nav)} />)

  it.each([
    [{ phase: 'idle' }, 'ConnectAgentForm'],
    [{ phase: 'awaitingScan', choice: pending.choice }, 'ConnectScan'],
    [{ phase: 'awaitingNumber', ...pending }, 'ConnectNumber'],
    [{ phase: 'awaitingApproval', ...pending, disclosure: { requester: 'laptop' } }, 'ConnectApprove'],
    [
      {
        phase: 'awaitingEnrolment',
        choice: pending.choice,
        vtaDid: 'did:web:vta',
        grantedContexts: [],
        grantedAt: NOW,
      },
      'ConnectConnecting',
    ],
    [{ phase: 'failed', reason: 'foreign-vta' }, 'ConnectFailure'],
    [{ phase: 'expired' }, 'ConnectFailure'],
    [{ phase: 'locked', lockout: { locked: true, until: NOW + 60_000, minutesLeft: 1 } }, 'ConnectFailure'],
  ])('%j draws %s', (state, testId) => {
    pairingIn(state)
    const view = connect()
    expect(view.getByTestId(id(testId))).toBeTruthy()
  })

  it('the form waits at "checking" until a persona is known, so a choice never goes without one', () => {
    pairingIn({ phase: 'idle' })
    mockHooks.usePersonas = jest.fn(() => [])
    const view = connect()
    expect(view.getByTestId(id('ConnectAgentChecking'))).toBeTruthy()
    expect(view.queryByTestId(id('ConnectAgentContinue'))).toBeNull()
  })

  it('confirmed draws Connected, and See details opens the new agent', () => {
    pairingIn({
      phase: 'confirmed',
      agent: { name: 'Notes helper', agentDid: 'did:key:agent-1', expiresAt: new Date(NOW + 3_600_000).toISOString() },
    })
    const nav = navigation()
    const view = connect(nav)
    expect(view.getByTestId(id('ConnectConnected'))).toBeTruthy()
    fireEvent.press(view.getByTestId(id('ConnectSeeDetails')))
    expect(nav.replace).toHaveBeenCalledWith(Screens.AgentDetails, { agentId: 'did:key:agent-1', name: 'Notes helper' })
  })

  it("Connected's Keep it connected that did not fully happen draws its line, where it used to be swallowed", async () => {
    pairingIn({
      phase: 'confirmed',
      agent: { name: 'Notes helper', agentDid: 'did:key:agent-1', expiresAt: new Date(NOW + 3_600_000).toISOString() },
    })
    mockHooks.useKeepConnectedOffered = jest.fn(() => true)
    agentActions.keepConnected = jest.fn(async () => ({ ok: false as const, code: 'unreachable' as const }))
    const view = connect(navigation())
    fireEvent.press(view.getByTestId(id('ConnectKeepConnected')))
    await waitFor(() => expect(view.getByTestId(id('ConnectKeepConnectedLine'))).toBeTruthy())
  })

  it.each([[{ phase: 'cancelled' }], [{ phase: 'notFinished' }]])('%j goes back to AI agents', (state) => {
    pairingIn(state)
    const nav = navigation()
    connect(nav)
    expect(nav.navigate).toHaveBeenCalledWith(Screens.AiAgents)
  })

  it('a scanned code that is not a pairing code ends with its own words, and nothing is scanned', () => {
    const pairing = pairingIn({ phase: 'awaitingScan', choice: pending.choice })
    const view = connect()
    fireEvent.press(view.getByTestId(id('ConnectScanPaste')))
    fireEvent.changeText(view.getByTestId(id('ConnectScanLink')), 'https://example.com/not-a-code')
    fireEvent.press(view.getByTestId(id('ConnectScanLinkContinue')))
    expect(view.getByTestId(id('ConnectFailure'))).toHaveTextContent(/ConnectedAgents\.FailNotAPairingCode/)
    expect(pairing.scan).not.toHaveBeenCalled()
  })

  it("Approve runs only after the biometric passed, and the form's choice carries the persona", async () => {
    const pairing = pairingIn({ phase: 'awaitingApproval', ...pending })
    const view = connect()
    await act(async () => {
      fireEvent.press(view.getByTestId(id('ConnectApproveButton')))
    })
    await waitFor(() => expect(pairing.approve).toHaveBeenCalled())
  })
})

describe('AgentMemoriesScreen', () => {
  it('draws the memories, and Delete previews, opens the sheet, and removes only from its Delete', async () => {
    const del = {
      preview: jest.fn(async () => ({
        ok: true,
        count: { ok: true, count: 3, complete: true },
        overWarning: false,
        agents: [],
      })),
      remove: jest.fn(async () => ({ ok: true, recordsNotUpdated: 0 })),
    }
    mockHooks.useDeleteMemory = jest.fn(() => del)
    const view = show(<AgentMemoriesScreen {...screenProps(navigation())} />)
    expect(view.getByTestId(id('MemoriesList'))).toBeTruthy()
    // The list's counts are kept under its own key, never an agent's.
    expect(mockHooks.useMemoryCounts).toHaveBeenCalledWith('memories-list', ['keyring-memory-a'])
    fireEvent.press(view.getByTestId(id('MemoriesListDelete')))
    await waitFor(() => expect(view.getByTestId(id('DeleteMemoryConfirm'))).toBeTruthy())
    expect(del.preview).toHaveBeenCalledWith('keyring-memory-a')
    expect(del.remove).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.press(view.getByTestId(id('DeleteMemoryConfirm')))
    })
    await waitFor(() => expect(del.remove).toHaveBeenCalledWith('keyring-memory-a', true))
  })
})

describe('control: the containers are what calls the hooks', () => {
  it('a details screen for an agent the hooks do not have draws nothing and calls no revoke', () => {
    const view = show(
      <AgentDetailsScreen {...screenProps(navigation(), { agentId: 'did:key:unknown', name: 'Gone' })} />
    )
    expect(view.queryByTestId(id('AgentDetails'))).toBeNull()
    expect(revokeAgentConnection).not.toHaveBeenCalled()
    // and the same screen for a known agent does draw, so the null above is the lookup, not the render
    const known = show(
      <AgentDetailsScreen {...screenProps(navigation(), { agentId: 'did:key:agent-1', name: 'Notes helper' })} />
    )
    expect(known.getByTestId(id('AgentDetails'))).toBeTruthy()
  })
})

describe('MyAgentStack registers the agent screens only with the switch on', () => {
  const AGENT_SCREENS = [Screens.AiAgents, Screens.AgentDetails, Screens.ConnectAgent, Screens.AgentMemories]
  const stack = () => {
    mockStack.screens = []
    show(<MyAgentStack />)
    return mockStack.screens
  }
  afterEach(() => setAgentConnectEnabled(false))

  it('control: with the switch off, none of them is registered, and the stack is as it was', () => {
    setAgentConnectEnabled(false)
    const names = stack().map((s) => s.name)
    expect(names).toContain(Screens.MyAgent)
    for (const name of [...AGENT_SCREENS, Screens.HcpConnect]) expect(names).not.toContain(name)
  })

  it('with it on, the four are registered first (R2: the tab opens on them), each inside the root', () => {
    setAgentConnectEnabled(true)
    const screens = stack()
    const names = screens.map((s) => s.name)
    expect(names.slice(0, 4)).toEqual(AGENT_SCREENS)
    // HcpConnect's view (#1109) is not on this base, so it is not registered: see the PR.
    expect(names).not.toContain(Screens.HcpConnect)
    const details = screens.find((s) => s.name === Screens.AgentDetails)
    const options = details?.options as (a: { route: { params: { name: string } } }) => { title: string }
    expect(options({ route: { params: { name: 'Notes helper' } } }).title).toBe('Notes helper')
    const component = details?.component as React.FC
    expect(component.displayName).toBe('InConnectedAgentsRoot(AgentDetailsScreen)')
  })

  it('reads the switch once, when the stack mounts', () => {
    setAgentConnectEnabled(false)
    mockStack.screens = []
    const view = show(<MyAgentStack />)
    setAgentConnectEnabled(true)
    view.rerender(
      <BasicAppContext>
        <MyAgentStack />
      </BasicAppContext>
    )
    expect(mockStack.screens.map((s) => s.name)).not.toContain(Screens.AiAgents)
  })
})

describe('ListContacts with the agents', () => {
  const PEOPLE = [
    { id: 'did:peer:zara', name: 'Zara' },
    { id: 'did:peer:adam', name: 'Adam' },
  ]
  beforeEach(() => {
    mockCredentials.records = PEOPLE.map((p) => ({
      encoded: { type: ['DTGCredential'], issuer: { id: p.id, name: p.name } },
    }))
    mockVta.did = 'did:web:vta'
  })
  afterEach(() => setAgentConnectEnabled(false))
  const names = (view: ReturnType<typeof show>) =>
    view.getAllByTestId(/ContactCard$|AgentContactCard$/).map((n) => n.props.accessibilityLabel ?? n.props.testID)

  it('control: with the switch off there is no agent row, and the agents are never asked for', () => {
    setAgentConnectEnabled(false)
    mockHooks.useAgentContacts = jest.fn(() => [{ agentId: 'did:key:agent-1', name: 'Bea', handle: 'bea' }])
    const view = show(<ListContacts />)
    expect(view.queryByTestId(id('AgentContactCard'))).toBeNull()
    expect(mockHooks.useAgentContacts).not.toHaveBeenCalled()
    expect(view.getAllByTestId(id('ContactCard'))).toHaveLength(2)
  })

  it('with it on, the agents are among the people by name, and one opens its details in My Agent', () => {
    setAgentConnectEnabled(true)
    mockHooks.useAgentContacts = jest.fn(() => [{ agentId: 'did:key:agent-1', name: 'Bea', handle: 'bea' }])
    const view = show(<ListContacts />)
    const order = names(view)
    expect(order).toHaveLength(3)
    expect(order[1]).toMatch(/^Bea, /)
    const nav = useNavigation()
    ;(nav.navigate as jest.Mock).mockClear()
    fireEvent.press(view.getByTestId(id('AgentContactCard')))
    expect(nav.navigate).toHaveBeenCalledWith('Tab Stack', {
      screen: 'Tab My Agent Stack',
      params: { screen: Screens.AgentDetails, params: { agentId: 'did:key:agent-1', name: 'Bea' }, initial: false },
    })
  })

  it('with it on and no agent, the people rows are as with it off', () => {
    setAgentConnectEnabled(false)
    const off = show(<ListContacts />).toJSON()
    setAgentConnectEnabled(true)
    mockHooks.useAgentContacts = jest.fn(() => [])
    const on = show(<ListContacts />).toJSON()
    // As rendered (a handler is a new function each render, so the trees are compared as they serialise).
    expect(JSON.stringify(on)).toBe(JSON.stringify(off))
    expect(JSON.stringify(off)).toContain('Contact: Adam')
  })

  it('with it on and no administered VTA, the agents are not asked for', () => {
    setAgentConnectEnabled(true)
    mockVta.did = undefined
    mockHooks.useAgentContacts = jest.fn(() => [{ agentId: 'did:key:agent-1', name: 'Bea', handle: 'bea' }])
    const view = show(<ListContacts />)
    expect(view.queryByTestId(id('AgentContactCard'))).toBeNull()
    expect(mockHooks.useAgentContacts).not.toHaveBeenCalled()
  })
})

afterAll(() => setAgentConnectEnabled(false))
