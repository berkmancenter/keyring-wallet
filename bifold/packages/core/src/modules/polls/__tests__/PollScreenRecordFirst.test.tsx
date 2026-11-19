/**
 * The poll screen through its real hook (`usePoll`), the service faked: after a ticket, and on coming back after a
 * vote, the screen shows what this phone now holds at once, not the step before ("Get my ticket", "Vote now") for as
 * long as the poll takes to be read again. A refused ticket still leaves Get my ticket (control), and a read overtaken
 * by a later one is never shown.
 */
import { useRoute } from '@react-navigation/native'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { PollsIds } from '../components/Polls.ids'
import { PollRefusal, type PollRecord } from '../pollService'
import type { PollShown } from '../pollTasks'
import Poll from '../screens/Poll'

const COMMUNITY = 'did:webvh:QmCommunity:vtc.example.org'

// React Native's jest setup reports a font scale of 2, which these screens read as large text. Default text is 1.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}))

// Focus as a screen has it: once on mounting, again on each return (`refocus`), with no blur in between.
const mockFocus = new Set<() => void>()
jest.mock('@react-navigation/native', () => {
  const ReactInMock = jest.requireActual('react')
  const base = jest.requireActual('../../../../__mocks__/@react-navigation/native')
  return {
    ...base,
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactInMock.useEffect(() => {
        mockFocus.add(callback)
        const cleanup = callback()
        return () => {
          mockFocus.delete(callback)
          if (typeof cleanup === 'function') cleanup()
        }
      }, [callback])
    },
  }
})
const refocus = () => act(() => mockFocus.forEach((callback) => callback()))

const mockAgent = {}
jest.mock('@bifold/react-hooks', () => ({ useAgent: () => ({ agent: mockAgent }) }))
jest.mock('../agentPollsBackend', () => ({ createAgentPollsBackend: () => ({}) }))

/** This phone's record of the poll, as the store holds it now. */
const mockStore: { record?: PollRecord } = {}
const mockService = {
  readPoll: jest.fn(),
  record: jest.fn(async () => mockStore.record),
  agentReadiness: jest.fn(async () => 'ready'),
  takeTicket: jest.fn(),
  vote: jest.fn(),
  resumePending: jest.fn(async () => undefined),
}
jest.mock('../pollService', () => ({
  ...jest.requireActual('../pollService'),
  createPollService: () => mockService,
}))

const shown = (title = 'Adopt the community charter?') =>
  ({
    manifest: {
      electionId: 'charter',
      community: COMMUNITY,
      title,
      questions: [
        {
          key: 'motion',
          type: 'choice',
          text: 'Adopt it?',
          options: [{ key: 'option-yes', text: 'Yes' }],
          minSelections: 1,
          maxSelections: 1,
          optional: false,
        },
      ],
      secrecy: 'open',
      roll: { rule: 'members' },
      // jestSetup fixes Date.now() at 2024-01-01, so the poll opened before that.
      registrationOpensAt: '2023-12-01T00:00:00Z',
      votingOpensAt: '2023-12-01T00:00:00Z',
      votingClosesAt: '2099-11-08T17:00:00Z',
      revote: 'refuse',
      board: { visibility: 'public', auditors: [] },
      ballotBox: 'did:webvh:QmVote:vote.example.net',
      binding: false,
      allowEarlyClose: true,
      resultsBeforeClose: false,
      textReleaseThreshold: 10,
    },
    manifestDigest: 'zQmDigest',
    state: 'voting',
    parameters: { suite: 'ps-ddh-bls12381', votingKey: 'z6Mkkey' },
    disclosure: {
      ballotBox: 'did:webvh:QmVote:vote.example.net',
      ballotBoxOperator: 'Independent Ballots Ltd',
      sameOperator: false,
      boardVisibility: 'public',
      auditors: [],
      revote: 'refuse',
      coercionResistance: false,
    },
  }) as PollShown

const record = (over: Partial<PollRecord> = {}): PollRecord => ({
  community: COMMUNITY,
  electionId: 'charter',
  via: COMMUNITY,
  member: 'did:webvh:QmPersona:p',
  agent: 'did:webvh:QmAgent:a',
  ticketRequestedAt: Date.now() - 2 * 3600_000,
  ...over,
})

/** A read still on its way: the community has not answered yet. */
const never = () => new Promise<PollShown>(() => undefined)

const id = (key: string) => testIdWithKey(key)
const mount = async () => {
  const tree = render(
    <BasicAppContext>
      <Poll />
    </BasicAppContext>
  )
  await waitFor(() => expect(tree.getByTestId(id(PollsIds.title))).toBeTruthy())
  return tree
}

beforeEach(() => {
  ;(useRoute as jest.Mock).mockReturnValue({ params: { communityDid: COMMUNITY, electionId: 'charter' } })
  mockFocus.clear()
  mockStore.record = undefined
  mockService.readPoll.mockReset().mockResolvedValueOnce(shown()).mockImplementation(never)
  mockService.record.mockReset().mockImplementation(async () => mockStore.record)
  mockService.takeTicket.mockReset()
})

describe('after a ticket', () => {
  test('the ticket shows as soon as it is held, while the poll is still being read again', async () => {
    const tree = await mount()
    const held = record({ ticketAt: Date.now() - 60_000 })
    mockService.takeTicket.mockImplementation(async () => {
      mockStore.record = held
      return held
    })
    fireEvent.press(tree.getByTestId(id(PollsIds.getTicket)))
    await waitFor(() => expect(tree.getByTestId(id(PollsIds.ticketHeld))).toBeTruthy())
    expect(tree.queryByTestId(id(PollsIds.getTicket))).toBeNull()
    // The read behind it is still on its way: what shows came from the ticket, not from a new read.
    expect(mockService.readPoll).toHaveBeenCalledTimes(2)
  })

  test("the ticket shows from the ticket's own answer, before this phone's store is read again", async () => {
    const tree = await mount()
    const held = record({ ticketAt: Date.now() - 60_000 })
    mockService.takeTicket.mockResolvedValue(held)
    // The store is slow to answer the read behind the ticket.
    mockService.record.mockImplementation(() => new Promise<PollRecord | undefined>(() => undefined))
    fireEvent.press(tree.getByTestId(id(PollsIds.getTicket)))
    await waitFor(() => expect(tree.getByTestId(id(PollsIds.ticketHeld))).toBeTruthy())
    expect(tree.queryByTestId(id(PollsIds.getTicket))).toBeNull()
  })

  test('a refused ticket leaves Get my ticket while the poll is read again (control: nothing is shown as held)', async () => {
    const tree = await mount()
    mockService.takeTicket.mockRejectedValue(new PollRefusal('refused'))
    fireEvent.press(tree.getByTestId(id(PollsIds.getTicket)))
    await waitFor(() => expect(mockService.readPoll).toHaveBeenCalledTimes(2))
    expect(tree.getByTestId(id(PollsIds.getTicket))).toBeTruthy()
    expect(tree.queryByTestId(id(PollsIds.ticketHeld))).toBeNull()
  })
})

describe('coming back after a vote', () => {
  test('the vote shows on its way at once, with Vote now gone, while the poll is read again', async () => {
    mockStore.record = record({ ticketAt: Date.now() - 2 * 3600_000 })
    const tree = await mount()
    expect(tree.getByTestId(id(PollsIds.voteNow))).toBeTruthy()
    // The ballot stored the cast and went back: the store holds the vote on its way.
    mockStore.record = record({ ticketAt: Date.now() - 2 * 3600_000, pending: { stage: 'receipt', receipt: {} } })
    await refocus()
    await waitFor(() => expect(tree.getByTestId(id(PollsIds.sending))).toBeTruthy())
    expect(tree.queryByTestId(id(PollsIds.voteNow))).toBeNull()
  })

  test('with nothing new on this phone, coming back shows the same step (control)', async () => {
    mockStore.record = record({ ticketAt: Date.now() - 2 * 3600_000 })
    const tree = await mount()
    await refocus()
    await waitFor(() => expect(mockService.record).toHaveBeenCalledTimes(3))
    expect(tree.getByTestId(id(PollsIds.voteNow))).toBeTruthy()
    expect(tree.queryByTestId(id(PollsIds.sending))).toBeNull()
  })
})

describe('reads that cross', () => {
  test('a read overtaken by a later one is dropped when it answers', async () => {
    const tree = await mount()
    let answerLate: (s: PollShown) => void = () => undefined
    mockService.readPoll.mockImplementationOnce(() => new Promise<PollShown>((resolve) => (answerLate = resolve)))
    await refocus()
    // A later read starts (a second return) before the first answers.
    await refocus()
    await act(async () => answerLate(shown('An older read')))
    expect(tree.queryByText('An older read')).toBeNull()
    expect(tree.getByText('Adopt the community charter?')).toBeTruthy()
  })
})
