/**
 * How polls are read, through the real service, check and screens (pollsReadSwitch):
 * - the Waiting for you check asks every community at once and shows each one's cards as it answers, so a community
 *   that has not answered holds back no other (off: one after another, the control);
 * - one read of a community serves the check and the community's page alike (off: each asks, the control), for
 *   `SHARED_READ_MS`; a failed read is not kept, and a ticket there ends the share.
 */
import type { Agent } from '@credo-ts/core'
import { act, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { AppState } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { WaitingForYou } from '../../../components/messages/WaitingForYou'
import { testIdWithKey } from '../../../utils/testable'
import { CommunityPollsSection } from '../components/CommunityPollsSection'
import { PollsIds } from '../components/Polls.ids'
import { createPollService, type PollsBackend } from '../pollService'
import { POLLS_CHECK_PARALLEL, POLLS_SHARED_READ, SHARED_READ_MS } from '../pollsReadSwitch'
import { publishPollsWaiting, resetPollsCheckFloor, resetPollsWaiting, usePollsWaitingCheck } from '../pollsWaiting'
import { resetPollService } from '../usePolls'

const A = 'did:webvh:QmCommunityA:vtc.example.org'
const B = 'did:webvh:QmCommunityB:vtc.example.org'
const HOUR = 3600_000
const iso = (ms: number) => new Date(ms).toISOString()

// Built inside each test: jestSetup fixes Date.now() at 2024-01-01 there, while at module load it reads the real clock.
const listed = (electionId: string) => ({
  electionId,
  title: `Poll ${electionId}`,
  state: 'voting',
  votingOpensAt: iso(Date.now() - HOUR),
  votingClosesAt: iso(Date.now() + 100 * HOUR),
  binding: false,
  ticketHeld: false,
})

// Focus as a screen has it: once on mounting, with no blur after.
jest.mock('@react-navigation/native', () => {
  const ReactInMock = jest.requireActual('react')
  const base = jest.requireActual('../../../../__mocks__/@react-navigation/native')
  return {
    ...base,
    useFocusEffect: (callback: () => void | (() => void)) => ReactInMock.useEffect(callback, [callback]),
  }
})

const mockAgent = {
  genericRecords: { findById: jest.fn(async () => null), save: jest.fn(), update: jest.fn() },
} as unknown as Agent
jest.mock('@bifold/react-hooks', () => ({ useAgent: () => ({ agent: mockAgent }) }))

/** What each community answers to a list read; a community left out has not answered yet. */
const mockAnswers = new Map<string, () => Promise<Record<string, unknown>>>()
const mockAsked: string[] = []
const mockClock = { now: 0 }
const backend = (): PollsBackend =>
  ({
    communityTask: async (community: string) => {
      mockAsked.push(community)
      const answer = mockAnswers.get(community)
      return answer ? answer() : new Promise(() => undefined)
    },
    sendCompleted: async () => ({}),
    agentTask: async () => ({}),
    agentServedTypes: async () => undefined,
    // No agent: a ticket stops before anything is asked (`noAgent`), which is all a share needs to see.
    currentAgent: () => undefined,
    linkedAgents: () => [],
    voterTarget: async () => undefined,
    records: { get: async () => undefined, put: async () => undefined, list: async () => [] },
    door: {} as PollsBackend['door'],
    serially: (_key: string, work: () => Promise<unknown>) => work(),
    now: () => mockClock.now,
    random: () => 0.5,
    sleep: async () => undefined,
    warn: () => undefined,
  }) as unknown as PollsBackend
jest.mock('../agentPollsBackend', () => ({ createAgentPollsBackend: () => backend() }))

jest.mock('../../trust-tasks/module/vtaAgent', () => ({
  vtaAgent: { subscribe: () => () => undefined, getState: () => ({ link: { kind: 'linked' }, agents: [] }) },
}))
jest.mock('../../trust-tasks/module/VtiCommunityStore', () => ({
  isCurrentMembership: () => true,
  GenericRecordsCommunityStore: class {
    async listMemberships() {
      return [{ communityDid: A }, { communityDid: B }]
    }
  },
}))
jest.mock('../../rooms/useRoomOffersCount', () => ({ useRoomOffersWaiting: () => [] }))

const SHIPPED = { parallel: { ...POLLS_CHECK_PARALLEL }, shared: { ...POLLS_SHARED_READ } }
beforeEach(() => {
  resetPollService()
  resetPollsWaiting()
  resetPollsCheckFloor()
  mockAnswers.clear()
  mockAsked.length = 0
  mockClock.now = Date.now()
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true })
})
afterEach(() => {
  Object.assign(POLLS_CHECK_PARALLEL, SHIPPED.parallel)
  Object.assign(POLLS_SHARED_READ, SHIPPED.shared)
})

const id = (key: string) => testIdWithKey(key)
const Check: React.FC = () => {
  usePollsWaitingCheck()
  return null
}
const show = (screen: React.ReactElement) => render(<BasicAppContext>{screen}</BasicAppContext>)
const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  })

describe('the Waiting for you check', () => {
  test('ships with both switches on and no kill', () => {
    expect(SHIPPED).toEqual({ parallel: { on: true, remoteOff: false }, shared: { on: true, remoteOff: false } })
  })

  test("asks every community at once: B's card shows while A has not answered", async () => {
    mockAnswers.set(B, async () => ({ elections: [listed('b-open')] }))
    const tree = show(
      <>
        <Check />
        <WaitingForYou onOpenOffer={jest.fn()} onOpenPoll={jest.fn()} />
      </>
    )
    await waitFor(() => expect(tree.getByTestId(id(PollsIds.waitingCard))).toBeTruthy())
    expect(mockAsked).toEqual([A, B])
    tree.unmount()
  })

  test('a community that has not answered keeps the cards it showed while the others answer', async () => {
    publishPollsWaiting([{ communityDid: A, electionId: 'a-open', votingClosesAt: iso(Date.now() + 100 * HOUR) }])
    mockAnswers.set(B, async () => ({ elections: [listed('b-open')] }))
    const tree = show(
      <>
        <Check />
        <WaitingForYou onOpenOffer={jest.fn()} onOpenPoll={jest.fn()} />
      </>
    )
    await waitFor(() => expect(tree.getAllByTestId(id(PollsIds.waitingCard))).toHaveLength(2))
    tree.unmount()
  })

  test('off: one community after another, so A not answering holds back B (control)', async () => {
    POLLS_CHECK_PARALLEL.on = false
    mockAnswers.set(B, async () => ({ elections: [listed('b-open')] }))
    const tree = show(
      <>
        <Check />
        <WaitingForYou onOpenOffer={jest.fn()} onOpenPoll={jest.fn()} />
      </>
    )
    await waitFor(() => expect(mockAsked).toEqual([A]))
    await flush()
    expect(tree.queryByTestId(id(PollsIds.waitingCard))).toBeNull()
    expect(mockAsked).toEqual([A])
    tree.unmount()
  })

  test('the kill reads as off: A not answering holds back B again', async () => {
    POLLS_CHECK_PARALLEL.remoteOff = true
    mockAnswers.set(B, async () => ({ elections: [listed('b-open')] }))
    const tree = show(<Check />)
    await waitFor(() => expect(mockAsked).toEqual([A]))
    await flush()
    expect(mockAsked).toEqual([A])
    tree.unmount()
  })
})

describe("one read for the check and the community's page", () => {
  const both = () =>
    show(
      <>
        <Check />
        <CommunityPollsSection communityDid={B} />
      </>
    )

  test("the page's polls show from the check's read: B is asked once", async () => {
    mockAnswers.set(A, async () => ({ elections: [] }))
    mockAnswers.set(B, async () => ({ elections: [listed('b-open')] }))
    const tree = both()
    await waitFor(() => expect(tree.getByTestId(id(PollsIds.section))).toBeTruthy())
    await flush()
    expect(mockAsked.filter((c) => c === B)).toHaveLength(1)
    tree.unmount()
  })

  test.each([
    ['off: the check and the page each ask B (control)', { on: false, remoteOff: false }],
    ['the kill reads as off: each asks B', { on: true, remoteOff: true }],
  ])('%s', async (_name, value) => {
    Object.assign(POLLS_SHARED_READ, value)
    mockAnswers.set(A, async () => ({ elections: [] }))
    mockAnswers.set(B, async () => ({ elections: [listed('b-open')] }))
    const tree = both()
    await waitFor(() => expect(tree.getByTestId(id(PollsIds.section))).toBeTruthy())
    await flush()
    expect(mockAsked.filter((c) => c === B)).toHaveLength(2)
    tree.unmount()
  })
})

describe('what a shared read keeps', () => {
  const service = () => createPollService(backend())

  test('within the share one ask; past it, a new one; a filter is applied here', async () => {
    mockAnswers.set(B, async () => ({ elections: [listed('b-open'), { ...listed('b-closed'), state: 'closed' }] }))
    const s = service()
    expect((await s.readPolls(B)).map((p) => p.electionId)).toEqual(['b-open', 'b-closed'])
    mockClock.now += SHARED_READ_MS - 1
    expect((await s.readPolls(B, { state: 'voting' })).map((p) => p.electionId)).toEqual(['b-open'])
    expect(mockAsked).toEqual([B])
    mockClock.now += 1
    await s.readPolls(B)
    expect(mockAsked).toEqual([B, B])
  })

  test('a failed read is not kept: the next asks again', async () => {
    mockAnswers.set(B, async () => {
      throw new Error('offline')
    })
    const s = service()
    await expect(s.readPolls(B)).rejects.toThrow('offline')
    mockAnswers.set(B, async () => ({ elections: [] }))
    await s.readPolls(B)
    expect(mockAsked).toEqual([B, B])
  })

  test('a ticket there ends the share, even one that stops; elsewhere it does not (control)', async () => {
    mockAnswers.set(A, async () => ({ elections: [] }))
    mockAnswers.set(B, async () => ({ elections: [] }))
    const s = service()
    await s.readPolls(A)
    await s.readPolls(B)
    await expect(s.takeTicket(B, 'b-open')).rejects.toMatchObject({ reason: 'noAgent' })
    await s.readPolls(A)
    await s.readPolls(B)
    expect(mockAsked).toEqual([A, B, B])
  })
})
