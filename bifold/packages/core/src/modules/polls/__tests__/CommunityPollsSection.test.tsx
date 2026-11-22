/**
 * The community's poll list (Polls V2 mock, board 1): an open poll the member hasn't voted in is a card of its own,
 * the rest are rows with a chip; a poll the community certifies shows Results on the next read; one closed before its
 * set time says so with no date. No row says what the member chose.
 */
import { render, within } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { CommunityPollsSection } from '../components/CommunityPollsSection'
import { PollsIds } from '../components/Polls.ids'
import type { PollRecord } from '../pollService'
import type { PollListItem } from '../pollTasks'
import type { CommunityPoll } from '../usePolls'

const COMMUNITY = 'did:webvh:QmCommunity:vtc.example.org'

const mockPolls: { polls?: CommunityPoll[] } = {}
jest.mock('../usePolls', () => ({
  useCommunityPolls: () => ({ polls: mockPolls.polls, failed: false }),
}))

// jestSetup fixes Date.now() at 2024-01-01.
const poll = (over: Partial<PollListItem> = {}): PollListItem => ({
  electionId: 'charter',
  title: 'Adopt the charter?',
  state: 'voting',
  votingOpensAt: '2023-12-01T00:00:00Z',
  votingClosesAt: '2024-01-07T09:00:00Z',
  binding: false,
  ticketHeld: false,
  ...over,
})

const record = (over: Partial<PollRecord> = {}): PollRecord => ({
  community: COMMUNITY,
  electionId: 'charter',
  via: COMMUNITY,
  member: 'did:webvh:QmPersona:p',
  agent: 'did:webvh:QmAgent:a',
  ticketRequestedAt: 1,
  ...over,
})

const id = (key: string) => testIdWithKey(key)
const show = () =>
  render(
    <BasicAppContext>
      <CommunityPollsSection communityDid={COMMUNITY} />
    </BasicAppContext>
  )

beforeEach(() => {
  mockPolls.polls = undefined
})

describe('the list', () => {
  test('an open poll the member has not voted in is a card: Open, the days left, a time bar, Take part', () => {
    mockPolls.polls = [{ poll: poll() }]
    const tree = show()
    expect(within(tree.getByTestId(id(PollsIds.rowChip))).getByText('Polls.OpenChip')).toBeTruthy()
    expect(tree.getByText('Polls.DaysLeft')).toBeTruthy()
    expect(tree.getByTestId(id(PollsIds.rowTimeBar))).toBeTruthy()
    expect(tree.getByText('Polls.TakePart ›')).toBeTruthy()
    expect(tree.getByTestId(id(PollsIds.waiting))).toBeTruthy()
  })

  test('holding a ticket: Ticket ready, and Vote now', () => {
    mockPolls.polls = [{ poll: poll(), record: record({ ticketAt: Date.now() - 60_000 }) }]
    const tree = show()
    expect(tree.getByText('Polls.TicketReady')).toBeTruthy()
    expect(tree.getByText('Polls.VoteNow ›')).toBeTruthy()
  })

  test('voted in an open poll: a row, You voted, and when the results come; no time bar, nothing waiting', () => {
    mockPolls.polls = [{ poll: poll(), record: record({ ticketAt: 1, votedAt: Date.now() - 60_000 }) }]
    const tree = show()
    expect(within(tree.getByTestId(id(PollsIds.rowChip))).getByText('Polls.YouVoted')).toBeTruthy()
    expect(tree.getByText('Polls.ResultsOn')).toBeTruthy()
    expect(tree.queryByTestId(id(PollsIds.rowTimeBar))).toBeNull()
    expect(tree.queryByTestId(id(PollsIds.waiting))).toBeNull()
  })

  test('closed before its set time: Closed early, counting, and no date', () => {
    mockPolls.polls = [{ poll: poll({ state: 'closed' }) }]
    const tree = show()
    expect(within(tree.getByTestId(id(PollsIds.rowChip))).getByText('Polls.ClosedEarly')).toBeTruthy()
    expect(tree.getByText('Polls.Counting')).toBeTruthy()
    expect(tree.queryByText('Polls.ClosedOn')).toBeNull()
  })

  test('closed past its set time: Closed, not Closed early, and no date (control)', () => {
    mockPolls.polls = [{ poll: poll({ state: 'closed', votingClosesAt: '2023-12-20T00:00:00Z' }) }]
    const tree = show()
    expect(within(tree.getByTestId(id(PollsIds.rowChip))).getByText('Polls.ClosedNoDate')).toBeTruthy()
    expect(tree.queryByText('Polls.ClosedOn')).toBeNull()
  })

  test('a later read that finds the poll certified shows Results, voted or not, with nothing to tap', () => {
    mockPolls.polls = [{ poll: poll({ state: 'closed' }), record: record({ ticketAt: 1, votedAt: 2 }) }]
    const tree = show()
    expect(tree.queryByText('Polls.Results')).toBeNull()
    mockPolls.polls = [{ poll: poll({ state: 'tallied' }), record: record({ ticketAt: 1, votedAt: 2 }) }]
    tree.rerender(
      <BasicAppContext>
        <CommunityPollsSection communityDid={COMMUNITY} />
      </BasicAppContext>
    )
    expect(within(tree.getByTestId(id(PollsIds.rowChip))).getByText('Polls.Results')).toBeTruthy()
    expect(tree.getByText('Polls.YouVoted')).toBeTruthy()
  })

  test('a community that lists no polls shows nothing', () => {
    mockPolls.polls = []
    expect(show().queryByTestId(id(PollsIds.section))).toBeNull()
  })
})
