/**
 * The agent screen after linking: it starts from what the person wants — two
 * doors and where they are on the journey — and the vetter role appears only
 * when a grant stands, never as a locked button up front.
 */
import { useIsFocused, useNavigation } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { DeviceEventEmitter, StyleSheet } from 'react-native'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { TAB_BAR_CLEARANCE } from '../screens/aboveTabBar'
import { vtaAgent } from '../module/vtaAgent'
import { communityTarget } from '../module/vtiCommunityLink'
import { emitCommunityChanged } from '../module/communityChanged'
import { VTI_PERSONA_DELIVERIES_EVENT } from '../module/vtiPersonaInbox'
import VtaAgentHome, { forgetAgentHoldings, VETTER_RECHECK_MS } from '../screens/VtaAgentHome'
import { communityCardKey } from '../screens/CommunityCard'

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
    // Before the requests below expire: one past its expiry does not wait.
    jest.setSystemTime(new Date('2026-09-23T04:00:00Z'))
    forgetAgentHoldings()
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
  // A reconnect that stopped after its tries is said on the agent screen, with
  // Try again — never a silent loop (227: a new key's sign-in stalled on iOS).
  it('says the agent did not answer after reconnecting stopped, and Try again starts afresh', async () => {
    controller.set({ reconnectGaveUp: true })
    const again = jest.spyOn(vtaAgent, 'tryAgainNow').mockResolvedValue(undefined)
    const tree = await renderHome([])
    expect(tree.getByTestId(testIdWithKey('AgentGaveUp'))).toHaveTextContent(/VtaLink\.AgentDidNotAnswer/)
    fireEvent.press(tree.getByTestId(testIdWithKey('AgentTryAgain')))
    expect(again).toHaveBeenCalled()
    controller.set({ reconnectGaveUp: false })
    again.mockRestore()
  })

  // VTI #1978: replies stopped reaching the phone; asks wait, and the screen says why.
  it('says the agent is catching up while replies are not reaching this phone, and not otherwise', async () => {
    controller.set({ repliesStalled: true })
    const tree = await renderHome([])
    expect(tree.getByTestId(testIdWithKey('AgentCatchingUp'))).toHaveTextContent('VtaLink.CatchingUp')
    controller.set({ repliesStalled: false })
    expect((await renderHome([])).queryByTestId(testIdWithKey('AgentCatchingUp'))).toBeNull()
  })

  // Gate 235 shots, iOS: My devices, the last row, sat half under the tab bar.
  it('leaves room at its foot for the tab bar, so its last row scrolls clear of it', async () => {
    const tree = await renderHome([])
    expect(
      StyleSheet.flatten(tree.getByTestId(testIdWithKey('AgentHome')).props.contentContainerStyle).paddingBottom
    ).toBeGreaterThanOrEqual(TAB_BAR_CLEARANCE)
  })

  // 234 known issue: after a refused request, Android's SwipeRefreshLayout
  // behind pull-to-refresh took every tap on the switcher's rows. My Agent has
  // no pull-to-refresh; it reads again on focus.
  it('has no pull-to-refresh', async () => {
    const tree = await renderHome([])
    expect(tree.getByTestId(testIdWithKey('AgentHome')).props.refreshControl).toBeUndefined()
  })

  // The several-agents device check: a switch took about 20 s with nothing on screen.
  it('says which agent it is switching to while a switch lasts, and the chips wait', async () => {
    controller.set({ switchingTo: 'did:webvh:home-screen:other-vta' })
    const use = jest.spyOn(vtaAgent, 'useAgent').mockResolvedValue(undefined)
    const tree = await renderHome([])
    expect(tree.getByTestId(testIdWithKey('AgentSwitching'))).toHaveTextContent(/VtaLink\.Switching/)
    expect(tree.getByTestId(testIdWithKey('AgentSwitcherAdd')).props.accessibilityState).toMatchObject({
      disabled: true,
    })
    fireEvent.press(tree.getByTestId(testIdWithKey('AgentSwitcherAdd')))
    expect(use).not.toHaveBeenCalled()
    controller.set({ switchingTo: undefined })
    use.mockRestore()
  })

  // 234 final gate: Android read the `busy` key even when false, and said "busy" in place of the agent's name.
  it("names each agent's chip to a screen reader by the agent's name, the current one selected", async () => {
    const tree = await renderHome([])
    const chip = tree.getByTestId(testIdWithKey('AgentSwitcherRow_0'))
    // "<name>, Current", as the list's rows read (the e2e switch checks read it).
    expect(chip.props.accessibilityLabel).toBe(
      `${tree.getByTestId(testIdWithKey('AgentHomeName')).props.children}, VtaLink.SwitcherCurrent`
    )
    expect(chip.props.accessibilityState).toEqual({ selected: true, disabled: true })
    // No busy value at all (234: Android said "busy" for a false one).
    expect(chip.props.accessibilityState.busy).toBeUndefined()
  })

  // 228 agent-gone: an agent that no longer exists is said so, with a new one as the way on.
  it('says the agent cannot be found and why, and Link a new agent opens Agent settings at its unlink', async () => {
    const { link } = controller.getState()
    controller.set({ link: { ...(link as object), connection: { kind: 'gone', why: 'notFound', since: 0 } } as never })
    const unlink = jest.spyOn(vtaAgent, 'unlink').mockResolvedValue(undefined)
    const tree = await renderHome([])
    expect(tree.getByTestId(testIdWithKey('AgentGone'))).toHaveTextContent(/VtaLink\.AgentGoneTitle/)
    expect(tree.getByTestId(testIdWithKey('AgentGoneWhy'))).toHaveTextContent(/VtaLink\.AgentGoneNotFound/)
    expect(tree.getByTestId(testIdWithKey('VtaStatusText'))).toHaveTextContent(/VtaLink\.StatusGone/)
    expect(tree.queryByTestId(testIdWithKey('AgentGaveUp'))).toBeNull()

    // Unlinking is confirmed in Agent settings, opened at its unlink (VtaAgentSettingsScreen.test).
    const navigate = useNavigation().navigate as jest.Mock
    navigate.mockClear()
    fireEvent.press(tree.getByTestId(testIdWithKey('AgentGoneLinkNew')))
    expect(navigate).toHaveBeenCalledWith(Screens.VtaAgentSettings, { unlink: true })
    expect(unlink).not.toHaveBeenCalled()
    unlink.mockRestore()
  })

  it('says it has not reached the agent for days when that is why', async () => {
    const { link } = controller.getState()
    controller.set({
      link: { ...(link as object), connection: { kind: 'gone', why: 'unreachable', since: 0 } } as never,
    })
    const tree = await renderHome([])
    expect(tree.getByTestId(testIdWithKey('AgentGoneWhy'))).toHaveTextContent(/VtaLink\.AgentGoneUnreachable/)
  })

  it('an agent that is only offline keeps the usual Unlink words', async () => {
    const tree = await renderHome([])
    expect(tree.queryByTestId(testIdWithKey('AgentGone'))).toBeNull()
  })

  it('says nothing of the kind while reconnecting still has tries left', async () => {
    controller.set({ reconnectGaveUp: false })
    const tree = await renderHome([])
    expect(tree.queryByTestId(testIdWithKey('AgentGaveUp'))).toBeNull()
  })

  it('shows nothing about approvals when there is nothing to approve', async () => {
    const tree = await renderHome([])
    expect(tree.queryByTestId(testIdWithKey('AgentApprovals'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('AgentApprovalCard'))).toBeNull()
  })

  it('names a waiting request in the Requests section, and it opens the Requests screen', async () => {
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
    const navigation = useNavigation() as unknown as { navigate: jest.Mock }
    navigation.navigate.mockClear()
    expect(tree.getByTestId(testIdWithKey('AgentApprovalBanner'))).toHaveTextContent(/Requests\.AsksTo/)
    fireEvent.press(tree.getByTestId(testIdWithKey('AgentApprovalBanner')))
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.VtaRequests)
    controller.set({ approvals: [] })
  })

  // Alberto, 10-06: requests live on "Your agent", not under Agent settings.
  it('Requests are on the page, not under settings: a row says how many wait and leads to Requests', async () => {
    controller.set({
      approvals: [
        {
          id: 'a2',
          requester: 'did:peer:2.Vz6MkrequesterXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          taskType: 'https://trusttasks.org/spec/keys/export-secret/0.1',
          expiresAt: '2026-09-23T04:30:00Z',
          status: 'pending',
        },
      ],
    })
    const tree = await renderHome([])
    const navigation = useNavigation() as unknown as { navigate: jest.Mock }
    navigation.navigate.mockClear()
    // Decided on Requests, not here.
    expect(tree.queryByTestId(testIdWithKey('AgentApprovalCard'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('ApproveConsentButton'))).toBeNull()
    expect(tree.getByTestId(testIdWithKey('AgentRequestsRowCount'))).toHaveTextContent(/Requests\.RowWaiting/)
    fireEvent.press(tree.getByTestId(testIdWithKey('AgentRequestsRow')))
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.VtaRequests)
    controller.set({ approvals: [] })
  })

  it('the Requests section is there with nothing waiting, with "Ask me before…"', async () => {
    controller.set({ approvals: [] })
    const navigation = useNavigation() as unknown as { navigate: jest.Mock }
    navigation.navigate.mockClear()
    const tree = await renderHome([])
    expect(tree.getByTestId(testIdWithKey('AgentRequestsRowCount'))).toHaveTextContent(/Requests\.RowNone/)
    fireEvent.press(tree.getByTestId(testIdWithKey('AgentAskMeRow')))
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.VtaAskMe)
  })

  it('lists at most three waiting requests, then "See all"', async () => {
    const one = (id: string) => ({
      id,
      requester: 'did:peer:2.Vz6MkrequesterXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      taskType: 'https://trusttasks.org/spec/vta/contexts/list/1.0',
      expiresAt: '2026-09-23T04:30:00Z',
      status: 'pending',
    })
    controller.set({ approvals: ['r1', 'r2', 'r3', 'r4'].map(one) })
    const tree = await renderHome([])
    expect(tree.getByTestId(testIdWithKey('AgentApprovalBanner'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('AgentRequestsItem_2'))).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('AgentRequestsItem_3'))).toBeNull()
    expect(tree.getByTestId(testIdWithKey('AgentRequestsAll'))).toHaveTextContent(/VtaLink\.RequestsSeeAll/)
    controller.set({ approvals: [] })
  })

  // 228 lab check of #199: after Approve the card said "Approved" under a banner
  // still saying a request waited. Only undecided requests wait.
  it('says nothing is waiting once every request is decided', async () => {
    const approval = {
      requester: 'did:peer:2.Vz6MkrequesterXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      taskType: 'https://trusttasks.org/spec/vta/contexts/list/1.0',
      expiresAt: '2026-09-23T04:30:00Z',
    }
    controller.set({
      approvals: [
        { ...approval, id: 'done', status: 'approved' },
        { ...approval, id: 'no', status: 'denied' },
      ],
    } as never)
    const decided = await renderHome([])
    expect(decided.queryByTestId(testIdWithKey('AgentApprovalBanner'))).toBeNull()
    decided.unmount()

    controller.set({
      approvals: [
        { ...approval, id: 'done', status: 'approved' },
        { ...approval, id: 'open', status: 'pending' },
      ],
    } as never)
    const one = await renderHome([])
    expect(one.getByTestId(testIdWithKey('AgentApprovalBanner'))).toBeTruthy()
    controller.set({ approvals: [] })
  })

  it('says nothing is waiting for a request past its expiry', async () => {
    controller.set({
      approvals: [
        {
          id: 'late',
          requester: 'did:peer:2.Vz6MkrequesterXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          taskType: 'https://trusttasks.org/spec/vta/contexts/list/1.0',
          expiresAt: '2026-09-23T03:59:00Z',
          status: 'pending',
        },
      ],
    } as never)
    const tree = await renderHome([])
    expect(tree.queryByTestId(testIdWithKey('AgentApprovalBanner'))).toBeNull()
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

  // #166's lab run (09-29): the community's removal notice was stored on the
  // membership, and My Agent still said "You are a member".
  // 227 gate U11 (09-30, lab): after the community removed the member, the
  // agent home read "You have an identity here, and are not a member yet" and
  // offered "Continue your vetting" — as if the person had never joined. The
  // seat says who removed them; the card below says what to do.
  it('after a removal the seat says the community removed you, and offers no vetting to continue', async () => {
    const removed: Rec = {
      tags: membership.tags,
      content: {
        ...membership.content,
        removal: {
          code: 'adminRemoved',
          decidedBy: 'did:webvh:QmAdmin:vtc.example:admin',
          decidedAt: '2026-09-30T13:28:08Z',
          disposition: 'tombstone',
          noticeId: 'urn:uuid:removal-notice-2',
        },
      },
    }
    const tree = await renderHome([persona, removed])
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    const seat = tree.getByTestId(testIdWithKey('AgentSeat'))
    expect(seat).toHaveTextContent('VtaLink.SeatRemoved')
    expect(seat).not.toHaveTextContent('VtaLink.SeatApplicant')
    expect(tree.queryByTestId(testIdWithKey('AgentContinueVetting'))).toBeNull()
  })

  it('removed by one community and applying to another: the seat is the application, with vetting to continue', async () => {
    const otherCommunity = 'did:webvh:QmOther:vtc.example.org:other'
    const applying: Rec = {
      tags: { ...persona.tags, key: otherCommunity },
      content: { ...persona.content, communityDid: otherCommunity, did: 'did:webvh:QmPersona2:vta.example.org:p2' },
    }
    const removed: Rec = {
      tags: membership.tags,
      content: {
        ...membership.content,
        removal: {
          code: 'adminRemoved',
          decidedBy: 'did:webvh:QmAdmin:vtc.example:admin',
          decidedAt: '2026-09-30T13:28:08Z',
          disposition: 'tombstone',
          noticeId: 'urn:uuid:removal-notice-3',
        },
      },
    }
    const tree = await renderHome([persona, removed, applying])
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    expect(tree.getByTestId(testIdWithKey('AgentSeat'))).toHaveTextContent('VtaLink.SeatApplicant')
    expect(tree.getByTestId(testIdWithKey('AgentContinueVetting'))).toBeTruthy()
  })

  it('a membership the community removed is not membership: the seat, the steps and the card say it ended', async () => {
    const removed: Rec = {
      tags: membership.tags,
      content: {
        ...membership.content,
        vmc: {
          id: 'urn:uuid:removed-vmc',
          type: ['VerifiableCredential', 'MembershipCredential'],
          issuer: communityDid,
        },
        removal: {
          code: 'adminRemoved',
          reason: 'Left the project',
          decidedBy: 'did:webvh:QmAdmin:vtc.example:admin',
          decidedAt: '2026-09-29T18:20:00Z',
          disposition: 'tombstone',
          noticeId: 'urn:uuid:removal-notice-1',
        },
      },
    }
    const tree = await renderHome([persona, removed])
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    expect(tree.getByTestId(testIdWithKey('AgentSeat'))).not.toHaveTextContent('VtaLink.SeatMember')
    const key = communityCardKey(communityDid)
    // The community stays on screen, saying what happened.
    expect(tree.getByTestId(testIdWithKey(`AgentCommunityStatus_${key}`))).toHaveTextContent(/Join\.StandingRemoved/)
    expect(tree.queryByTestId(testIdWithKey(`AgentMemberSince_${key}`))).toBeNull()
    const ended = tree.getByTestId(testIdWithKey(`AgentMembershipEnded_${key}`))
    expect(ended).toHaveTextContent(/VtaLink\.CardMembershipEnded/)
    expect(ended).toHaveTextContent(/Community\.RemovedReason/)
    // Its card is history, not "kept by your agent".
    expect(tree.getByTestId(testIdWithKey(`AgentCard_membership_${key}`))).toHaveTextContent(
      /VtaLink\.CardMembershipEnded/
    )
    expect(tree.queryByTestId(testIdWithKey(`AgentCardKept_membership_${key}`))).toBeNull()
  })

  // 219: every tab unmounts when it loses focus, so a return to My Agent
  // rebuilt this screen with nothing read, and for a frame "Holds" spun and the
  // seat line was missing. A return shows the last reading at once.
  describe('coming back to the tab', () => {
    const hanging = (records: Rec[]) => {
      const agent = fakeAgent(records)
      agent.agent.genericRecords.findAllByQuery = () => new Promise(() => undefined)
      return agent
    }
    const mount = () =>
      render(
        <BasicAppContext>
          <VtaAgentHome />
        </BasicAppContext>
      )

    it('shows the last reading straight away, before the stores answer again', async () => {
      const first = await renderHome([persona, membership])
      expect(first.getByTestId(testIdWithKey('AgentSeat'))).toHaveTextContent('VtaLink.SeatMember')
      first.unmount()
      ;(useAgent as jest.Mock).mockReturnValue(hanging([persona, membership]))
      const back = mount()
      expect(back.getByTestId(testIdWithKey('AgentSeat'))).toHaveTextContent('VtaLink.SeatMember')
      expect(back.getByTestId(testIdWithKey('AgentHolds'))).not.toHaveTextContent(/VtaLink\.HoldsNothing/)
    })

    it("another agent never shows the last one's reading", async () => {
      ;(await renderHome([persona, membership])).unmount()
      controller.set({
        link: {
          kind: 'linked',
          vtaDid: 'did:webvh:example:other-vta',
          label: 'carol',
          linkedAt: '2026-09-24T00:00:00Z',
          connection: { kind: 'online', since: 0 },
        },
      })
      ;(useAgent as jest.Mock).mockReturnValue(hanging([]))
      expect(mount().queryByTestId(testIdWithKey('AgentSeat'))).toBeNull()
    })

    it('forgets the reading when told to (unlinking does, from Agent settings)', async () => {
      ;(await renderHome([persona, membership])).unmount()
      forgetAgentHoldings()
      ;(useAgent as jest.Mock).mockReturnValue(hanging([persona, membership]))
      expect(mount().queryByTestId(testIdWithKey('AgentSeat'))).toBeNull()
    })

    it('a refresh that fails keeps the reading and says it could not refresh', async () => {
      ;(await renderHome([persona, membership])).unmount()
      const failing = fakeAgent([persona, membership])
      failing.agent.genericRecords.findAllByQuery = async () => {
        throw new Error('storage unavailable')
      }
      ;(useAgent as jest.Mock).mockReturnValue(failing)
      const back = mount()
      await act(async () => {
        jest.advanceTimersByTime(10)
      })
      expect(back.getByTestId(testIdWithKey('AgentSeat'))).toHaveTextContent('VtaLink.SeatMember')
      expect(back.getByTestId(testIdWithKey('AgentHoldsStale'))).toBeTruthy()
    })
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

  // IN-102: "Join community" opened on the last community a link named, where a
  // member saw only "Open". It starts from the beginning now.
  it('"Join community" starts from the beginning, not on the last community a link opened', async () => {
    communityTarget.set({ communityDid: 'did:webvh:QmLinked:vtc.linked.example', name: 'Linked' })
    const tree = await renderHome([])
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('AgentJoinCommunity'))))
    expect(communityTarget.getViewing()).toBeUndefined()
    expect(useNavigation().navigate).toHaveBeenCalledWith(Screens.VtiJoin)
  })

  it('a grant that stands shows "You can now vet people" with the desk', async () => {
    mockGrantState.mockResolvedValue({ state: 'active', statusChecked: true })
    const tree = await renderHome([persona, grant])
    expect(tree.getByTestId(testIdWithKey('AgentVetterCard'))).toHaveTextContent(/VtaLink.YouCanVet/)
    // The desk is the vetter card's one button, at the top; the community's card does not repeat it.
    expect(tree.getByTestId(testIdWithKey('AgentOpenDesk'))).toHaveTextContent('VtaLink.OpenDesk')
    expect(tree.queryByTestId(testIdWithKey(`AgentCommunityPrimary_${communityCardKey(communityDid)}`))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('AgentVetOthers'))).toBeNull()
  })

  it('a revoked grant says so, and offers no desk', async () => {
    mockGrantState.mockResolvedValue({ state: 'revoked', checkedAt: '2026-09-22T00:00:00Z' })
    const tree = await renderHome([persona, grant])
    expect(tree.getByTestId(testIdWithKey('AgentVetterLapsed'))).toHaveTextContent('VtaLink.VetterRevoked')
    expect(tree.queryByTestId(testIdWithKey('AgentVetOthers'))).toBeNull()
  })

  // IN-20(a)(b): the ticked stop said "Join" and never named the community.
  // IN-20c: one card per community, with what is held for it and one next step.
  it('a member: one card for the community, opening it, with no next step to take', async () => {
    const tree = await renderHome([persona, membership])
    const key = communityCardKey(communityDid)
    expect(tree.getByTestId(testIdWithKey(`AgentCommunityCard_${key}`))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey(`AgentCommunityStatus_${key}`))).toHaveTextContent('Join.StandingMember')
    expect(tree.getByTestId(testIdWithKey('AgentMembershipRow'))).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey(`AgentCommunityPrimary_${key}`))).toBeNull()
  })

  it('an identity with nothing sent: its card offers to continue the vetting', async () => {
    const tree = await renderHome([persona])
    const key = communityCardKey(communityDid)
    expect(tree.getByTestId(testIdWithKey(`AgentCommunityPrimary_${key}`))).toHaveTextContent('VtaLink.ContinueVetting')
    expect(tree.getByTestId(testIdWithKey('AgentShareIdentity'))).toBeTruthy()
  })

  it('a member: a status line names the community, in place of the step bar', async () => {
    const tree = await renderHome([persona, membership])
    expect(tree.getByTestId(testIdWithKey('AgentJourneyJoined'))).toHaveTextContent(/VtaLink\.StatusMemberOf/)
    expect(tree.queryByTestId(testIdWithKey('AgentJourneyJoin'))).toBeNull()
  })

  it('not a member yet: the step to take is "Join"', async () => {
    const tree = await renderHome([persona])
    expect(tree.getByTestId(testIdWithKey('AgentJourneyJoin'))).toHaveTextContent('VtaLink.JourneyJoin')
    expect(tree.queryByTestId(testIdWithKey('AgentJourneyJoined'))).toBeNull()
  })

  it('a membership this phone stores while the screen is open shows at once, with no timer', async () => {
    const records = [persona]
    const tree = await renderHome(records)
    expect(tree.queryByTestId(testIdWithKey('AgentJourneyJoined'))).toBeNull()
    records.push(membership)
    await act(async () => {
      emitCommunityChanged(communityDid, 'membership')
      jest.advanceTimersByTime(10)
    })
    expect(tree.getByTestId(testIdWithKey('AgentJourneyJoined'))).toBeTruthy()
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

  it('a revoke shows within one re-check while the screen stays open', async () => {
    // A revoke sends the phone nothing; only the status list changes.
    mockGrantState.mockResolvedValue({ state: 'active', statusChecked: true })
    const tree = await renderHome([persona, grant])
    expect(tree.getByTestId(testIdWithKey('AgentVetterCard'))).toBeTruthy()
    mockGrantState.mockResolvedValue({ state: 'revoked', checkedAt: '2026-09-24T00:00:00Z' })
    await act(async () => {
      jest.advanceTimersByTime(VETTER_RECHECK_MS)
    })
    expect(tree.getByTestId(testIdWithKey('AgentVetterLapsed'))).toHaveTextContent('VtaLink.VetterRevoked')
    expect(tree.queryByTestId(testIdWithKey('AgentVetOthers'))).toBeNull()
  })

  it('re-checks nothing on a timer for a phone that is not a vetter', async () => {
    const tree = await renderHome([persona])
    expect(tree.queryByTestId(testIdWithKey('AgentVetterCard'))).toBeNull()
    const reads = mockGrantState.mock.calls.length
    await act(async () => {
      jest.advanceTimersByTime(VETTER_RECHECK_MS * 4)
    })
    expect(mockGrantState.mock.calls).toHaveLength(reads)
  })

  it('stops re-checking once the screen is out of view', async () => {
    mockGrantState.mockResolvedValue({ state: 'active', statusChecked: true })
    const focused = useIsFocused as unknown as jest.Mock
    const tree = await renderHome([persona, grant])
    focused.mockReturnValue(false)
    tree.rerender(
      <BasicAppContext>
        <VtaAgentHome />
      </BasicAppContext>
    )
    const reads = mockGrantState.mock.calls.length
    await act(async () => {
      jest.advanceTimersByTime(VETTER_RECHECK_MS * 4)
    })
    expect(mockGrantState.mock.calls).toHaveLength(reads)
    focused.mockReturnValue(true)
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
  it('an applicant can carry on with vetting from the next-step card', async () => {
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

  // Alberto, 10-06: Join and the gear in the header's corners; requests on the
  // page; the rest of what was under "Agent settings" on its own screen.
  // The mock navigation is a plain object; not a hook here.
  const navigationMock = useNavigation
  const corners = () => {
    const setOptions = navigationMock().setOptions as jest.Mock
    const options = setOptions.mock.calls.at(-1)?.[0] as {
      headerLeft: () => React.ReactNode
      headerRight: () => React.ReactNode
    }
    return render(
      <BasicAppContext>
        <>
          {options.headerLeft()}
          {options.headerRight()}
        </>
      </BasicAppContext>
    )
  }

  it('after joining: the communities first, Join in the header with its two ways in, and a gear for settings', async () => {
    const navigate = useNavigation().navigate as jest.Mock
    const tree = await renderHome([persona, membership])
    expect(tree.getByTestId(testIdWithKey('AgentHomeTitle'))).toHaveTextContent('VtaLink.SwitcherTitle')
    expect(tree.getByTestId(testIdWithKey('AgentHomeName'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('AgentHolds'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('AgentDevices'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('AgentRequests'))).toBeTruthy()
    // The doors are behind Join.
    expect(tree.queryByTestId(testIdWithKey('AgentDoors'))).toBeNull()
    // Nothing of settings is on the page.
    for (const key of ['AgentSettings', 'AgentUnlink', 'AgentActivity', 'AgentDetailsToggle']) {
      expect(tree.queryByTestId(testIdWithKey(key))).toBeNull()
    }

    const header = corners()
    expect(header.queryByTestId(testIdWithKey('AgentJoinMenu'))).toBeNull()
    fireEvent.press(header.getByTestId(testIdWithKey('AgentJoinCorner')))
    expect(header.getByTestId(testIdWithKey('AgentJoinMenuJoin'))).toHaveTextContent(/VtaLink\.JoinAnother/)
    navigate.mockClear()
    fireEvent.press(header.getByTestId(testIdWithKey('AgentJoinMenuInvited')))
    expect(navigate).toHaveBeenCalledWith(Screens.VtiInvited)
    expect(header.queryByTestId(testIdWithKey('AgentJoinMenu'))).toBeNull()
    fireEvent.press(header.getByTestId(testIdWithKey('AgentSettings')))
    expect(navigate).toHaveBeenCalledWith(Screens.VtaAgentSettings)
  })

  it('before joining: the two doors lead the page, and Join is in the header too', async () => {
    const tree = await renderHome([persona])
    expect(tree.getByTestId(testIdWithKey('AgentDoors'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('AgentInvited'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('AgentJoinCommunity'))).toBeTruthy()
    const header = corners()
    fireEvent.press(header.getByTestId(testIdWithKey('AgentJoinCorner')))
    expect(header.getByTestId(testIdWithKey('AgentJoinMenuJoin'))).toHaveTextContent(/VtaLink\.WantToJoin/)
    expect(header.getByTestId(testIdWithKey('AgentSettings'))).toBeTruthy()
  })

  it('the introduction has no header corners', async () => {
    controller.set({ introSeen: false })
    await renderHome([])
    const setOptions = useNavigation().setOptions as jest.Mock
    const options = setOptions.mock.calls.at(-1)?.[0] as { headerLeft: () => unknown; headerRight: () => unknown }
    expect(options.headerLeft()).toBeNull()
    expect(options.headerRight()).toBeNull()
    controller.set({ introSeen: true })
  })

  it('no approval waiting: no banner', async () => {
    const tree = await renderHome([])
    expect(tree.queryByTestId(testIdWithKey('AgentApprovalBanner'))).toBeNull()
  })
})

// Several agents, step 2: the agent's name opens the list; switching, adding,
// and the question after an agent is added.
describe('Your agent — several agents', () => {
  // DIDs no other test names: the controller keeps agent names across tests.
  const HOME = 'did:webvh:example:switch-home-vta'
  const WORK = 'did:webvh:example:switch-work-vta'
  beforeEach(() => {
    jest.useFakeTimers()
    forgetAgentHoldings()
    mockGrantState.mockReset()
    mockGrantState.mockResolvedValue({ state: 'none' })
    controller.set({
      introSeen: true,
      activity: [],
      addedAgent: undefined,
      agents: [
        { vtaDid: HOME, label: 'Home' },
        { vtaDid: WORK, label: 'Work' },
      ],
      link: {
        kind: 'linked',
        vtaDid: HOME,
        label: 'Home',
        linkedAt: '2026-09-22T00:00:00Z',
        connection: { kind: 'online', since: 0 },
      },
    })
  })
  afterEach(() => {
    controller.set({ agents: undefined, addedAgent: undefined })
    jest.restoreAllMocks()
    jest.useRealTimers()
  })
  const renderHome = async () => {
    ;(useAgent as jest.Mock).mockReturnValue(fakeAgent([]))
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

  it('the agents are chips: each one by name, the current one filled and selected, and Add at the end', async () => {
    const tree = await renderHome()
    expect(tree.getByTestId(testIdWithKey('AgentSwitcher'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('AgentSwitcherRow_0'))).toHaveTextContent(/Home/)
    expect(tree.getByTestId(testIdWithKey('AgentSwitcherRow_0')).props.accessibilityState).toMatchObject({
      selected: true,
    })
    expect(tree.getByTestId(testIdWithKey('AgentSwitcherCurrent'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('AgentSwitcherOther_1'))).toHaveTextContent('Work')
    expect(tree.getByTestId(testIdWithKey('AgentSwitcherRow_1')).props.accessibilityState).toMatchObject({
      selected: false,
    })
    expect(tree.getByTestId(testIdWithKey('AgentSwitcherAdd'))).toBeTruthy()
  })

  it('choosing another agent switches to it', async () => {
    const use = jest.spyOn(vtaAgent, 'useAgent').mockResolvedValue(undefined)
    const tree = await renderHome()
    fireEvent.press(tree.getByTestId(testIdWithKey('AgentSwitcherRow_1')))
    expect(use).toHaveBeenCalledWith(expect.anything(), WORK)
  })

  it('"Add" leaves the current agent and opens linking', async () => {
    const navigate = useNavigation().navigate as jest.Mock
    navigate.mockClear()
    const start = jest.spyOn(vtaAgent, 'startAddingAgent').mockResolvedValue(undefined)
    const tree = await renderHome()
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentSwitcherAdd')))
    })
    expect(start).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith(Screens.VtaLink)
  })

  it('one agent: one chip, and "Add another agent"', async () => {
    controller.set({ agents: [{ vtaDid: HOME, label: 'Home' }] })
    const tree = await renderHome()
    expect(tree.queryByTestId(testIdWithKey('AgentSwitcherRow_1'))).toBeNull()
    expect(tree.getByTestId(testIdWithKey('AgentSwitcherAdd'))).toHaveTextContent(/VtaLink\.SwitcherAdd/)
  })

  it('two agents with no name: "Agent 1" and "Agent 2", never "your agent" twice', async () => {
    controller.set({
      agents: [
        { vtaDid: HOME, label: HOME },
        { vtaDid: WORK, label: WORK },
      ],
      link: {
        kind: 'linked',
        vtaDid: HOME,
        label: HOME,
        linkedAt: '2026-09-22T00:00:00Z',
        connection: { kind: 'online', since: 0 },
      },
    })
    const tree = await renderHome()
    expect(tree.getByTestId(testIdWithKey('AgentHomeName'))).toHaveTextContent('VtaLink.ChipUnnamed')
    expect(tree.getByTestId(testIdWithKey('AgentSwitcherOther_1'))).toHaveTextContent('VtaLink.ChipUnnamed')
  })

  it('after an agent is added: use it now, or keep the one before', async () => {
    controller.set({
      addedAgent: { from: WORK, added: HOME },
    })
    const use = jest.spyOn(vtaAgent, 'useAgent').mockResolvedValue(undefined)
    const ack = jest.spyOn(vtaAgent, 'acknowledgeAdded').mockImplementation(() => undefined)
    const tree = await renderHome()
    expect(tree.getByTestId(testIdWithKey('AgentAddedCard'))).toHaveTextContent(/VtaLink\.AddedLinked/)
    expect(tree.getByTestId(testIdWithKey('AgentAddedKeep'))).toHaveTextContent('VtaLink.AddedKeep')
    fireEvent.press(tree.getByTestId(testIdWithKey('AgentAddedUse')))
    expect(ack).toHaveBeenCalled()
    fireEvent.press(tree.getByTestId(testIdWithKey('AgentAddedKeep')))
    expect(use).toHaveBeenCalledWith(expect.anything(), WORK)
  })

  it("each agent's chip carries its own count of requests waiting", async () => {
    controller.set({
      otherRequests: {
        [WORK]: {
          approvals: [{ id: 'w1', status: 'pending', receivedAt: 't', challenge: 'c' }],
          reachable: true,
          at: 0,
        },
      },
    })
    const tree = await renderHome()
    expect(tree.getByTestId(testIdWithKey('AgentSwitcherBadge_1'))).toHaveTextContent('1')
    expect(tree.getByTestId(testIdWithKey('AgentSwitcherRow_1')).props.accessibilityLabel).toMatch(
      /^Work, VtaLink\.SwitcherWaiting/
    )
    expect(tree.queryByTestId(testIdWithKey('AgentSwitcherBadge_0'))).toBeNull()
    controller.set({ otherRequests: undefined })
  })
})
