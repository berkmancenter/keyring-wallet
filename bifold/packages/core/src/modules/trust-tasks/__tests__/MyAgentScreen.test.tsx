/**
 * My Agent — the connected gate and the vetting seat. Before the agent is
 * connected the screen offers exactly one thing to do (connect, with the
 * manager identity to enrol); once it is, what the agent holds appears, led
 * by the vetting entry that names the seat this phone takes.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'
import { useNavigation } from '@react-navigation/native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import enCopy from '../../../localization/en/en.json'
import frCopy from '../../../localization/fr/fr.json'
import ptBrCopy from '../../../localization/pt-br/pt-br.json'
import MyAgent from '../screens/MyAgent'
import { emitCommunityChanged } from '../module/communityChanged'
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
