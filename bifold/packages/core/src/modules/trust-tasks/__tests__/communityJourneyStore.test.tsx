/**
 * One reading per community, kept in a store every screen reads (UI-smoothness plan, Phase 2). The journey lived in
 * each screen's own state: a screen that mounted started from nothing (the join screens showed a non-member's page
 * until the read came back), two screens could disagree, and with tabs unmounted on blur a change that landed
 * elsewhere was not read until the screen came back — and showed the state before it first.
 */
import { act, renderHook } from '@testing-library/react-native'

import { emitCommunityChanged } from '../module/communityChanged'
import {
  communityJourneys,
  joinKnown,
  withPart,
  useCommunityJourney,
  type CommunityJourney,
  type CommunityJourneyReaders,
} from '../module/communityJourney'
import { setCurrentAgentDid } from '../module/currentAgent'
import type { CommunityJoinState } from '../module/vtiJoin'

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useIsFocused: jest.fn(() => true),
}))

const COMMUNITY = 'did:webvh:QmCommunity:vtc.example.org:keyring-test-vtc'
const agent = {} as never
const stateOf = (kind: string) => ({ kind }) as unknown as CommunityJoinState

/** Readers whose join state is whatever `state()` says when asked, answered when `gate()` lets it. */
function readers(state: () => CommunityJoinState, gate: () => Promise<void> = () => Promise.resolve()) {
  const join = jest.fn(async () => {
    const answer = state()
    await gate()
    return answer
  })
  const r: Partial<CommunityJourneyReaders> = {
    join,
    application: async () => undefined,
    vetterGrant: async () => ({ state: 'none' }),
  }
  return { r, join }
}

const settle = async () => {
  await act(async () => {
    jest.advanceTimersByTime(10)
  })
}

describe('one journey per community, shared and kept', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    communityJourneys.forget()
    setCurrentAgentDid('did:webvh:agent-a')
  })
  afterEach(() => jest.useRealTimers())

  it('two screens on the same community show the same reading', async () => {
    let state = stateOf('pending')
    const { r } = readers(() => state)
    const a = renderHook(() => useCommunityJourney(agent, COMMUNITY, { readers: r }))
    const b = renderHook(() => useCommunityJourney(agent, COMMUNITY, { readers: r }))
    await settle()
    expect(a.result.current.journey?.join.kind).toBe('pending')
    state = stateOf('member')
    // One screen reads again; the other shows it too.
    await act(async () => a.result.current.refresh())
    await settle()
    expect(a.result.current.journey?.join.kind).toBe('member')
    expect(b.result.current.journey?.join.kind).toBe('member')
  })

  it('a screen that mounts after a reading shows it on its first render, not nothing', async () => {
    const { r } = readers(() => stateOf('member'))
    const first = renderHook(() => useCommunityJourney(agent, COMMUNITY, { readers: r }))
    await settle()
    first.unmount()
    const seen: (string | undefined)[] = []
    renderHook(() => {
      const { journey } = useCommunityJourney(agent, COMMUNITY, { readers: r })
      seen.push(journey?.join.kind)
      return journey
    })
    expect(seen[0]).toBe('member')
  })

  it('only the newest reading lands: an older one finishing late does not put back what was before', async () => {
    let release: () => void = () => undefined
    let calls = 0
    let state = stateOf('pending')
    const { r } = readers(
      () => state,
      () => (++calls === 1 ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve())
    )
    const { result } = renderHook(() => useCommunityJourney(agent, COMMUNITY, { readers: r }))
    // Let the first read take its answer (pending); it is held, still out.
    await settle()
    expect(calls).toBe(1)
    // A second read (member) lands first.
    state = stateOf('member')
    await act(async () => result.current.refresh())
    await settle()
    expect(result.current.journey?.join.kind).toBe('member')
    await act(async () => release())
    await settle()
    expect(result.current.journey?.join.kind).toBe('member')
  })

  it('a change that lands while no screen is mounted is read; the next screen shows it at once', async () => {
    let state = stateOf('pending')
    const { r, join } = readers(() => state)
    const shown = renderHook(() => useCommunityJourney(agent, COMMUNITY, { readers: r }))
    await settle()
    shown.unmount()
    // The approval lands while the tab is away.
    state = stateOf('member')
    const before = join.mock.calls.length
    await act(async () => emitCommunityChanged(COMMUNITY, 'membership'))
    await settle()
    await settle()
    // The control: it was read again, by the store, with nothing mounted.
    expect(join.mock.calls.length).toBeGreaterThan(before)
    expect(communityJourneys.get(COMMUNITY)?.join.kind).toBe('member')
    const seen: (string | undefined)[] = []
    renderHook(() => {
      const { journey } = useCommunityJourney(agent, COMMUNITY, { readers: r })
      seen.push(journey?.join.kind)
      return journey
    })
    expect(seen[0]).toBe('member')
  })

  it("another agent's reading of the same community is never this agent's", async () => {
    const { r } = readers(() => stateOf('member'))
    renderHook(() => useCommunityJourney(agent, COMMUNITY, { readers: r }))
    await settle()
    expect(communityJourneys.get(COMMUNITY)?.join.kind).toBe('member')
    setCurrentAgentDid('did:webvh:agent-b')
    expect(communityJourneys.get(COMMUNITY)).toBeUndefined()
    setCurrentAgentDid('did:webvh:agent-a')
    expect(communityJourneys.get(COMMUNITY)?.join.kind).toBe('member')
  })

  // 7a on #489: a failed read stood in as "none" — and in a store every screen reads, a member whose read failed
  // read as a non-member everywhere until something read again.
  describe('a read that fails is unknown, never "not a member"', () => {
    it('a member, then a read whose join part fails: still a member, for every screen', async () => {
      let failing = false
      const { r } = readers(() => {
        if (failing) throw new Error('storage unavailable')
        return stateOf('member')
      })
      const { result } = renderHook(() => useCommunityJourney(agent, COMMUNITY, { readers: r }))
      await settle()
      expect(joinKnown(result.current.journey)?.kind).toBe('member')
      failing = true
      await act(async () => result.current.refresh())
      await settle()
      expect(result.current.journey?.join.kind).toBe('member')
      expect(result.current.journey?.unread).toBeUndefined()
      expect(joinKnown(communityJourneys.get(COMMUNITY))?.kind).toBe('member')
    })

    it('a first read whose join part fails: unknown (joinKnown undefined), not "none"', async () => {
      const { r } = readers(() => {
        throw new Error('storage unavailable')
      })
      const { result } = renderHook(() => useCommunityJourney(agent, COMMUNITY, { readers: r }))
      await settle()
      // The reading landed (the other parts were read) — but its join is marked unread.
      expect(result.current.journey).toBeDefined()
      expect(result.current.journey?.unread).toEqual(['join'])
      expect(joinKnown(result.current.journey)).toBeUndefined()
    })

    it('a part that lands: replaces that part and leaves unread; a part that fails: keeps what was read', () => {
      const before: CommunityJourney = {
        join: stateOf('member'),
        vetterGrant: { state: 'none' },
        unread: ['application'],
      }
      // The join could not be read: the member stays.
      expect(withPart(before, 'join', { ok: false, value: undefined })).toBe(before)
      // Nothing read before, and it fails: unknown, with every part listed unread.
      expect(withPart(undefined, 'join', { ok: false, value: undefined }).unread).toEqual([
        'join',
        'application',
        'vetterGrant',
      ])
      // The application lands: no longer unread.
      const landed = withPart(before, 'application', { ok: true, value: undefined })
      expect(landed.unread).toBeUndefined()
      expect(landed.join.kind).toBe('member')
    })

    it('a read that asks shows what the phone holds first, then the community’s answer', async () => {
      let release: () => void = () => undefined
      const join = jest.fn(async (_a: unknown, _d: string, { poll }: { poll: boolean }) => {
        if (!poll) return stateOf('sent')
        await new Promise<void>((resolve) => (release = resolve))
        return stateOf('pending')
      })
      const r = { join, application: async () => undefined, vetterGrant: async () => ({ state: 'none' }) } as never
      const { result } = renderHook(() => useCommunityJourney(agent, COMMUNITY, { poll: true, readers: r }))
      await settle()
      // Asked, not answered yet: what this phone holds.
      expect(join).toHaveBeenLastCalledWith(agent, COMMUNITY, { poll: true })
      expect(joinKnown(result.current.journey)?.kind).toBe('sent')
      await act(async () => release())
      expect(joinKnown(result.current.journey)?.kind).toBe('pending')
    })

    // Phase 2b: a read that did not ask, started while one that asks was out, read the record before the answer was
    // stored and landed after it — a request the community said it never got shown as "Sent" again.
    it('a read that does not ask waits for one that asks, and reads what it stored', async () => {
      let stored = 'sent'
      let release: () => void = () => undefined
      const join = jest.fn(async (_a: unknown, _d: string, { poll }: { poll: boolean }) => {
        if (!poll) return stateOf(stored)
        await new Promise<void>((resolve) => (release = resolve))
        stored = 'lost'
        return stateOf(stored)
      })
      const r = { join, application: async () => undefined, vetterGrant: async () => ({ state: 'none' }) } as never
      const { result } = renderHook(() => useCommunityJourney(agent, COMMUNITY, { poll: true, readers: r }))
      await settle()
      // A change read again while the ask is out.
      let rereading: Promise<void> = Promise.resolve()
      act(() => {
        rereading = result.current.refresh()
      })
      await settle()
      release()
      await act(async () => rereading)
      expect(result.current.journey?.join.kind).toBe('lost')
      expect(join).toHaveBeenLastCalledWith(agent, COMMUNITY, { poll: false })
    })

    // Phase 2b: the join waited for the vetter grant's status-list fetch (a network read) before any of it landed.
    it('the join lands as soon as it is read, not when a slow part is', async () => {
      const { r } = readers(() => stateOf('member'))
      r.vetterGrant = () => new Promise(() => undefined)
      const { result } = renderHook(() => useCommunityJourney(agent, COMMUNITY, { readers: r }))
      await settle()
      expect(joinKnown(result.current.journey)?.kind).toBe('member')
      // The grant is still out: unknown, not "none".
      expect(result.current.journey?.unread).toEqual(['vetterGrant'])
    })
  })
})
