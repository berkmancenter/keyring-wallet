/**
 * The "Show a code" hook (relationship-over-tsp plan WP9): one live code per mounted screen, followed through its
 * states, and never outliving the screen. The core is a stand-in here (its own suites cover it); what is under test
 * is the hook's half of the contract agreed with the screen.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native'

import type { CreateInviteResult } from '../module/sharedConnectInvite'
import type { SharedConnectInviteFailure, SharedConnectInviteState } from '../module/sharedConnectInviteTypes'
import { useSharedConnectInvite, type UseSharedConnectInviteDeps } from '../module/useSharedConnectInvite'

const mockAgent = { config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() } } }
jest.mock('@bifold/react-hooks', () => ({ useAgent: () => ({ agent: mockAgent }) }))

/** A code as the hook sees it: a state, a failure, listeners, and an idempotent cancel. */
class FakeInviter {
  state: SharedConnectInviteState = 'waiting'
  failure?: SharedConnectInviteFailure
  cancels = 0
  private listeners = new Set<(s: SharedConnectInviteState) => void>()
  constructor(readonly enactment: string) {}
  subscribe(l: (s: SharedConnectInviteState) => void) {
    this.listeners.add(l)
    return () => void this.listeners.delete(l)
  }
  emit(state: SharedConnectInviteState, failure?: SharedConnectInviteFailure) {
    this.state = state
    this.failure = failure
    for (const l of [...this.listeners]) l(state)
  }
  async cancel() {
    this.cancels += 1
    if (this.state !== 'cancelled') this.emit('cancelled')
  }
}

const EXP = 1_800_000_600
const showing = (inviter: FakeInviter): CreateInviteResult =>
  ({ kind: 'showing', inviter, link: `https://link.trustoverip.org/t#_id=${inviter.enactment}`, exp: EXP }) as never

/** Each create() hands out the next code, resolved now or held until the test releases it. */
function deps(results: Array<CreateInviteResult | Promise<CreateInviteResult>>) {
  const d = {
    create: jest.fn(async () => {
      const next = results.shift()
      if (!next) throw new Error('no more codes')
      return next
    }),
    sweep: jest.fn(async () => 0),
  } satisfies UseSharedConnectInviteDeps
  return d
}

describe('useSharedConnectInvite', () => {
  test('mints, then shows the link and expiry, then follows the code through its states', async () => {
    const code = new FakeInviter('A')
    const d = deps([showing(code)])
    const { result } = renderHook(() => useSharedConnectInvite({ deps: d }))
    expect(result.current.state).toBe('minting')
    await waitFor(() => expect(result.current.state).toBe('waiting'))
    expect(result.current.link).toContain('_id=A')
    expect(result.current.expiresAt).toBe(EXP)
    act(() => code.emit('proposed'))
    expect(result.current.state).toBe('proposed')
    act(() => code.emit('connecting'))
    act(() => code.emit('connected'))
    expect(result.current.state).toBe('connected')
  })

  test('the stale codes are swept before a new one is made, and a sweep that fails does not stop it', async () => {
    const d = deps([showing(new FakeInviter('A'))])
    d.sweep.mockRejectedValueOnce(new Error('store'))
    const { result } = renderHook(() => useSharedConnectInvite({ deps: d }))
    await waitFor(() => expect(result.current.state).toBe('waiting'))
    expect(d.sweep.mock.invocationCallOrder[0]).toBeLessThan(d.create.mock.invocationCallOrder[0])
  })

  test('a failure carries its reason: the relay, or a spent work budget', async () => {
    const relayDeps = deps([{ kind: 'failed', failure: 'relay' }])
    const relay = renderHook(() => useSharedConnectInvite({ deps: relayDeps }))
    await waitFor(() => expect(relay.result.current).toMatchObject({ state: 'failed', failure: 'relay' }))
    const code = new FakeInviter('B')
    const spentDeps = deps([showing(code)])
    const spent = renderHook(() => useSharedConnectInvite({ deps: spentDeps }))
    await waitFor(() => expect(spent.result.current.state).toBe('waiting'))
    act(() => code.emit('failed', 'exhausted'))
    expect(spent.result.current).toMatchObject({ state: 'failed', failure: 'exhausted' })
  })

  test('switched off: nothing shows, and the state is cancelled', async () => {
    const d = deps([{ kind: 'off' }])
    const { result } = renderHook(() => useSharedConnectInvite({ deps: d }))
    await waitFor(() => expect(result.current.state).toBe('cancelled'))
    expect(result.current.link).toBeUndefined()
  })

  test('a code that cannot be made at all is failed: unknown', async () => {
    const d = deps([])
    const { result } = renderHook(() => useSharedConnectInvite({ deps: d }))
    await waitFor(() => expect(result.current).toMatchObject({ state: 'failed', failure: 'unknown' }))
  })

  test('cancel while showing ends the code, once, however often it is called', async () => {
    const code = new FakeInviter('A')
    const d = deps([showing(code)])
    const { result } = renderHook(() => useSharedConnectInvite({ deps: d }))
    await waitFor(() => expect(result.current.state).toBe('waiting'))
    await act(async () => {
      await result.current.cancel()
      await result.current.cancel()
    })
    expect(result.current.state).toBe('cancelled')
    expect(code.state).toBe('cancelled')
  })

  test('cancel while minting shows cancelled now, and the code is ended the moment it shows', async () => {
    let release!: (r: CreateInviteResult) => void
    const code = new FakeInviter('A')
    // Built once, outside the render: the render callback runs again on every state change.
    const d = deps([new Promise<CreateInviteResult>((resolve) => (release = resolve))])
    const { result } = renderHook(() => useSharedConnectInvite({ deps: d }))
    await act(async () => {
      await result.current.cancel()
    })
    expect(result.current.state).toBe('cancelled')
    await act(async () => release(showing(code)))
    await waitFor(() => expect(code.cancels).toBe(1))
    expect(result.current.state).toBe('cancelled')
    expect(result.current.link).toBeUndefined()
  })

  test('cancel while minting is not overwritten by a late failure', async () => {
    let release!: (r: CreateInviteResult) => void
    const d = deps([new Promise<CreateInviteResult>((resolve) => (release = resolve))])
    const { result } = renderHook(() => useSharedConnectInvite({ deps: d }))
    await act(async () => {
      await result.current.cancel()
    })
    await act(async () => release({ kind: 'failed', failure: 'relay' }))
    expect(result.current.state).toBe('cancelled')
    expect(result.current.failure).toBeUndefined()
  })

  test('a code never outlives its screen: unmount ends it, and one still being made is ended when it shows', async () => {
    const shown = new FakeInviter('A')
    const oneDeps = deps([showing(shown)])
    const one = renderHook(() => useSharedConnectInvite({ deps: oneDeps }))
    await waitFor(() => expect(one.result.current.state).toBe('waiting'))
    one.unmount()
    await waitFor(() => expect(shown.cancels).toBe(1))

    let release!: (r: CreateInviteResult) => void
    const late = new FakeInviter('B')
    const lateDeps = deps([new Promise<CreateInviteResult>((resolve) => (release = resolve))])
    const two = renderHook(() => useSharedConnectInvite({ deps: lateDeps }))
    await waitFor(() => expect(lateDeps.create).toHaveBeenCalled()) // the code is being made
    two.unmount()
    await act(async () => release(showing(late)))
    await waitFor(() => expect(late.cancels).toBe(1))
  })

  test('a screen that leaves before a code is even started makes none', async () => {
    const d = deps([showing(new FakeInviter('A'))])
    const { unmount } = renderHook(() => useSharedConnectInvite({ deps: d }))
    unmount()
    await act(async () => new Promise((resolve) => setImmediate(resolve)))
    expect(d.create).not.toHaveBeenCalled()
  })

  test('renew makes the new code only after the old one has finished ending', async () => {
    const events: string[] = []
    const first = new FakeInviter('A')
    let finishTeardown!: () => void
    first.cancel = async () => {
      events.push('teardown:start')
      await new Promise<void>((resolve) => (finishTeardown = resolve))
      first.emit('cancelled')
      events.push('teardown:done')
    }
    const second = new FakeInviter('B')
    const d = deps([showing(first), showing(second)])
    const create = d.create.getMockImplementation() as typeof d.create
    d.create.mockImplementation(async (...args: Parameters<typeof d.create>) => {
      events.push('create')
      return create(...args)
    })
    const { result } = renderHook(() => useSharedConnectInvite({ deps: d }))
    await waitFor(() => expect(result.current.link).toContain('_id=A'))
    act(() => result.current.renew())
    await act(async () => new Promise((resolve) => setImmediate(resolve)))
    expect(events).toEqual(['create', 'teardown:start']) // the old code is ending; no new one is being made yet
    await act(async () => finishTeardown())
    await waitFor(() => expect(result.current.link).toContain('_id=B'))
    expect(events).toEqual(['create', 'teardown:start', 'teardown:done', 'create'])
  })

  test('renew ends the old code and shows a fresh one', async () => {
    const first = new FakeInviter('A')
    const second = new FakeInviter('B')
    const d = deps([showing(first), showing(second)])
    const { result } = renderHook(() => useSharedConnectInvite({ deps: d }))
    await waitFor(() => expect(result.current.link).toContain('_id=A'))
    act(() => result.current.renew())
    await waitFor(() => expect(result.current.link).toContain('_id=B'))
    expect(first.cancels).toBe(1)
    expect(second.cancels).toBe(0)
    expect(result.current.state).toBe('waiting')
    // The old code's late states no longer reach the screen.
    act(() => first.emit('connected'))
    expect(result.current.state).toBe('waiting')
  })
})
