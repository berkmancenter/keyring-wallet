/**
 * My Agent — the connected gate and the vetting seat. Before the agent is
 * connected the screen offers exactly one thing to do (connect, with the
 * manager identity to enrol); once it is, what the agent holds appears, led
 * by the vetting entry that names the seat this phone takes.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React, { useLayoutEffect, useSyncExternalStore } from 'react'
import { Linking } from 'react-native'

import { useAgent } from '@bifold/react-hooks'
import { useNavigation } from '@react-navigation/native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import enCopy from '../../../localization/en/en.json'
import frCopy from '../../../localization/fr/fr.json'
import ptBrCopy from '../../../localization/pt-br/pt-br.json'
import MyAgent, { GET_AGENT_LINKS } from '../screens/MyAgent'
import { emitCommunityChanged } from '../module/communityChanged'
import { DisclosureNotShown } from '../module/directoryDisclosure'
import { communityTarget } from '../module/vtiCommunityLink'
import { vtaAgent } from '../module/vtaAgent'
import { VtiRefusal, vtiAgent } from '../module/vtiAgent'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
const mockJoin = jest.fn()
jest.mock('../module/vtiJoin', () => ({
  ...jest.requireActual('../module/vtiJoin'),
  joinCommunity: (...args: unknown[]) => mockJoin(...args),
}))
// The VTA session itself is out of scope here: a client that reports itself
// connected, so the controller's `connect` is a no-op and the screen reads
// the state the test sets.
jest.mock('../module/VtaClient', () => ({
  VTA_TASK: { consentRequest: 'consent-request', consentGranted: 'consent-granted' },
  resolveVtaMediator: async () => Promise.reject(new Error('offline')),
  refusedAsNotOnAcl: jest.requireActual('../module/VtaClient').refusedAsNotOnAcl,
  TspReplyBreaker: jest.requireActual('../module/VtaClient').TspReplyBreaker,
  consentPendingOf: jest.requireActual('../module/VtaClient').consentPendingOf,
  VtaClient: class {
    isConnected = true
    managerDid = 'did:key:z6MkManager'
    async connect() {}
    async disconnect() {}
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

// The two-phone gate trial (09-29): the second phone finished linking and was
// left on this older panel, not the agent home. Every flow that starts here
// (link by QR, link without QR, two phones, relink, create my agent) ends by
// going back to it, and the stack only chooses its first screen once. Once
// the phone is linked, the panel hands over to the agent home.
describe('My Agent — the older panel hands over once linked', () => {
  const linkedLink = {
    kind: 'linked',
    vtaDid: config.vtaDid,
    label: 'bob',
    linkedAt: '2026-09-29T21:36:00Z',
    connection: { kind: 'online' },
  }
  beforeEach(() => (useNavigation() as unknown as { replace: jest.Mock }).replace.mockClear())

  test('a linked phone is taken to the agent home', async () => {
    setVta({ status: 'connected', approvals: [], link: linkedLink })
    mockUseAgent.mockReturnValue(fakeAgent([]))
    render(
      <BasicAppContext>
        <MyAgent config={config} />
      </BasicAppContext>
    )
    await act(async () => undefined)
    expect((useNavigation() as unknown as { replace: jest.Mock }).replace).toHaveBeenCalledWith(Screens.VtaAgent)
    setVta({ link: { kind: 'notLinked' } })
  })

  test('a phone that is not linked stays here, where the ways to link are', async () => {
    setVta({ status: 'disconnected', approvals: [], link: { kind: 'notLinked' } })
    mockUseAgent.mockReturnValue(fakeAgent([]))
    render(
      <BasicAppContext>
        <MyAgent config={config} />
      </BasicAppContext>
    )
    await act(async () => undefined)
    expect((useNavigation() as unknown as { replace: jest.Mock }).replace).not.toHaveBeenCalled()
  })
})

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
    expect(tree.getByTestId(testIdWithKey('LinkByAddressButton'))).toBeTruthy()
    // With no agent there is nothing to connect to, so no button that could only fail.
    expect(tree.queryByTestId(testIdWithKey('ConnectMyAgentButton'))).toBeNull()
  })

  /**
   * 269 gate, agents R4: after the last agent was unlinked, a community's
   * session was still up, and with no agent to name the panel took it for the
   * agent: "Connected", the host, the communities, and no way to link.
   */
  test('no agent linked, a community\'s session up: the way to link, never "Connected"', async () => {
    mockUseAgent.mockReturnValue(fakeAgent([]))
    setVta({ status: 'disconnected', link: { kind: 'notLinked' } })
    setVti({ status: 'connected', did: 'did:webvh:QmPersona:vtc.example:p', host: 'mediator.example' })
    const tree = render(
      <BasicAppContext>
        <MyAgent config={{}} />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    expect(tree.queryByTestId(testIdWithKey('MyAgentCard'))).toBeNull()
    expect(tree.getByTestId(testIdWithKey('LinkYourAgentButton'))).toBeTruthy()
  })

  /**
   * Alberto, 239: three buttons for two flows ("Set up a new agent", "Add this
   * phone to my agent", "Link without a QR code") read as a puzzle. One
   * sentence, the scanner, the way without a code, and where adding this
   * phone is done.
   */
  test('one way in, the way without a code, and where to add this phone', async () => {
    const navigate = useNavigation().navigate as jest.Mock
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
    expect(tree.getByTestId(testIdWithKey('LinkYourAgentButton'))).toHaveTextContent('VtaLink.ScanAgentCode')
    expect(tree.getByTestId(testIdWithKey('LinkOtherPhoneHint'))).toHaveTextContent('VtaLink.OtherPhoneHint')
    for (const gone of [
      'AgentCreate',
      'AgentCreateHint',
      'LinkYourAgentHint',
      'LinkWithoutQrButton',
      'LinkYourAgentHelp',
    ]) {
      expect(tree.queryByTestId(testIdWithKey(gone))).toBeNull()
    }
    navigate.mockClear()
    fireEvent.press(tree.getByTestId(testIdWithKey('LinkByAddressButton')))
    expect(navigate).toHaveBeenCalledWith(Screens.VtaCreateAgent, { byAddress: true })
  })

  // IN-135: a link picked back up shows its code again; carrying on comes first.
  test('a code showing again: Continue linking opens it', async () => {
    const navigate = useNavigation().navigate as jest.Mock
    mockUseAgent.mockReturnValue(fakeAgent([]))
    setVta({
      link: {
        kind: 'showingKey',
        vtaDid: 'did:webvh:x',
        label: 'x',
        did: 'did:key:z6Mk',
        checking: false,
        resumed: true,
      },
    })
    const tree = render(
      <BasicAppContext>
        <MyAgent config={{}} />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    navigate.mockClear()
    fireEvent.press(tree.getByTestId(testIdWithKey('MyAgentContinueLink')))
    expect(navigate).toHaveBeenCalledWith(Screens.VtaLink)
    setVta({ link: { kind: 'notLinked' } })
  })

  // UI-smoothness plan, Phase 1c: the hand-over ran in a focus effect, after paint, so a phone that became linked
  // while this panel was open drew the old "Connected" panel for a frame before the agent home slid in. A probe after
  // the screen records each committed frame (a layout effect runs before any passive effect could correct it).
  test('a link that arrives while the panel is open: no frame draws the old connected panel, and it hands over', async () => {
    const agent = fakeAgent([])
    mockUseAgent.mockReturnValue(agent)
    setVta({ status: 'disconnected', approvals: [], link: { kind: 'notLinked' } })
    const replace = (useNavigation() as unknown as { replace: jest.Mock }).replace
    replace.mockClear()
    const frames: boolean[] = []
    const box: { tree?: ReturnType<typeof render> } = {}
    const Probe = () => {
      useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)
      useLayoutEffect(() => {
        if (box.tree) frames.push(Boolean(box.tree.queryByTestId(testIdWithKey('MyAgentCard'))))
      })
      return null
    }
    box.tree = render(
      <BasicAppContext>
        <MyAgent config={config} />
        <Probe />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    // The control: not linked, the panel offers the way in.
    expect(box.tree.getByTestId(testIdWithKey('LinkYourAgentButton'))).toBeTruthy()
    frames.length = 0
    vtaAgent.client(agent.agent as never, config.vtaDid)
    await act(async () => {
      setVta({
        status: 'connected',
        managerDid: 'did:key:z6MkManager',
        link: {
          kind: 'linked',
          vtaDid: config.vtaDid,
          label: 'bob',
          linkedAt: '2026-09-29T21:36:00Z',
          connection: { kind: 'online' },
        },
      })
    })
    expect(frames.length).toBeGreaterThan(0)
    expect(frames).not.toContain(true)
    expect(box.tree.getByTestId(testIdWithKey('MyAgentHandingOver'))).toBeTruthy()
    expect(replace).toHaveBeenCalledWith(Screens.VtaAgent)
    setVta({ status: 'disconnected', link: { kind: 'notLinked' } })
  })

  // IN-350, run 1022-1822: the heartbeat removed the link while this panel showed "Connected", and it kept showing
  // it — with the refused phone's DID and its membership — until a relaunch.
  describe('a phone removed while My Agent is open', () => {
    const id = (key: string) => testIdWithKey(key)
    const linked = {
      kind: 'linked',
      vtaDid: config.vtaDid,
      label: 'bob',
      linkedAt: '2026-09-29T21:36:00Z',
      connection: { kind: 'online' },
    }
    const showConnected = async () => {
      const agent = fakeAgent([])
      mockUseAgent.mockReturnValue(agent)
      // As connectedTo below: the client exists before the state, so mounting does not reset it.
      vtaAgent.client(agent.agent as never, config.vtaDid)
      setVta({ status: 'connected', managerDid: 'did:key:z6MkManager', approvals: [], link: linked })
      const tree = render(
        <BasicAppContext>
          <MyAgent config={config} />
        </BasicAppContext>
      )
      await act(async () => {
        jest.advanceTimersByTime(10)
      })
      // The positive control: a linked phone's panel is handing over to the agent home (Phase 1c: it never draws the
      // old "Connected" panel), and says nothing of a removal yet.
      expect(tree.getByTestId(id('MyAgentHandingOver'))).toBeTruthy()
      expect(tree.queryByTestId(id('MyAgentCard'))).toBeNull()
      expect(tree.queryByTestId(id('RemovedPhone'))).toBeNull()
      return tree
    }
    afterEach(() => setVta({ status: 'disconnected', link: { kind: 'notLinked' } }))

    test('the agent refuses its heartbeat: the same screen, still mounted, says it was removed', async () => {
      const tree = await showConnected()
      // The live path: the presence loop hands the agent's refusal to the controller.
      await act(async () => {
        vtaAgent.presenceFailed(new VtiRefusal('permissionDenied', `DID not in ACL: did:peer:2.phone`))
      })
      expect(tree.getByTestId(id('RemovedPhone'))).toBeTruthy()
      expect(tree.queryByTestId(id('MyAgentCard'))).toBeNull()
      expect(vtaAgent.getState().status).toBe('disconnected')
    })

    test('even with a session status left at "connected", a removed link wins', async () => {
      const tree = await showConnected()
      await act(async () => {
        setVta({
          status: 'connected',
          link: { ...linked, kind: 'revoked', reason: 'DID not in ACL', cause: 'notInAcl' },
        })
      })
      expect(tree.getByTestId(id('RemovedPhone'))).toBeTruthy()
      expect(tree.queryByTestId(id('MyAgentCard'))).toBeNull()
    })
  })

  // Alberto, 10-22: a person with no agent yet is told where one comes from —
  // generic first (a host, like email), a hosting service named only in this
  // help, as an example, with who runs it (the 09-25 provider-generic rule).
  describe("don't have an agent yet?", () => {
    const id = (key: string) => testIdWithKey(key)
    const showWith = async (link: Record<string, unknown>) => {
      mockUseAgent.mockReturnValue(fakeAgent([]))
      setVta({ link })
      const tree = render(
        <BasicAppContext>
          <MyAgent config={{}} />
        </BasicAppContext>
      )
      await act(async () => {
        jest.advanceTimersByTime(10)
      })
      return tree
    }
    afterEach(() => setVta({ link: { kind: 'notLinked' } }))

    test('no agent linked: a closed help, and opened, both ways with their links', async () => {
      const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
      const tree = await showWith({ kind: 'notLinked' })
      expect(tree.getByTestId(id('AgentGetAgentToggle'))).toHaveTextContent('MyAgent.GetAgentToggle')
      expect(tree.queryByTestId(id('AgentGetAgentHelp'))).toBeNull()
      fireEvent.press(tree.getByTestId(id('AgentGetAgentToggle')))
      expect(tree.getByTestId(id('AgentGetAgentHelp'))).toHaveTextContent(/MyAgent\.GetAgentBody/)
      // The hosting service says who runs it.
      expect(tree.getByTestId(id('AgentGetAgentHosted'))).toHaveTextContent(
        /MyAgent\.GetAgentHosted.*MyAgent\.GetAgentHostedNote/
      )
      expect(tree.getByTestId(id('AgentGetAgentSelfHost'))).toHaveTextContent('MyAgent.GetAgentSelfHost')
      fireEvent.press(tree.getByTestId(id('AgentGetAgentHosted')))
      fireEvent.press(tree.getByTestId(id('AgentGetAgentSelfHost')))
      expect(open.mock.calls.map(([url]) => url)).toEqual(['https://vta.farm/', 'https://openvtc.net/'])
      expect(GET_AGENT_LINKS).toEqual({ hosted: 'https://vta.farm/', selfHost: 'https://openvtc.net/' })
      open.mockRestore()
    })

    test('a link part-way (a code showing again): the way in is there, the help is not', async () => {
      const tree = await showWith({
        kind: 'showingKey',
        vtaDid: 'did:webvh:x',
        label: 'x',
        did: 'did:key:z6Mk',
        checking: false,
        resumed: true,
      })
      expect(tree.getByTestId(id('MyAgentContinueLink'))).toBeTruthy()
      expect(tree.queryByTestId(id('AgentGetAgentToggle'))).toBeNull()
    })

    test('a linked phone: handed to its agent home, and no help', async () => {
      const replace = (useNavigation() as unknown as { replace: jest.Mock }).replace
      replace.mockClear()
      const tree = await showWith({
        kind: 'linked',
        vtaDid: config.vtaDid,
        label: 'bob',
        linkedAt: '2026-09-29T21:36:00Z',
        connection: { kind: 'online' },
      })
      // The screen did read the link: it hands over to the agent home, as a linked phone does.
      expect(replace).toHaveBeenCalledWith(Screens.VtaAgent)
      expect(tree.queryByTestId(id('AgentGetAgentToggle'))).toBeNull()
    })

    test('the words, in every language; the main copy never names a hosting service', () => {
      for (const words of [enCopy, frCopy, ptBrCopy] as unknown as Record<string, Record<string, string>>[]) {
        for (const key of [
          'GetAgentToggle',
          'GetAgentBody',
          'GetAgentHosted',
          'GetAgentHostedNote',
          'GetAgentSelfHost',
        ])
          expect(words.MyAgent[key]).toEqual(expect.any(String))
        expect(words.MyAgent.GetAgentBody).not.toMatch(/farm|vta\.|openvtc/i)
        expect(words.MyAgent.GetAgentToggle).not.toMatch(/farm|vta\.|openvtc/i)
      }
    })
  })

  test('the words for the ways in, in every language, and the steps that name them', () => {
    for (const words of [enCopy, frCopy, ptBrCopy]) {
      for (const key of ['ScanAgentCode', 'UseAgentAddress', 'OtherPhoneHint'] as const) {
        expect(words.VtaLink[key]).toEqual(expect.any(String))
      }
      // Another phone's "Add another device" names the button this one shows.
      expect(words.CreateAgent.BackupScanThisBody).toContain(words.VtaLink.ScanAgentCode)
      expect(JSON.stringify(words.CreateAgent)).not.toMatch(/claim|revendiquer|reivindi/i)
    }
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

  // IN-20(a)(b): a membership reached My Agent only on its 4 s timer, the
  // persona inbox, or a background/foreground.
  test('a membership this phone stores shows at once, without waiting for the timer', async () => {
    const records = [manager, persona]
    const agent = fakeAgent(records)
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
    expect(tree.queryByTestId(testIdWithKey('MyAgentMembershipCard'))).toBeNull()
    records.push({
      tags: { recordType: 'keyring/vti-community', kind: 'membership', key: config.communityDid },
      content: {
        communityDid: config.communityDid,
        personaDid,
        role: 'member',
        vmc: {},
        grantedAt: '2026-09-25T00:00:00Z',
        via: 'vetting',
      },
    })
    await act(async () => {
      emitCommunityChanged(config.communityDid, 'membership')
      // Well short of the 4 s timer.
      jest.advanceTimersByTime(10)
    })
    expect(tree.getByTestId(testIdWithKey('MyAgentMembershipCard'))).toBeTruthy()
  })

  // manifest/0.4: this older panel joins in place and cannot show a
  // community's directory statement. A join refused for that opens the
  // invitation where the statement is shown, rather than a message the person
  // could not act on here.
  test('a join refused because the directory terms were not shown opens the invitation where they are', async () => {
    const records = [
      manager,
      persona,
      {
        tags: { recordType: 'keyring/vti-community', kind: 'invitation', key: 'inv-1' },
        content: {
          id: 'inv-1',
          communityDid: config.communityDid,
          subjectDid: personaDid,
          role: 'member',
          credential: {},
          receivedAt: '2026-10-18T00:00:00Z',
          status: 'pending',
        },
      },
    ]
    const agent = fakeAgent(records)
    mockUseAgent.mockReturnValue(agent)
    connectedTo(agent)
    mockJoin.mockRejectedValueOnce(new DisclosureNotShown('zQmStatement'))
    const navigate = (useNavigation() as unknown as { navigate: jest.Mock }).navigate
    navigate.mockClear()
    const tree = render(
      <BasicAppContext>
        <MyAgent config={config} />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('JoinCommunityButton'))))
    expect(communityTarget.getChosen()?.communityDid).toBe(config.communityDid)
    expect(navigate).toHaveBeenCalledWith(Screens.VtiInvited)
    expect(tree.queryByText(/Errors\.DirectoryNotShown/)).toBeNull()
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
