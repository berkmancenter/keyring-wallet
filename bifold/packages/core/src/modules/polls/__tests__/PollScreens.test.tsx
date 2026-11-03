/**
 * The poll screens say what the approved mock and the plan require, in the order they require it: who runs the poll
 * and who sees what before the ticket, Get my ticket beside the line that goes with it; on the ballot, what's seen
 * sits with Cast my vote; a binding poll gets a check step; a question the screen can't show stops the cast rather
 * than abstaining it; and no screen after the vote says what the member chose.
 */
import { useRoute } from '@react-navigation/native'
import type { TFunction } from 'i18next'
import { fireEvent, render, waitFor, within } from '@testing-library/react-native'
import React from 'react'
import { ScrollView } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { PollsIds } from '../components/Polls.ids'
import type { PollRecord } from '../pollService'
import type { PollShown } from '../pollTasks'
import { pollRowStatus } from '../pollWords'
import Poll from '../screens/Poll'
import PollBallot from '../screens/PollBallot'

const COMMUNITY = 'did:webvh:QmCommunity:vtc.example.org'
const CHOICE = 'option-yes'

// React Native's jest setup reports a font scale of 2, which these screens read as large text. Default text is 1.
let mockFontScale = 1
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}))

const mockState: { shown?: PollShown; record?: PollRecord; readiness?: string; failed: boolean } = { failed: false }
const mockService = { takeTicket: jest.fn(), vote: jest.fn() }
jest.mock('../usePolls', () => ({
  usePollService: () => mockService,
  usePoll: () => ({ ...mockState, reload: jest.fn(async () => undefined) }),
}))

const shownWith = (over: Partial<PollShown['manifest']> = {}, disclosure: Partial<PollShown['disclosure']> = {}) =>
  ({
    manifest: {
      electionId: 'charter',
      community: COMMUNITY,
      title: 'Adopt the community charter?',
      questions: [
        {
          key: 'motion',
          type: 'choice',
          text: 'Adopt it?',
          options: [
            { key: CHOICE, text: 'Yes' },
            { key: 'option-no', text: 'No' },
          ],
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
      ...over,
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
      ...disclosure,
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

const id = (key: string) => testIdWithKey(key)

/** The testIDs under `node`, in the order they render. */
const idsIn = (node: unknown): string[] => {
  const order: string[] = []
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    const { props, children } = n as { props?: { testID?: string }; children?: unknown }
    if (props?.testID && !order.includes(props.testID)) order.push(props.testID)
    walk(children)
  }
  walk(node)
  return order
}

const certification = (over: Partial<NonNullable<PollShown['certified']>> = {}) => ({
  certifiedAt: '2099-11-09T10:14:00Z',
  result: {
    electionId: 'charter',
    manifestDigest: 'zQmDigest',
    ballotsCounted: 26,
    questions: [{ question: 'motion', abstained: 1, choice: { [CHOICE]: 12, 'option-no': 13 } }],
  },
  ...over,
})
const renderIn = (screen: React.ReactElement) => render(<BasicAppContext>{screen}</BasicAppContext>)

beforeEach(() => {
  ;(useRoute as jest.Mock).mockReturnValue({ params: { communityDid: COMMUNITY, electionId: 'charter' } })
  Object.assign(mockState, { shown: shownWith(), record: undefined, readiness: 'ready', failed: false })
  mockFontScale = 1
  mockService.takeTicket.mockReset()
  mockService.vote.mockReset()
})

describe('before the ticket', () => {
  test('who runs it and who sees what, with Get my ticket and its line', () => {
    const tree = renderIn(<Poll />)
    expect(tree.getByTestId(id(PollsIds.whoRunsIt))).toBeTruthy()
    expect(tree.getByText('Independent Ballots Ltd')).toBeTruthy()
    expect(tree.getByTestId(id(PollsIds.hostedAgent))).toBeTruthy()
    expect(tree.getByText('Polls.TicketLine')).toBeTruthy()
    expect(tree.getByTestId(id(PollsIds.getTicket))).toBeTruthy()
    expect(tree.queryByTestId(id(PollsIds.sameOperator))).toBeNull()
  })

  // A render at the largest text broke "Runs the community" inside a word in the side-by-side boxes.
  test('at 1.3 the two parties stack; just below, they sit side by side (control)', () => {
    const direction = () => {
      const style = renderIn(<Poll />).getByTestId(id(PollsIds.parties)).props.style
      return (Array.isArray(style) ? Object.assign({}, ...style) : style).flexDirection ?? 'column'
    }
    mockFontScale = Math.fround(1.3)
    expect(direction()).toBe('column')
    mockFontScale = 1.29
    expect(direction()).toBe('row')
  })

  test('one operator running both is warned of, with no tap', () => {
    mockState.shown = shownWith({}, { sameOperator: true })
    const tree = renderIn(<Poll />)
    expect(tree.getByTestId(id(PollsIds.sameOperator))).toBeTruthy()
  })

  test('a binding poll adds that the community counts memberships, not people', () => {
    mockState.shown = shownWith({ binding: true })
    expect(renderIn(<Poll />).getByText('Polls.CountsMemberships')).toBeTruthy()
  })

  test('an agent too old to vote is said so, and no ticket is offered', () => {
    mockState.readiness = 'tooOld'
    const tree = renderIn(<Poll />)
    expect(tree.getByTestId(id(PollsIds.needsUpdate))).toBeTruthy()
    expect(tree.queryByTestId(id(PollsIds.getTicket))).toBeNull()
  })

  test('Get my ticket asks for the ticket as the community the poll was reached through', () => {
    const tree = renderIn(<Poll />)
    fireEvent.press(tree.getByTestId(id(PollsIds.getTicket)))
    expect(mockService.takeTicket).toHaveBeenCalledWith(COMMUNITY, 'charter')
  })

  // A render at large text showed the ticket's screen opened scrolled past "You have your ticket".
  test('after the ticket the screen goes back to its top', async () => {
    const toTop = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => undefined)
    const tree = renderIn(<Poll />)
    fireEvent.press(tree.getByTestId(id(PollsIds.getTicket)))
    await waitFor(() => expect(toTop).toHaveBeenCalledWith({ y: 0, animated: false }))
    toTop.mockRestore()
  })
})

describe('after the ticket', () => {
  test('within the hour: the advice to vote later, and both buttons', () => {
    mockState.record = record({ ticketAt: Date.now() - 5 * 60_000 })
    const tree = renderIn(<Poll />)
    expect(tree.getByTestId(id(PollsIds.voteLaterAdvice))).toBeTruthy()
    expect(tree.getByTestId(id(PollsIds.voteNow))).toBeTruthy()
    expect(tree.getByTestId(id(PollsIds.voteLater))).toBeTruthy()
  })

  test('after the hour: no advice, Vote now alone', () => {
    mockState.record = record({ ticketAt: Date.now() - 2 * 3600_000 })
    const tree = renderIn(<Poll />)
    expect(tree.queryByTestId(id(PollsIds.voteLaterAdvice))).toBeNull()
    expect(tree.queryByTestId(id(PollsIds.voteLater))).toBeNull()
    expect(tree.queryByTestId(id(PollsIds.ticketTimeline))).toBeNull()
  })

  // Alberto's call on the V2 mock: Vote later is the main button, above Vote now.
  test('within the hour: Vote later comes first, then Vote now; the timeline and what Vote later keeps are shown', () => {
    mockState.record = record({ ticketAt: Date.now() - 5 * 60_000 })
    const tree = renderIn(<Poll />)
    const order = idsIn(tree.toJSON())
    expect(order.indexOf(id(PollsIds.voteLater))).toBeGreaterThan(-1)
    expect(order.indexOf(id(PollsIds.voteLater))).toBeLessThan(order.indexOf(id(PollsIds.voteNow)))
    expect(tree.getByTestId(id(PollsIds.ticketTimeline))).toBeTruthy()
    expect(tree.getByTestId(id(PollsIds.voteLaterKeeps))).toBeTruthy()
    expect(tree.getByText('Polls.SaferAfter')).toBeTruthy()
  })

  test('voted: the vote is in, and nothing says what was chosen', () => {
    mockState.record = record({ ticketAt: Date.now() - 3 * 3600_000, votedAt: Date.now() - 3600_000 })
    const tree = renderIn(<Poll />)
    expect(tree.getByTestId(id(PollsIds.voteIn))).toBeTruthy()
    expect(tree.queryByText('Yes')).toBeNull()
    expect(JSON.stringify(tree.toJSON())).not.toContain(CHOICE)
  })

  test('a vote on its way says so', () => {
    mockState.record = record({ ticketAt: 1, pending: { stage: 'receipt', receipt: {} } })
    expect(renderIn(<Poll />).getByTestId(id(PollsIds.sending))).toBeTruthy()
  })
})

describe('results', () => {
  test('once certified, the result shows first, and the member who voted reads only that they did', () => {
    mockState.shown = { ...shownWith(), state: 'tallied', certified: certification() } as PollShown
    mockState.record = record({ ticketAt: 1, votedAt: Date.now() - 3600_000 })
    const tree = renderIn(<Poll />)
    expect(tree.getByTestId(id(PollsIds.results))).toBeTruthy()
    expect(tree.queryByTestId(id(PollsIds.voteIn))).toBeNull()
    expect(within(tree.getByTestId(id(PollsIds.yourPart))).getByText('Polls.VotedOn')).toBeTruthy()
    expect(tree.getByText('Polls.CantShowYours')).toBeTruthy()
    // Most votes first; the counts carry it, not the member's choice.
    expect(within(tree.getAllByTestId(id(PollsIds.resultOption))[0]).getByText('No')).toBeTruthy()
    expect(tree.getByTestId(id(PollsIds.certifiedLine))).toBeTruthy()
  })

  test('voted, not yet certified: the vote is in, and no result (control for the result above)', () => {
    mockState.shown = { ...shownWith(), state: 'closed' } as PollShown
    mockState.record = record({ ticketAt: 1, votedAt: Date.now() - 3600_000 })
    const tree = renderIn(<Poll />)
    expect(tree.getByTestId(id(PollsIds.voteIn))).toBeTruthy()
    expect(tree.getByTestId(id(PollsIds.resultsNotReady))).toBeTruthy()
    expect(tree.queryByTestId(id(PollsIds.results))).toBeNull()
  })

  test('a later read that carries the certification switches the screen to the result, with nothing to tap', () => {
    mockState.shown = { ...shownWith(), state: 'closed' } as PollShown
    mockState.record = record({ ticketAt: 1, votedAt: Date.now() - 3600_000 })
    const tree = renderIn(<Poll />)
    expect(tree.queryByTestId(id(PollsIds.results))).toBeNull()
    mockState.shown = { ...shownWith(), state: 'tallied', certified: certification() } as PollShown
    tree.rerender(
      <BasicAppContext>
        <Poll />
      </BasicAppContext>
    )
    expect(tree.getByTestId(id(PollsIds.results))).toBeTruthy()
  })

  test("certified and the member didn't vote: the result, and that they didn't", () => {
    mockState.shown = { ...shownWith(), state: 'tallied', certified: certification() } as PollShown
    const tree = renderIn(<Poll />)
    expect(within(tree.getByTestId(id(PollsIds.yourPart))).getByText('Polls.DidntVote')).toBeTruthy()
    expect(tree.queryByText('Polls.CantShowYours')).toBeNull()
  })
})

describe('closed', () => {
  test('closed before its set time: Closed early, with no date', () => {
    mockState.shown = { ...shownWith(), state: 'closed' } as PollShown
    const tree = renderIn(<Poll />)
    expect(tree.getByTestId(id(PollsIds.closedEarly))).toBeTruthy()
    expect(tree.getByText('Polls.ClosedEarly')).toBeTruthy()
    expect(tree.queryByText('Polls.ClosedOn')).toBeNull()
  })

  test('closed past its set time: Closed, with no date and not Closed early (control)', () => {
    mockState.shown = { ...shownWith({ votingClosesAt: '2023-12-20T00:00:00Z' }), state: 'closed' } as PollShown
    const tree = renderIn(<Poll />)
    expect(tree.queryByTestId(id(PollsIds.closedEarly))).toBeNull()
    expect(tree.getByText('Polls.ClosedNoDate')).toBeTruthy()
    expect(tree.queryByText('Polls.ClosedOn')).toBeNull()
  })
})

describe('the ballot', () => {
  beforeEach(() => {
    mockState.record = record({ ticketAt: Date.now() - 2 * 3600_000 })
  })

  test("what's seen sits with Cast my vote, which waits for an answer", () => {
    const tree = renderIn(<PollBallot />)
    expect(tree.getByTestId(id(PollsIds.boardLine))).toBeTruthy()
    expect(tree.getByTestId(id(PollsIds.seenLine))).toBeTruthy()
    const cast = tree.getByTestId(id(PollsIds.cast))
    expect(cast.props.accessibilityState?.disabled).toBe(true)
    fireEvent.press(tree.getAllByTestId(id(PollsIds.option))[0])
    expect(tree.getByTestId(id(PollsIds.cast)).props.accessibilityState?.disabled).toBe(false)
  })

  test('Details adds that whoever hosts the agent can see the choice', () => {
    const tree = renderIn(<PollBallot />)
    expect(tree.queryByText('Polls.SeesAgent')).toBeNull()
    fireEvent.press(tree.getByTestId(id(PollsIds.details)))
    expect(tree.getByText('Polls.SeesAgent')).toBeTruthy()
  })

  // A render showed the open details filling a fixed bar until the choices were a sliver above it.
  test('with Details open the bar goes to the end of the scroll, after the questions', () => {
    const tree = renderIn(<PollBallot />)
    const scroll = () => within(tree.getByTestId(id(PollsIds.ballotScreen)))
    expect(scroll().queryByTestId(id(PollsIds.cast))).toBeNull()
    fireEvent.press(tree.getByTestId(id(PollsIds.details)))
    expect(scroll().getByText('Polls.SeesAgent')).toBeTruthy()
    expect(scroll().getByTestId(id(PollsIds.cast))).toBeTruthy()
  })

  // A render showed the check step opened scrolled past the choice it exists to show, with Details left open.
  test('opening Details scrolls to the lines once; the check step never scrolls past the choice', () => {
    const toEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd').mockImplementation(() => undefined)
    const toTop = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => undefined)
    mockState.shown = shownWith({ binding: true })
    const tree = renderIn(<PollBallot />)
    const grow = () => fireEvent(tree.getByTestId(id(PollsIds.ballotScreen)), 'contentSizeChange', 390, 2000)
    fireEvent.press(tree.getByTestId(id(PollsIds.details)))
    grow()
    expect(toEnd).toHaveBeenCalledTimes(1)
    fireEvent.press(tree.getAllByTestId(id(PollsIds.option))[0])
    fireEvent.press(tree.getByTestId(id(PollsIds.cast)))
    expect(tree.getByTestId(id(PollsIds.check))).toBeTruthy()
    expect(toTop).toHaveBeenCalledWith({ y: 0, animated: false })
    grow()
    expect(toEnd).toHaveBeenCalledTimes(1)
    toEnd.mockRestore()
    toTop.mockRestore()
  })

  // At Android's largest font (1.3) a fixed bar covered the second and third choices while Cast showed.
  test('at 1.3 the ballot is one page: choices, then the lines, then Cast; just below 1.3 the bar stays fixed', () => {
    // What Android reports for its 1.3 setting: a 32-bit float just under 1.3 (a render showed the bar still fixed).
    mockFontScale = Math.fround(1.3)
    const tree = renderIn(<PollBallot />)
    const order: string[] = []
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) return node.forEach(walk)
      const { props, children } = node as { props?: { testID?: string }; children?: unknown }
      if (props?.testID && !order.includes(props.testID)) order.push(props.testID)
      walk(children)
    }
    walk(tree.getByTestId(id(PollsIds.ballotScreen)))
    const at = (key: string) => order.indexOf(id(key))
    expect(at(PollsIds.cast)).toBeGreaterThan(-1)
    expect(at(PollsIds.option)).toBeLessThan(at(PollsIds.boardLine))
    expect(at(PollsIds.boardLine)).toBeLessThan(at(PollsIds.seenLine))
    expect(order.slice(at(PollsIds.seenLine) + 1, at(PollsIds.cast))).not.toContain(id(PollsIds.option))
    expect(at(PollsIds.cast)).toBe(order.length - 1)

    mockFontScale = 1.29
    const fixed = renderIn(<PollBallot />)
    expect(within(fixed.getByTestId(id(PollsIds.ballotScreen))).queryByTestId(id(PollsIds.cast))).toBeNull()
  })

  test('within the hour after the ticket, the ballot says a vote this soon could be paired', () => {
    mockState.record = record({ ticketAt: Date.now() - 10 * 60_000 })
    expect(renderIn(<PollBallot />).getByTestId(id(PollsIds.firstHour))).toBeTruthy()
  })

  test('an open poll casts at once; a binding one shows the check step first', () => {
    const tree = renderIn(<PollBallot />)
    fireEvent.press(tree.getAllByTestId(id(PollsIds.option))[0])
    fireEvent.press(tree.getByTestId(id(PollsIds.cast)))
    expect(mockService.vote).toHaveBeenCalledWith(
      COMMUNITY,
      'charter',
      { motion: { choice: [CHOICE] } },
      expect.any(Function)
    )

    mockService.vote.mockReset()
    mockState.shown = shownWith({ binding: true })
    const binding = renderIn(<PollBallot />)
    fireEvent.press(binding.getAllByTestId(id(PollsIds.option))[0])
    fireEvent.press(binding.getByTestId(id(PollsIds.cast)))
    expect(mockService.vote).not.toHaveBeenCalled()
    expect(binding.getByTestId(id(PollsIds.check))).toBeTruthy()
    // "Before it goes" heads the lines it introduces, in the bar, not the scroll above it (a render showed it alone).
    const scrolled = within(binding.getByTestId(id(PollsIds.ballotScreen)))
    expect(binding.getByTestId(id(PollsIds.beforeItGoes))).toBeTruthy()
    expect(scrolled.queryByTestId(id(PollsIds.beforeItGoes))).toBeNull()
    fireEvent.press(binding.getByTestId(id(PollsIds.cast)))
    expect(mockService.vote).toHaveBeenCalled()
  })

  test('casting shows each step as the vote reaches it: in the pause, ready is done and the pause shows its progress', async () => {
    mockService.vote.mockImplementation((_c: string, _e: string, _g: unknown, onStep: (s: unknown) => void) => {
      onStep({ step: 'ready' })
      onStep({ step: 'pause', from: Date.now(), until: Date.now() + 10_000 })
      return new Promise(() => undefined)
    })
    const tree = renderIn(<PollBallot />)
    fireEvent.press(tree.getAllByTestId(id(PollsIds.option))[0])
    fireEvent.press(tree.getByTestId(id(PollsIds.cast)))
    await waitFor(() => expect(tree.getByTestId(id(PollsIds.pauseBar))).toBeTruthy())
    expect(tree.getAllByTestId(id(`${PollsIds.castStep}_done`))).toHaveLength(1)
    expect(tree.getAllByTestId(id(`${PollsIds.castStep}_now`))).toHaveLength(1)
    expect(tree.getAllByTestId(id(`${PollsIds.castStep}_later`))).toHaveLength(2)
    tree.unmount()
  })

  test('once sending, the pause is done and its bar gone (control for the step above)', async () => {
    mockService.vote.mockImplementation((_c: string, _e: string, _g: unknown, onStep: (s: unknown) => void) => {
      onStep({ step: 'sending' })
      return new Promise(() => undefined)
    })
    const tree = renderIn(<PollBallot />)
    fireEvent.press(tree.getAllByTestId(id(PollsIds.option))[0])
    fireEvent.press(tree.getByTestId(id(PollsIds.cast)))
    await waitFor(() => expect(tree.getAllByTestId(id(`${PollsIds.castStep}_done`))).toHaveLength(2))
    expect(tree.queryByTestId(id(PollsIds.pauseBar))).toBeNull()
    tree.unmount()
  })

  test("a question this screen can't show stops the cast, never abstains it", () => {
    mockState.shown = shownWith({
      questions: [
        { key: 'order', type: 'ranking', options: [{ key: 'a' }, { key: 'b' }], partial: false, optional: true },
      ],
    })
    const tree = renderIn(<PollBallot />)
    expect(tree.getByTestId(id(PollsIds.cantShow))).toBeTruthy()
    expect(tree.getByTestId(id(PollsIds.cast)).props.accessibilityState?.disabled).toBe(true)
  })
})

// A community closed a poll before its scheduled close, and the row said "Closed on <the scheduled date>", still ahead.
describe('a poll closed early', () => {
  const t = ((key: string) => key) as unknown as TFunction
  const listed = (votingClosesAt: string) => ({
    electionId: 'charter',
    state: 'closed' as const,
    votingOpensAt: '2023-12-01T00:00:00Z',
    votingClosesAt,
    binding: false,
    ticketHeld: false,
  })

  test('the row says closed early while that can be told, and never the date it was due to close', () => {
    expect(pollRowStatus(t, listed('2099-11-08T17:00:00Z'), undefined, Date.now())).toBe('Polls.ClosedEarly')
    // Past its set time an early close reads like an on-time one, so neither gets a date.
    expect(pollRowStatus(t, listed('2023-12-08T17:00:00Z'), undefined, Date.now())).toBe('Polls.ClosedNoDate')
  })

  // "Closed early" says how the community ran its poll; a phone clock a little slow must not say it.
  test('a close within a minute of the set time is not called early', () => {
    const inThirtySeconds = new Date(Date.now() + 30_000).toISOString()
    expect(pollRowStatus(t, listed(inThirtySeconds), undefined, Date.now())).toBe('Polls.ClosedNoDate')
  })

  test('the poll screen says closed early, with no date', () => {
    mockState.shown = { ...shownWith(), state: 'closed' }
    const tree = renderIn(<Poll />)
    expect(tree.getByTestId(id(PollsIds.closedEarly))).toBeTruthy()
    expect(tree.queryByText('Polls.ClosedOn')).toBeNull()
  })

  // Results are certified after the close, often after the date it was due to close: compare the certification, not now.
  test('the results say closed early when they were certified before the set close, even once that date has passed', () => {
    const manifest = shownWith({ votingClosesAt: '2023-12-20T00:00:00Z' }).manifest
    const certified = (certifiedAt: string) => ({
      certifiedAt,
      result: { electionId: 'charter', manifestDigest: 'zQmDigest', ballotsCounted: 3, questions: [] },
    })
    // In V2 the close line heads the poll, above its result (it was in the result's card).
    const head = (certifiedAt: string) => {
      mockState.shown = { ...shownWith(), manifest, state: 'tallied', certified: certified(certifiedAt) } as PollShown
      return within(renderIn(<Poll />).getByTestId(id(PollsIds.head)))
    }
    expect(head('2023-12-15T00:00:00Z').getByText(/Polls\.ClosedEarly/)).toBeTruthy()
    const onTime = head('2023-12-21T00:00:00Z')
    expect(onTime.queryByText(/Polls\.ClosedEarly/)).toBeNull()
    expect(onTime.getByText(/Polls\.ClosedNoDate/)).toBeTruthy()
  })
})
