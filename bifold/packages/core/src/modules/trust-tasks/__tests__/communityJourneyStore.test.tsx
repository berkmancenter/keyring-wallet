/**
 * One reading per community, kept in a store every screen reads (UI-smoothness plan, Phase 2). The journey lived in
 * each screen's own state: a screen that mounted started from nothing (the join screens showed a non-member's page
 * until the read came back), two screens could disagree, and with tabs unmounted on blur a change that landed
 * elsewhere was not read until the screen came back — and showed the state before it first.
 */
import { act, renderHook } from '@testing-library/react-native'

import { emitCommunityChanged } from '../module/communityChanged'
import { communityJourneys, useCommunityJourney, type CommunityJourneyReaders } from '../module/communityJourney'
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
})
