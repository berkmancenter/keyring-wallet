/**
 * Agent settings, opened from the gear in "Your agent"'s header (Alberto,
 * 10-06): naming the agent, the other agents and unlinking them, what waits
 * on someone else's consent, unlinking this agent, what it did, and Details.
 * What used to unfold at the foot of "Your agent".
 */
import { useNavigation, useRoute } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { ScrollView, StyleSheet } from 'react-native'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { TAB_BAR_CLEARANCE } from '../screens/aboveTabBar'
import { communityJourneys } from '../module/communityJourney'
import { vtaAgent } from '../module/vtaAgent'
import VtaAgentSettings from '../screens/VtaAgentSettings'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useRoute: jest.fn(() => ({ params: undefined })),
}))

type Setter = { set(next: Record<string, unknown>): void }
const controller = vtaAgent as unknown as Setter
const HOME = 'did:webvh:example:settings-home-vta'
const WORK = 'did:webvh:example:settings-work-vta'

const agentWithNoRecords = () => ({
  agent: {
    genericRecords: { findAllByQuery: async () => [] },
    config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
  },
})

describe('Agent settings', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    ;(useRoute as jest.Mock).mockReturnValue({ params: undefined })
    controller.set({
      introSeen: true,
      activity: [],
      agentNames: undefined,
      awaitingConsentFor: undefined,
      agents: [{ vtaDid: HOME, label: 'Home' }],
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
    controller.set({ agents: undefined, agentNames: undefined, unlinkingOthers: undefined })
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  const show = async () => {
    ;(useAgent as jest.Mock).mockReturnValue(agentWithNoRecords())
    const tree = render(
      <BasicAppContext>
        <VtaAgentSettings />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    return tree
  }

  it('holds what was under "Agent settings" on Your agent, and Details stays shut', async () => {
    const tree = await show()
    for (const key of ['AgentNameCard', 'AgentUnlink', 'AgentActivity', 'AgentDetailsToggle']) {
      expect(tree.getByTestId(testIdWithKey(key))).toBeTruthy()
    }
    expect(tree.queryByTestId(testIdWithKey('AgentDetails'))).toBeNull()
    fireEvent.press(tree.getByTestId(testIdWithKey('AgentDetailsToggle')))
    expect(tree.getByTestId(testIdWithKey('AgentDetails'))).toHaveTextContent(new RegExp(HOME))
    // One agent: no list of others.
    expect(tree.queryByTestId(testIdWithKey('AgentOthers'))).toBeNull()
    // Requests are on Your agent, not here.
    expect(tree.queryByTestId(testIdWithKey('AgentRequestsRow'))).toBeNull()
  })

  // Alberto, 238: the same section lines and heading style as "Your agent".
  it('sets each section apart with a line, before what the agent did, Details and Unlink', async () => {
    const tree = await show()
    const ids: string[] = []
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) return node.forEach(walk)
      const n = node as { props?: { testID?: string }; children?: unknown[] }
      if (n.props?.testID) ids.push(n.props.testID)
      n.children?.forEach(walk)
    }
    walk(tree.toJSON())
    const at = (key: string) => ids.indexOf(testIdWithKey(key))
    const rules = ids.map((id, i) => (id === testIdWithKey('AgentSectionRule') ? i : -1)).filter((i) => i >= 0)
    for (const section of ['AgentActivity', 'AgentDetailsToggle', 'AgentUnlink']) {
      // The line just before each section: none of the others lies between.
      const before = rules.filter((r) => r < at(section)).pop()
      expect(before).toBeDefined()
      expect(rules.some((r) => r > (before ?? -1) && r < at(section))).toBe(false)
    }
    expect(at('AgentNameCard')).toBeLessThan(rules[0])
  })

  it('leaves room at its foot for the tab bar, so Unlink scrolls clear of it', async () => {
    const tree = await show()
    expect(
      StyleSheet.flatten(tree.getByTestId(testIdWithKey('AgentSettingsScreen')).props.contentContainerStyle)
        .paddingBottom
    ).toBeGreaterThanOrEqual(TAB_BAR_CLEARANCE)
  })

  it("a task of this phone's waiting on someone else's consent is said here", async () => {
    controller.set({ awaitingConsentFor: 'https://trusttasks.org/spec/vta/contexts/list/1.0' })
    const tree = await show()
    expect(tree.getByTestId(testIdWithKey('AgentAwaitingConsent'))).toHaveTextContent(/MyAgent\.AwaitingConsent/)
  })

  describe('naming the agent', () => {
    it('saves the name on this phone, and offers its own name back once it has one', async () => {
      const name = jest.spyOn(vtaAgent, 'nameAgent').mockResolvedValue(undefined)
      const tree = await show()
      expect(tree.getByTestId(testIdWithKey('AgentNameSave')).props.accessibilityState).toMatchObject({
        disabled: true,
      })
      fireEvent.changeText(tree.getByTestId(testIdWithKey('AgentNameInput')), '  al-signer  ')
      await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('AgentNameSave'))))
      expect(name).toHaveBeenCalledWith(expect.anything(), HOME, '  al-signer  ')
      expect(tree.queryByTestId(testIdWithKey('AgentNameReset'))).toBeNull()

      await act(async () => controller.set({ agentNames: { [HOME]: { label: 'al-signer', source: 'nickname' } } }))
      await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('AgentNameReset'))))
      expect(name).toHaveBeenLastCalledWith(expect.anything(), HOME, '')
    })
  })

  describe('unlinking this agent', () => {
    it('asks first, in place, naming the agent and saying what the person loses', async () => {
      const unlink = jest.spyOn(vtaAgent, 'unlink').mockResolvedValue(undefined)
      const tree = await show()
      expect(tree.queryByTestId(testIdWithKey('AgentUnlinkCard'))).toBeNull()
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentUnlink')))
      expect(tree.getByTestId(testIdWithKey('AgentUnlinkTitle'))).toHaveTextContent('VtaLink.UnlinkTitle')
      expect(tree.getByTestId(testIdWithKey('AgentUnlinkBody'))).toHaveTextContent('VtaLink.UnlinkBody')
      expect(unlink).not.toHaveBeenCalled()
    })

    // Phase 1: the link screen opened on the next agent's state and said "Linked ✓" for an agent nobody had just
    // linked. The agent home shows the next agent, or the way to link when none is left.
    it("forgets the unlinked agent's community readings", async () => {
      jest.spyOn(vtaAgent, 'unlink').mockResolvedValue(undefined)
      const forget = jest.spyOn(communityJourneys, 'forget')
      const tree = await show()
      const linkedDid = (vtaAgent.getState().link as { vtaDid: string }).vtaDid
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentUnlink')))
      await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('AgentUnlinkConfirm'))))
      expect(forget).toHaveBeenCalledWith(linkedDid)
      // And those read with no agent current.
      expect(forget).toHaveBeenCalledWith('')
    })

    it('unlinks on confirm and lands on the agent home: the next agent when there is one', async () => {
      const unlink = jest.spyOn(vtaAgent, 'unlink').mockResolvedValue(undefined)
      const navigate = useNavigation().navigate as jest.Mock
      navigate.mockClear()
      const tree = await show()
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentUnlink')))
      await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('AgentUnlinkConfirm'))))
      expect(unlink).toHaveBeenCalledTimes(1)
      expect(navigate).toHaveBeenCalledWith(Screens.VtaAgent)
      expect(navigate).not.toHaveBeenCalledWith(Screens.VtaLink)
    })

    // 269 gate, agents R4: it went to the old panel, which said "Connected" over a community's session.
    it('…and the link screen, which offers the way to link, when no agent is left', async () => {
      const before = vtaAgent.getState().link
      const unlink = jest.spyOn(vtaAgent, 'unlink').mockImplementation(async () => {
        controller.set({ link: { kind: 'notLinked' } })
      })
      const navigate = useNavigation().navigate as jest.Mock
      navigate.mockClear()
      const tree = await show()
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentUnlink')))
      await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('AgentUnlinkConfirm'))))
      expect(unlink).toHaveBeenCalledTimes(1)
      expect(navigate).toHaveBeenCalledWith(Screens.VtaLink)
      expect(navigate).not.toHaveBeenCalledWith(Screens.MyAgent)
      controller.set({ link: before })
    })

    // 7a on #481: telling the agent can hold an unlink up to ten seconds; a blank page that long reads as frozen.
    // 7a on #481: an add can start while Settings is open (a link, another agent's screen); it read as an unlink.
    it('an add under way reads as an add, not an unlink', async () => {
      const before = vtaAgent.getState().link
      const tree = await show()
      await act(async () => {
        controller.set({ addingAgent: true, link: { kind: 'notLinked' } })
      })
      expect(tree.getByTestId(testIdWithKey('AgentSettingsScreen'))).toHaveTextContent(/VtaLink\.AddingAgent/)
      expect(tree.getByTestId(testIdWithKey('AgentSettingsScreen'))).not.toHaveTextContent(/VtaLink\.Unlinking/)
      controller.set({ addingAgent: false, link: before })
    })

    it('while an unlink passes through "not linked", it says so, and never that there is nothing to link', async () => {
      const before = vtaAgent.getState().link
      const tree = await show()
      await act(async () => {
        controller.set({ unlinking: true, link: { kind: 'notLinked' } })
      })
      expect(tree.getByTestId(testIdWithKey('AgentSettingsScreen'))).not.toHaveTextContent(/VtaLink\.NothingToLink/)
      expect(tree.getByTestId(testIdWithKey('AgentSettingsScreen'))).toHaveTextContent(/VtaLink\.Unlinking/)
      // The control: done, and nothing left, it does.
      await act(async () => {
        controller.set({ unlinking: false })
      })
      expect(tree.getByTestId(testIdWithKey('AgentSettingsScreen'))).toHaveTextContent(/VtaLink\.NothingToLink/)
      controller.set({ link: before })
    })

    it('brings the card into view when it opens, at the foot of the screen', async () => {
      const scroll = jest.spyOn(ScrollView.prototype, 'scrollToEnd').mockImplementation(() => undefined)
      const tree = await show()
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentUnlink')))
      await act(async () => {
        jest.advanceTimersByTime(100)
      })
      expect(scroll).toHaveBeenCalledWith({ animated: true })
    })

    it('Cancel closes the card and keeps the link', async () => {
      const unlink = jest.spyOn(vtaAgent, 'unlink').mockResolvedValue(undefined)
      const tree = await show()
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentUnlink')))
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentUnlinkCancel')))
      expect(tree.queryByTestId(testIdWithKey('AgentUnlinkCard'))).toBeNull()
      expect(unlink).not.toHaveBeenCalled()
    })

    it('opened for a gone agent ("Link a new agent"): the card is open, in words for an agent that is gone', async () => {
      ;(useRoute as jest.Mock).mockReturnValue({ params: { unlink: true } })
      controller.set({
        link: {
          kind: 'linked',
          vtaDid: HOME,
          label: 'Home',
          linkedAt: '2026-09-22T00:00:00Z',
          connection: { kind: 'gone', why: 'notFound', since: 0 },
        },
      })
      const unlink = jest.spyOn(vtaAgent, 'unlink').mockResolvedValue(undefined)
      const tree = await show()
      expect(tree.getByTestId(testIdWithKey('AgentUnlinkBody'))).toHaveTextContent(/VtaLink\.UnlinkBodyGone/)
      await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('AgentUnlinkConfirm'))))
      expect(unlink).toHaveBeenCalled()
    })
  })

  describe('several agents', () => {
    beforeEach(() => {
      controller.set({
        agents: [
          { vtaDid: HOME, label: 'Home' },
          { vtaDid: WORK, label: 'Work' },
        ],
      })
    })

    it('unlinking the current agent says which agent comes next', async () => {
      const tree = await show()
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentUnlink')))
      expect(tree.getByTestId(testIdWithKey('AgentUnlinkNext'))).toHaveTextContent('VtaLink.UnlinkNext')
    })

    it('another agent can be unlinked from its row, after a confirmation that names it', async () => {
      const unlinkAgent = jest.spyOn(vtaAgent, 'unlinkAgent').mockResolvedValue(undefined)
      const tree = await show()
      expect(tree.getByTestId(testIdWithKey('AgentOtherRow_1'))).toHaveTextContent(/Work/)
      expect(tree.queryByTestId(testIdWithKey('AgentSwitcherUnlink_0'))).toBeNull()
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentSwitcherUnlink_1')))
      expect(tree.getByTestId(testIdWithKey('AgentUnlinkOtherCard'))).toHaveTextContent(/VtaLink\.UnlinkOtherBody/)
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentUnlinkOtherCancel')))
      expect(tree.queryByTestId(testIdWithKey('AgentUnlinkOtherCard'))).toBeNull()
      expect(unlinkAgent).not.toHaveBeenCalled()
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentSwitcherUnlink_1')))
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentUnlinkOtherConfirm')))
      expect(unlinkAgent).toHaveBeenCalledWith(expect.anything(), WORK)
    })

    // IN-379: the row stayed as it was, with nothing on it, for the 5–10 s the unlink took.
    it('an agent being unlinked says so on its row, with no Unlink to tap again', async () => {
      controller.set({ unlinkingOthers: { [WORK]: 'unlinking' } })
      const tree = await show()
      expect(tree.getByTestId(testIdWithKey('AgentOtherRow_1'))).toHaveTextContent(/VtaLink\.UnlinkingOther/)
      expect(tree.queryByTestId(testIdWithKey('AgentSwitcherUnlink_1'))).toBeNull()
      act(() => controller.set({ unlinkingOthers: {}, agents: [{ vtaDid: HOME, label: 'Home' }] }))
      expect(tree.queryByTestId(testIdWithKey('AgentOtherRow_1'))).toBeNull()
    })

    it('an agent still listed after an unlink says it was not unlinked, and Try again unlinks it at once', async () => {
      const unlinkAgent = jest.spyOn(vtaAgent, 'unlinkAgent').mockResolvedValue(undefined)
      controller.set({ unlinkingOthers: { [WORK]: 'failed' } })
      const tree = await show()
      expect(tree.getByTestId(testIdWithKey('AgentOtherRow_1'))).toHaveTextContent(/VtaLink\.UnlinkOtherFailed/)
      expect(tree.getByTestId(testIdWithKey('AgentSwitcherUnlink_1'))).toHaveTextContent('VtaLink.TryAgain')
      fireEvent.press(tree.getByTestId(testIdWithKey('AgentSwitcherUnlink_1')))
      expect(tree.queryByTestId(testIdWithKey('AgentUnlinkOtherCard'))).toBeNull()
      expect(unlinkAgent).toHaveBeenCalledWith(expect.anything(), WORK)
    })
  })
})
