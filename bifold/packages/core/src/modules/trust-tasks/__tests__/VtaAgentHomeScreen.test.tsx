/**
 * The agent screen after linking: it starts from what the person wants — two
 * doors and where they are on the journey — and the vetter role appears only
 * when a grant stands, never as a locked button up front.
 */
import { useIsFocused, useNavigation } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { DeviceEventEmitter } from 'react-native'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import { VTI_PERSONA_DELIVERIES_EVENT } from '../module/vtiPersonaInbox'
import VtaAgentHome from '../screens/VtaAgentHome'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
// The shared navigation mock, with focus under the test's control.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useIsFocused: jest.fn(() => true),
}))
const mockGrantState = jest.fn()
jest.mock('../module/vtiGrantState', () => ({
  ownVetterGrantState: (...args: unknown[]) => mockGrantState(...args),
}))

type Setter = { set(next: Record<string, unknown>): void }
const controller = vtaAgent as unknown as Setter
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
const membership: Rec = {
  tags: { recordType: 'keyring/vti-community', kind: 'membership', key: communityDid },
  content: { communityDid, personaDid, role: 'member', vmc: {}, grantedAt: '2026-09-22T00:00:00Z', via: 'vetting' },
}
const grant: Rec = {
  tags: { recordType: 'keyring/vti-community', kind: 'credential', key: 'g1' },
  content: {
    kind: 'vetter-grant',
    communityDid,
    subjectDid: personaDid,
    credential: {},
    receivedAt: '2026-09-22T00:00:00Z',
  },
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

  /**
   * Report #11's redesign: one screen for the state. What the operator panel
   * held either moved here or opens its own screen, and the sections that used
   * to sit there permanently saying "none" are simply absent until they have
   * something in them — half of why the panel read as a developer's screen.
   */
  it('shows nothing about approvals when there is nothing to approve', async () => {
    const tree = await renderHome([])
    expect(tree.queryByTestId(testIdWithKey('AgentApprovals'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('AgentApprovalCard'))).toBeNull()
  })

  it('puts an approval above the doors, with what it is and when it expires', async () => {
    controller.set({
      approvals: [
        {
          id: 'a1',
          requester: 'did:peer:2.Vz6MkrequesterXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          taskType: 'https://trusttasks.org/spec/vta/webvh/dids/create/1.0',
          expiresAt: '2026-09-23T04:30:00Z',
          status: 'pending',
        },
      ],
    })
    const tree = await renderHome([])
    const card = tree.getByTestId(testIdWithKey('AgentApprovalCard'))
    // The task, not its URI; the requester short, not entire.
    expect(card).toHaveTextContent(/MyAgent\.ApprovalAsks/)
    expect(card).toHaveTextContent(/MyAgent\.ApprovalExpires/)
    // The task URI is ours to read, not the person's.
    expect(card).not.toHaveTextContent(/trusttasks\.org/)
    expect(tree.getByTestId(testIdWithKey('ApproveConsentButton'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('DenyConsentButton'))).toBeTruthy()
    controller.set({ approvals: [] })
  })

  it('says an invitation is waiting on the door that accepts it', async () => {
    const invitation: Rec = {
      tags: { recordType: 'keyring/vti-community', kind: 'invitation', key: 'i1' },
      content: { id: 'i1', communityDid, subjectDid: personaDid, role: 'member', status: 'pending' },
    }
    const tree = await renderHome([persona, invitation])
    expect(tree.getByTestId(testIdWithKey('AgentInvitationWaiting'))).toBeTruthy()
  })

  it('does not mention an invitation when none is waiting', async () => {
    const tree = await renderHome([persona])
    expect(tree.queryByTestId(testIdWithKey('AgentInvitationWaiting'))).toBeNull()
  })

  /**
   * One place says what this phone is, so a reader does not have to infer a
   * seat from which cards happen to be on screen — that inference is how a
   * harness ended up waiting on an id that never existed.
   */
  it('says nothing about the seat until what the agent holds has been read', async () => {
    const mockUseAgent = useAgent as jest.Mock
    mockUseAgent.mockReturnValue(fakeAgent([persona, membership]))
    const tree = render(
      <BasicAppContext>
        <VtaAgentHome />
      </BasicAppContext>
    )
    // Before the stores answer, no line — never a passing "not joined yet".
    expect(tree.queryByTestId(testIdWithKey('AgentSeat'))).toBeNull()
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    expect(tree.getByTestId(testIdWithKey('AgentSeat'))).toHaveTextContent('VtaLink.SeatMember')
  })

  it('says the seat in one line, for each of the four cases', async () => {
    expect(await (await renderHome([])).findByTestId(testIdWithKey('AgentSeat'))).toHaveTextContent('VtaLink.SeatNone')
    expect(await (await renderHome([persona])).findByTestId(testIdWithKey('AgentSeat'))).toHaveTextContent(
      'VtaLink.SeatApplicant'
    )
    mockGrantState.mockResolvedValue({ state: 'active', statusChecked: true })
    expect(await (await renderHome([persona, grant])).findByTestId(testIdWithKey('AgentSeat'))).toHaveTextContent(
      'VtaLink.SeatVetter'
    )
  })

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

  it('reads what the agent holds again when the screen comes back into view', async () => {
    // It stays mounted under Join and Vetting: an identity made there must show on return.
    const focused = useIsFocused as unknown as jest.Mock
    const records: Rec[] = []
    const tree = await renderHome(records)
    expect(tree.getByTestId(testIdWithKey('AgentSeat'))).toHaveTextContent('VtaLink.SeatNone')
    focused.mockReturnValue(false)
    tree.rerender(
      <BasicAppContext>
        <VtaAgentHome />
      </BasicAppContext>
    )
    records.push(persona)
    focused.mockReturnValue(true)
    tree.rerender(
      <BasicAppContext>
        <VtaAgentHome />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    expect(tree.getByTestId(testIdWithKey('AgentSeat'))).toHaveTextContent('VtaLink.SeatApplicant')
    expect(tree.getByTestId(testIdWithKey('AgentContinueVetting'))).toBeTruthy()
    focused.mockReturnValue(true)
  })

  /**
   * The operator panel was an applicant's only way back into vetting, and a
   * member's only way to a community. Both now start here, so a linked phone
   * never needs the panel.
   */
  it('an applicant can carry on with vetting from the line that says why', async () => {
    const navigate = useNavigation().navigate as jest.Mock
    navigate.mockClear()
    const tree = await renderHome([persona])
    fireEvent.press(tree.getByTestId(testIdWithKey('AgentContinueVetting')))
    expect(navigate).toHaveBeenCalledWith(Screens.VtiVetting)
  })

  it('offers no way into vetting to someone with no identity, a member or a vetter', async () => {
    expect((await renderHome([])).queryByTestId(testIdWithKey('AgentContinueVetting'))).toBeNull()
    expect((await renderHome([persona, membership])).queryByTestId(testIdWithKey('AgentContinueVetting'))).toBeNull()
    mockGrantState.mockResolvedValue({ state: 'active', statusChecked: true })
    expect((await renderHome([persona, grant])).queryByTestId(testIdWithKey('AgentContinueVetting'))).toBeNull()
  })

  it('a member opens a community from its row, and there is no way to the old panel', async () => {
    const navigate = useNavigation().navigate as jest.Mock
    navigate.mockClear()
    const tree = await renderHome([persona, membership])
    expect(tree.queryByTestId(testIdWithKey('AgentOpenCommunities'))).toBeNull()
    fireEvent.press(tree.getByTestId(testIdWithKey('AgentMembershipRow')))
    expect(navigate).toHaveBeenCalledWith(Screens.VtiCommunity, { communityDid })
    expect(navigate).not.toHaveBeenCalledWith(Screens.MyAgent)
  })
})
