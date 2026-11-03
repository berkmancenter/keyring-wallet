/**
 * The polls waiting for the member: which ones count, how Not now hides one and brings it back once at a random time
 * before its close, what is kept (never the question), and when the check asks: on opening, on coming back to the
 * foreground and hourly, never in the background and never on a screen's focus.
 */
import type { Agent } from '@credo-ts/core'
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import {
  POLLS_CHECK_MS,
  dropVotedPolls,
  findPollsWaiting,
  hideOnce,
  hidePollCard,
  isHidden,
  loadHiddenPolls,
  publishPollsWaiting,
  resetPollsCheckFloor,
  resetPollsWaiting,
  returnTime,
  usePollsWaiting,
  usePollsWaitingCheck,
  type PollWaiting,
} from '../pollsWaiting'

const A = 'did:webvh:QmCommunityA:vtc.example.org'
const B = 'did:webvh:QmCommunityB:vtc.example.org'
const HOUR = 3600_000
// jestSetup fixes Date.now() at 2024-01-01.
const NOW = Date.now()
const iso = (ms: number) => new Date(ms).toISOString()
const QUESTION = 'Should we merge with the other community?'

const listed = (electionId: string, over: Record<string, unknown> = {}) => ({
  electionId,
  title: QUESTION,
  state: 'voting',
  votingOpensAt: iso(NOW - HOUR),
  votingClosesAt: iso(NOW + 100 * HOUR),
  binding: false,
  ticketHeld: false,
  ...over,
})

const waitingOn = (electionId: string, closesIn = 100 * HOUR): PollWaiting => ({
  communityDid: A,
  electionId,
  votingClosesAt: iso(NOW + closesIn),
})

/** The agent's generic records, as this module uses them. It has no delete: hiding never deletes. */
function fakeAgent() {
  const records = new Map<string, { id: string; content: Record<string, unknown>; tags: Record<string, unknown> }>()
  const genericRecords = {
    findById: jest.fn(async (id: string) => records.get(id) ?? null),
    save: jest.fn(async (r: { id: string; content: Record<string, unknown>; tags: Record<string, unknown> }) => {
      records.set(r.id, { ...r })
    }),
    update: jest.fn(async (r: { id: string; content: Record<string, unknown>; tags: Record<string, unknown> }) => {
      records.set(r.id, { ...r })
    }),
  }
  return { agent: { genericRecords } as unknown as Agent, records }
}

beforeEach(() => {
  resetPollsWaiting()
  resetPollsCheckFloor()
})

describe('which polls wait', () => {
  test('an open poll not voted in waits; voted, on its way, closed, not open yet, not voting or hidden do not', async () => {
    const records: Record<string, object> = {
      voted: { votedAt: NOW - HOUR },
      sending: { pending: { stage: 'cast' } },
    }
    const service = {
      readPolls: jest.fn(async () => [
        listed('open'),
        listed('voted'),
        listed('sending'),
        listed('closed', { votingClosesAt: iso(NOW - 1) }),
        listed('later', { votingOpensAt: iso(NOW + HOUR) }),
        listed('tallied', { state: 'tallied' }),
        listed('hidden'),
      ]),
      record: jest.fn(async (_c: string, electionId: string) => records[electionId]),
    }
    const hidden = { [`${A} hidden`]: { closesAt: NOW + 100 * HOUR, returnAt: NOW + HOUR } }
    const found = await findPollsWaiting(service as never, [A], hidden, NOW)
    expect(found.map((p) => p.electionId)).toEqual(['open'])
    // Asked only for the polls open for voting.
    expect(service.readPolls).toHaveBeenCalledWith(A, { state: 'voting' })
  })

  test('a community that cannot be read is skipped; the others still count (control)', async () => {
    const service = {
      readPolls: jest.fn(async (c: string) => {
        if (c === A) throw new Error('not reachable')
        return [listed('open')]
      }),
      record: jest.fn(async () => undefined),
    }
    const found = await findPollsWaiting(service as never, [A, B], {}, NOW)
    expect(found).toEqual([{ communityDid: B, electionId: 'open', votingClosesAt: listed('open').votingClosesAt }])
  })

  test('what waits names the community, the poll and its close: never the question', async () => {
    const service = { readPolls: jest.fn(async () => [listed('open')]), record: jest.fn(async () => undefined) }
    const found = await findPollsWaiting(service as never, [A], {}, NOW)
    expect(JSON.stringify(found)).not.toContain(QUESTION)
  })
})

describe('Not now', () => {
  test('the first hides it until a random time before the close; it comes back then, and only then', () => {
    const poll = waitingOn('p')
    const once = hideOnce({}, poll, NOW, () => 0.5)
    const back = once[`${A} p`].returnAt as number
    expect(back).toBeGreaterThan(NOW)
    expect(back).toBeLessThan(Date.parse(poll.votingClosesAt))
    expect(isHidden(once, A, 'p', back - 1)).toBe(true)
    expect(isHidden(once, A, 'p', back)).toBe(false)
  })

  test('once it has come back, Not now hides it until the close: it comes back only once', () => {
    const poll = waitingOn('p')
    const once = hideOnce({}, poll, NOW, () => 0.5)
    const back = once[`${A} p`].returnAt as number
    const twice = hideOnce(once, poll, back + 1, () => 0.5)
    expect(twice[`${A} p`].returnAt).toBeUndefined()
    expect(isHidden(twice, A, 'p', Date.parse(poll.votingClosesAt) - 1)).toBe(true)
  })

  test('the return is never at once and never at the close, whatever the draw', () => {
    const close = NOW + 10 * HOUR
    expect(returnTime(NOW, close, () => 0)).toBe(NOW + 2 * HOUR)
    expect(returnTime(NOW, close, () => 0.999999)).toBeLessThan(NOW + 8 * HOUR + 1)
    expect(returnTime(NOW, NOW - 1, () => 0.5)).toBeUndefined()
  })

  test('a poll never hidden is not hidden (control)', () => {
    expect(isHidden({}, A, 'p', NOW)).toBe(false)
  })

  test('hidden polls that have closed drop out of the record on the next Not now', () => {
    const old = { [`${A} gone`]: { closesAt: NOW - 1 } }
    expect(Object.keys(hideOnce(old, waitingOn('p'), NOW))).toEqual([`${A} p`])
  })

  test('Not now takes the card away at once and keeps only the close and the return; undo puts both back', async () => {
    const { agent, records } = fakeAgent()
    const { result } = renderHook(() => usePollsWaiting())
    act(() => publishPollsWaiting([waitingOn('p'), waitingOn('q')]))
    expect(result.current.map((p) => p.electionId)).toEqual(['p', 'q'])
    let hide: Awaited<ReturnType<typeof hidePollCard>> | undefined
    await act(async () => {
      hide = await hidePollCard(agent, waitingOn('p'), NOW, () => 0.5)
    })
    expect(result.current.map((p) => p.electionId)).toEqual(['q'])
    expect(hide?.comesBack).toBe(true)
    const kept = (records.get('polls-card-hidden')?.content.hidden ?? {}) as Record<string, object>
    expect(Object.keys(kept)).toEqual([`${A} p`])
    expect(Object.keys(kept[`${A} p`]).sort()).toEqual(['closesAt', 'returnAt'])
    await act(async () => hide?.undo())
    expect(result.current.map((p) => p.electionId)).toEqual(['p', 'q'])
    expect(await loadHiddenPolls(agent)).toEqual({})
  })

  test('a second Not now, after it came back, says it stays hidden until the close', async () => {
    const { agent } = fakeAgent()
    const first = await hidePollCard(agent, waitingOn('p'), NOW, () => 0)
    expect(first.comesBack).toBe(true)
    const back = NOW + 20 * HOUR
    const second = await hidePollCard(agent, waitingOn('p'), back + 1, () => 0)
    expect(second.comesBack).toBe(false)
  })
})

describe('voted since the last check', () => {
  test('leaves the stack when Messages comes into focus, from this phone’s records alone', async () => {
    const { result } = renderHook(() => usePollsWaiting())
    act(() => publishPollsWaiting([waitingOn('a'), waitingOn('b')]))
    const readPolls = jest.fn()
    await act(async () =>
      dropVotedPolls({
        readPolls,
        record: async (_c: string, e: string) => (e === 'a' ? { votedAt: NOW } : undefined),
      } as never)
    )
    expect(result.current.map((p) => p.electionId)).toEqual(['b'])
    expect(readPolls).not.toHaveBeenCalled()
  })
})

// ---- when the check asks ----

const mockAgent = { current: undefined as Agent | undefined }
const mockService = { readPolls: jest.fn(), record: jest.fn(async () => undefined) }
const mockLinked = { current: true }
jest.mock('@bifold/react-hooks', () => ({ useAgent: () => ({ agent: mockAgent.current }) }))
jest.mock('../usePolls', () => ({ usePollService: () => mockService }))
jest.mock('../../trust-tasks/module/vtaAgent', () => ({
  vtaAgent: {
    subscribe: () => () => undefined,
    getState: () => ({ link: { kind: mockLinked.current ? 'linked' : 'none' } }),
  },
}))
jest.mock('../../trust-tasks/module/VtiCommunityStore', () => ({
  isCurrentMembership: () => true,
  GenericRecordsCommunityStore: class {
    async listMemberships() {
      return [{ communityDid: A }, { communityDid: A }, { communityDid: B }]
    }
  },
}))

describe('when the check asks', () => {
  let appState: (state: string) => void
  beforeEach(() => {
    jest.useFakeTimers()
    mockAgent.current = fakeAgent().agent
    mockLinked.current = true
    mockService.readPolls.mockReset().mockResolvedValue([listed('open')])
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, handler: (s: string) => void) => {
      appState = handler
      return { remove: () => undefined }
    }) as never)
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true })
  })
  // Each test's hook goes when it ends, so its hourly timer can't fire into the next test.
  const mounted: Array<() => void> = []
  const mount = () => mounted.push(renderHook(() => usePollsWaitingCheck()).unmount)
  afterEach(() => {
    mounted.splice(0).forEach((unmount) => unmount())
    jest.useRealTimers()
  })

  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }

  test('on opening, once per community; again an hour later', async () => {
    mount()
    await act(flush)
    expect(mockService.readPolls).toHaveBeenCalledTimes(2)
    await act(async () => {
      jest.advanceTimersByTime(POLLS_CHECK_MS - 1)
      await flush()
    })
    expect(mockService.readPolls).toHaveBeenCalledTimes(2)
    await act(async () => {
      jest.advanceTimersByTime(1)
      await flush()
    })
    expect(mockService.readPolls).toHaveBeenCalledTimes(4)
  })

  test('never in the background; again on coming back to the foreground', async () => {
    mount()
    await act(flush)
    mockService.readPolls.mockClear()
    await act(async () => appState('background'))
    await act(async () => {
      jest.advanceTimersByTime(3 * POLLS_CHECK_MS)
      await flush()
    })
    expect(mockService.readPolls).not.toHaveBeenCalled()
    await act(async () => {
      appState('active')
      await flush()
    })
    expect(mockService.readPolls).toHaveBeenCalledTimes(2)
  })

  test('nothing is asked without a linked agent (control for the opening check)', async () => {
    mockLinked.current = false
    mount()
    await act(flush)
    expect(mockService.readPolls).not.toHaveBeenCalled()
  })
})
