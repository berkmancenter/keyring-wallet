/**
 * Waiting for you on Messages: room offers and polls in one stack, soonest first by each one's date with undated
 * offers last, two cards and then a count, a poll card that names the community and its close but never the question,
 * and Not now saying whether the card comes back.
 */
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native'
import React from 'react'
import Toast from 'react-native-toast-message'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { PollsIds } from '../../../modules/polls/components/Polls.ids'
import type { PollWaiting } from '../../../modules/polls/pollsWaiting'
import type { RoomOffer } from '../../../modules/rooms/types'
import { testIdWithKey } from '../../../utils/testable'
import { WaitingForYou, waitingOrder, type WaitingItem } from '../WaitingForYou'

const A = 'did:webvh:QmCommunityA:vtc.example.org'
const NOW = Date.now()
const iso = (ms: number) => new Date(ms).toISOString()
const DAY = 24 * 3600_000

const poll = (electionId: string, closesInDays: number): PollWaiting => ({
  communityDid: A,
  electionId,
  votingClosesAt: iso(NOW + closesInDays * DAY),
})
const offer = (offerId: string, endsInDays?: number) =>
  ({
    offerId,
    roomId: offerId,
    roomName: `Room ${offerId}`,
    communityDid: A,
    communityName: 'First VTC',
    tier: 'basic',
    verbs: [],
    ...(endsInDays !== undefined ? { validUntil: iso(NOW + endsInDays * DAY) } : {}),
  }) as unknown as RoomOffer

const mockState: { polls: PollWaiting[]; offers: RoomOffer[] } = { polls: [], offers: [] }
const mockHide = jest.fn()
jest.mock('../../../modules/polls/pollsWaiting', () => ({
  usePollsWaiting: () => mockState.polls,
  dropVotedPolls: jest.fn(async () => undefined),
  hidePollCard: (...args: unknown[]) => mockHide(...args),
}))
jest.mock('../../../modules/rooms/useRoomOffersCount', () => ({ useRoomOffersWaiting: () => mockState.offers }))
jest.mock('../../../modules/polls/usePolls', () => ({ usePollService: () => ({}) }))
const mockAgent = {}
jest.mock('@bifold/react-hooks', () => ({ useAgent: () => ({ agent: mockAgent }) }))

const id = (key: string) => testIdWithKey(key)
const show = () =>
  render(
    <BasicAppContext>
      <WaitingForYou onOpenOffer={jest.fn()} onOpenPoll={jest.fn()} />
    </BasicAppContext>
  )

beforeEach(() => {
  mockState.polls = []
  mockState.offers = []
  mockHide.mockReset()
  jest.spyOn(Toast, 'show').mockImplementation(() => undefined)
})

describe('the order', () => {
  test('soonest first by date, a poll by its close and an offer by its room’s end; undated offers last, as they came', () => {
    const items: WaitingItem[] = [
      { kind: 'offer', offer: offer('undated-1') },
      { kind: 'poll', poll: poll('in-9', 9) },
      { kind: 'offer', offer: offer('ends-60', 60) },
      { kind: 'offer', offer: offer('undated-2') },
      { kind: 'poll', poll: poll('in-1', 1) },
    ]
    const names = waitingOrder(items).map((i) => (i.kind === 'poll' ? i.poll.electionId : i.offer.offerId))
    expect(names).toEqual(['in-1', 'in-9', 'ends-60', 'undated-1', 'undated-2'])
  })

  test('a room ending sooner than a poll closes leads it (control: the date decides, not the kind)', () => {
    const names = waitingOrder([
      { kind: 'poll', poll: poll('in-9', 9) },
      { kind: 'offer', offer: offer('ends-2', 2) },
    ]).map((i) => (i.kind === 'poll' ? i.poll.electionId : i.offer.offerId))
    expect(names).toEqual(['ends-2', 'in-9'])
  })
})

describe('the stack', () => {
  test('two cards, then how many more; tapped, all of them and Show fewer', () => {
    mockState.polls = [poll('a', 1), poll('b', 2)]
    mockState.offers = [offer('x'), offer('y')]
    const tree = show()
    const cards = () =>
      tree.queryAllByTestId(id(PollsIds.waitingCard)).length + tree.queryAllByTestId(id('RoomOfferCard')).length
    expect(cards()).toBe(2)
    expect(tree.getByTestId(id(PollsIds.waitingFold))).toHaveTextContent(/Polls\.WaitingMore/)
    fireEvent.press(tree.getByTestId(id(PollsIds.waitingFold)))
    expect(cards()).toBe(4)
    expect(tree.getByTestId(id(PollsIds.waitingFold))).toHaveTextContent(/Polls\.WaitingShowFewer/)
  })

  test('two waiting: both cards and no count (control)', () => {
    mockState.polls = [poll('a', 1)]
    mockState.offers = [offer('x')]
    const tree = show()
    expect(tree.queryByTestId(id(PollsIds.waitingFold))).toBeNull()
  })

  test('nothing waiting: nothing at all', () => {
    expect(show().queryByTestId(id(PollsIds.waitingStack))).toBeNull()
  })

  test('a poll card names the community and its close, never the question', () => {
    mockState.polls = [poll('a', 3)]
    const tree = show()
    const card = within(tree.getByTestId(id(PollsIds.waitingCard)))
    expect(card.getByTestId(id(PollsIds.waitingCardTitle))).toHaveTextContent(/Polls\.CardTitle/)
    expect(card.getByText('Polls.CardCloses')).toBeTruthy()
    // PollWaiting carries no title or question at all; the card has nothing else to show.
    expect(Object.keys(mockState.polls[0]).sort()).toEqual(['communityDid', 'electionId', 'votingClosesAt'])
  })

  test('Not now hides it and says it comes back once, with a tap to undo', async () => {
    const undo = jest.fn(async () => undefined)
    mockHide.mockResolvedValue({ comesBack: true, undo })
    mockState.polls = [poll('a', 3)]
    const tree = show()
    await act(async () => fireEvent.press(tree.getByTestId(id(PollsIds.waitingCardNotNow))))
    expect(mockHide).toHaveBeenCalledWith(expect.anything(), mockState.polls[0])
    await waitFor(() =>
      expect(Toast.show).toHaveBeenCalledWith(
        expect.objectContaining({ text1: 'Polls.CardHidden', text2: 'Polls.CardTapToUndo' })
      )
    )
    const shown = (Toast.show as jest.Mock).mock.calls[0][0] as { onPress: () => void }
    await act(async () => shown.onPress())
    expect(undo).toHaveBeenCalled()
  })

  test('the second Not now says it stays hidden until the close (control for the first)', async () => {
    mockHide.mockResolvedValue({ comesBack: false, undo: jest.fn() })
    mockState.polls = [poll('a', 3)]
    const tree = show()
    await act(async () => fireEvent.press(tree.getByTestId(id(PollsIds.waitingCardNotNow))))
    await waitFor(() =>
      expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Polls.CardHiddenUntilClose' }))
    )
  })
})
