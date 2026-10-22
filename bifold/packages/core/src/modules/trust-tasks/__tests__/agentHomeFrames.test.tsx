/**
 * The agent home never paints a frame from a state it is not in (UI-smoothness plan, Phase 1b). The holdings for
 * the agent now current are worked out in render; an effect used to swap them in after paint, so the first frame
 * after a switch showed the agent before's communities, and a member's page drew the non-member's "ways in" until
 * the first read came back.
 *
 * `act()` flushes effects, so the end of a test cannot see the frame in between. A probe rendered after the screen
 * records the committed tree in a layout effect, which runs right after each commit the store change causes —
 * before any passive effect could correct it.
 */
import { act, fireEvent, render, within } from '@testing-library/react-native'
import React, { useLayoutEffect, useSyncExternalStore } from 'react'
import { ActivityIndicator } from 'react-native'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { emitCommunityChanged } from '../module/communityChanged'
import { vtaAgent } from '../module/vtaAgent'
import { communityTarget } from '../module/vtiCommunityLink'
import { communityCardKey } from '../screens/CommunityCard'
import VtaAgentHome, { forgetAgentHoldings } from '../screens/VtaAgentHome'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useIsFocused: jest.fn(() => true),
}))
jest.mock('../module/vtiGrantState', () => ({
  ownVetterGrantState: async () => ({ state: 'none' }),
}))

type Rec = { tags: Record<string, string>; content: Record<string, unknown> }
const controller = vtaAgent as unknown as { set(next: Record<string, unknown>): void }

const VTA_A = 'did:webvh:example:vta-a'
const VTA_B = 'did:webvh:example:vta-b'
const COMMUNITY = 'did:webvh:QmCommunityA:vtc.example.org:keyring-test-vtc'
const id = (key: string) => testIdWithKey(key)
const cardOf = (did: string) => id(`AgentCommunityCard_${communityCardKey(did)}`)

const persona = (communityDid: string, vtaDid: string): Rec => ({
  tags: { recordType: 'keyring/vti-identity', kind: 'persona', key: communityDid },
  content: {
    communityDid,
    vtaDid,
    did: `${communityDid}:p`,
    contextId: 'vta',
    vtaKeyIds: { signing: 's', keyAgreement: 'k' },
    kmsKeyIds: { signing: 'ks', keyAgreement: 'kk' },
    createdAt: '2026-09-20T00:00:00Z',
  },
})
const membership = (communityDid: string): Rec => ({
  tags: { recordType: 'keyring/vti-community', kind: 'membership', key: communityDid },
  content: {
    communityDid,
    personaDid: `${communityDid}:p`,
    role: 'member',
    vmc: {},
    grantedAt: '2026-09-22T00:00:00Z',
  },
})

/** An agent whose records answer at once, never (`hang`: a read still out), or with an error (`fail`). */
function fakeAgent(records: Rec[], hang = () => false, fail = () => false) {
  return {
    agent: {
      genericRecords: {
        findAllByQuery: (query: Record<string, string>) =>
          fail()
            ? Promise.reject(new Error('storage unavailable'))
            : hang()
              ? new Promise(() => undefined)
              : Promise.resolve(
                  records
                    .filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v))
                    .map((r) => ({ ...r, id: r.tags.key }))
                ),
      },
      config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
    },
  }
}

const linkedTo = (vtaDid: string) => ({
  kind: 'linked',
  vtaDid,
  label: vtaDid.endsWith('a') ? 'a' : 'b',
  linkedAt: '2026-09-22T12:00:00Z',
  connection: { kind: 'online', since: 0 },
})

/** The home, with a probe after it that records each committed frame's answer to `ask`. */
function renderWithFrames(ask: (tree: ReturnType<typeof render>) => boolean) {
  const frames: boolean[] = []
  const box: { tree?: ReturnType<typeof render> } = {}
  const Probe = () => {
    // Re-rendered by every store change, in the same commit as the screen.
    useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)
    useLayoutEffect(() => {
      if (box.tree) frames.push(ask(box.tree))
    })
    return null
  }
  box.tree = render(
    <BasicAppContext>
      <VtaAgentHome />
      <Probe />
    </BasicAppContext>
  )
  return { tree: box.tree, frames }
}

const settle = async () => {
  await act(async () => {
    jest.advanceTimersByTime(10)
  })
}

describe('the agent home paints only the state it is in', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    forgetAgentHoldings()
    communityTarget.clear()
    controller.set({ introSeen: true, activity: [], approvals: [], switchingTo: undefined, link: linkedTo(VTA_A) })
  })
  afterEach(() => jest.useRealTimers())

  it("a switch to another agent: no frame shows the agent before's communities", async () => {
    // A's identity and membership; B holds nothing there.
    ;(useAgent as jest.Mock).mockReturnValue(fakeAgent([persona(COMMUNITY, VTA_A), membership(COMMUNITY)]))
    const { tree, frames } = renderWithFrames((t) => Boolean(t.queryByTestId(cardOf(COMMUNITY))))
    await settle()
    // The control: A's community is on screen before the switch.
    expect(tree.getByTestId(cardOf(COMMUNITY))).toBeTruthy()
    frames.length = 0
    await act(async () => {
      controller.set({ link: linkedTo(VTA_B) })
    })
    await settle()
    // The first frame on B, and every one after: never A's community.
    expect(frames.length).toBeGreaterThan(0)
    expect(frames).not.toContain(true)
  })

  it("a member whose holdings are still being read: no frame shows the non-member's ways in", async () => {
    let reading = true
    ;(useAgent as jest.Mock).mockReturnValue(
      fakeAgent([persona(COMMUNITY, VTA_A), membership(COMMUNITY)], () => reading)
    )
    const { tree, frames } = renderWithFrames((t) => Boolean(t.queryByTestId(id('AgentDoors'))))
    await act(async () => {
      controller.set({ activity: [] })
    })
    await settle()
    expect(frames.length).toBeGreaterThan(0)
    expect(frames).not.toContain(true)
    expect(tree.queryByTestId(id('AgentDoors'))).toBeNull()
    reading = false
  })

  it('…and a phone that is not a member does get them, once its holdings are known (the control)', async () => {
    ;(useAgent as jest.Mock).mockReturnValue(fakeAgent([]))
    const { tree } = renderWithFrames(() => false)
    await settle()
    expect(tree.getByTestId(id('AgentDoors'))).toBeTruthy()
  })

  // 7a on #482: a first read that failed, with nothing kept, showed a spinner that never stopped beside "showing what
  // was last read" — nothing was — and no way in. Waiting and broken now read differently.
  describe('what the holdings card says while they are not known', () => {
    const holds = (tree: ReturnType<typeof render>) => within(tree.getByTestId(id('AgentHolds')))
    const spinning = (tree: ReturnType<typeof render>) =>
      holds(tree).UNSAFE_queryAllByType(ActivityIndicator).length > 0

    it('a first read that failed, nothing kept: says so, offers Try again — no spinner, no "last read", no ways in', async () => {
      ;(useAgent as jest.Mock).mockReturnValue(fakeAgent([], undefined, () => true))
      const { tree } = renderWithFrames(() => false)
      await settle()
      expect(tree.getByTestId(id('AgentHoldsUnread'))).toHaveTextContent('VtaLink.HoldsUnread')
      expect(tree.getByTestId(id('AgentHoldsRetry'))).toBeTruthy()
      expect(spinning(tree)).toBe(false)
      expect(tree.queryByTestId(id('AgentHoldsStale'))).toBeNull()
      expect(tree.queryByTestId(id('AgentDoors'))).toBeNull()
    })

    it('a first read still out: the spinner, and none of the rest', async () => {
      ;(useAgent as jest.Mock).mockReturnValue(fakeAgent([], () => true))
      const { tree } = renderWithFrames(() => false)
      await settle()
      expect(spinning(tree)).toBe(true)
      expect(tree.queryByTestId(id('AgentHoldsUnread'))).toBeNull()
      expect(tree.queryByTestId(id('AgentHoldsStale'))).toBeNull()
    })

    it('a later read that failed, with a reading kept: "showing what was last read", as before (the control)', async () => {
      let failing = false
      ;(useAgent as jest.Mock).mockReturnValue(
        fakeAgent([persona(COMMUNITY, VTA_A), membership(COMMUNITY)], undefined, () => failing)
      )
      const { tree } = renderWithFrames(() => false)
      await settle()
      expect(tree.getByTestId(cardOf(COMMUNITY))).toBeTruthy()
      failing = true
      await act(async () => emitCommunityChanged(COMMUNITY, 'membership'))
      await settle()
      expect(tree.getByTestId(id('AgentHoldsStale'))).toHaveTextContent('VtaLink.HoldsStale')
      expect(tree.getByTestId(cardOf(COMMUNITY))).toBeTruthy()
      expect(tree.queryByTestId(id('AgentHoldsUnread'))).toBeNull()
    })

    it('Try again that succeeds: the page as it is (here, a phone with no community: the ways in)', async () => {
      let failing = true
      ;(useAgent as jest.Mock).mockReturnValue(fakeAgent([], undefined, () => failing))
      const { tree } = renderWithFrames(() => false)
      await settle()
      failing = false
      await act(async () => {
        fireEvent.press(tree.getByTestId(id('AgentHoldsRetry')))
      })
      await settle()
      expect(tree.queryByTestId(id('AgentHoldsUnread'))).toBeNull()
      expect(tree.getByTestId(id('AgentDoors'))).toBeTruthy()
    })
  })
})
