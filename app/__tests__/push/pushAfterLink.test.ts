/**
 * Notifications turned on before the phone had an agent (in onboarding, or in
 * Settings) become a wake channel once the phone is linked: push/pushAfterLink.ts.
 */
import { PUSH_AFTER_LINK_TRIES, watchLinkForPush, type LinkSource } from '@/push/pushAfterLink'
import type { PushWakeOutcome } from '@/push/pushWake'

type State = ReturnType<LinkSource['getState']>

const T0 = 1_000_000
const online = { kind: 'linked', connection: { kind: 'online' } }
const offline = { kind: 'linked', connection: { kind: 'offline' } }
const wakeable = { status: 'wakeable', handle: { gateway: 'did:web:gw', handle: 'h' } } as PushWakeOutcome

function fakeSource(initial: State) {
  let state = initial
  const listeners = new Set<() => void>()
  const source: LinkSource = {
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    getState: () => state,
  }
  const set = (next: Partial<State>) => {
    state = { ...state, ...next }
    listeners.forEach((l) => l())
  }
  return { source, set, listeners }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

function start(initial: State, opts: { optedIn?: boolean; enableWake?: jest.Mock } = {}) {
  const fake = fakeSource(initial)
  let optedIn = opts.optedIn ?? true
  const enableWake = opts.enableWake ?? jest.fn(async () => wakeable)
  const log = jest.fn()
  const stop = watchLinkForPush({ source: fake.source, since: T0, optedIn: () => optedIn, enableWake, log })
  return { ...fake, enableWake, log, stop, setOptedIn: (v: boolean) => (optedIn = v) }
}

describe('after a new agent link', () => {
  it('makes the phone wakeable when the person has notifications on', async () => {
    const w = start({ link: { kind: 'unlinked' }, activity: [] })
    w.set({ link: online, activity: [{ at: T0 + 5, kind: 'linked' }] })
    await flush()
    expect(w.enableWake).toHaveBeenCalledTimes(1)
    expect(w.log).toHaveBeenCalledWith('push wake: enable after link', { status: 'wakeable' })
  })

  it('does nothing when the person has notifications off', async () => {
    const w = start({ link: { kind: 'unlinked' }, activity: [] }, { optedIn: false })
    w.set({ link: online, activity: [{ at: T0 + 5, kind: 'linked' }] })
    await flush()
    expect(w.enableWake).not.toHaveBeenCalled()
  })

  it('waits for the link to be online, then acts once', async () => {
    const w = start({ link: { kind: 'unlinked' }, activity: [] })
    w.set({ link: offline, activity: [{ at: T0 + 5, kind: 'linked' }] })
    await flush()
    expect(w.enableWake).not.toHaveBeenCalled()

    w.set({
      link: online,
      activity: [
        { at: T0 + 9, kind: 'reconnected' },
        { at: T0 + 5, kind: 'linked' },
      ],
    })
    await flush()
    w.set({ link: online })
    await flush()
    expect(w.enableWake).toHaveBeenCalledTimes(1)
  })
})

describe('what does not count as a new link', () => {
  it('a link restored at launch: activity from before the watch started', async () => {
    const w = start({ link: online, activity: [{ at: T0 - 100, kind: 'linked' }] })
    w.set({ link: online })
    await flush()
    expect(w.enableWake).not.toHaveBeenCalled()
  })

  it('a reconnect of an existing link', async () => {
    const w = start({ link: offline, activity: [] })
    w.set({ link: online, activity: [{ at: T0 + 5, kind: 'reconnected' }] })
    await flush()
    expect(w.enableWake).not.toHaveBeenCalled()
  })
})

describe('when making the phone wakeable fails', () => {
  it(`tries again on later changes, at most ${PUSH_AFTER_LINK_TRIES} times`, async () => {
    const enableWake = jest.fn(async (): Promise<PushWakeOutcome> => {
      throw new Error('gateway refused')
    })
    const w = start({ link: { kind: 'unlinked' }, activity: [] }, { enableWake })
    w.set({ link: online, activity: [{ at: T0 + 5, kind: 'linked' }] })
    await flush()
    for (let i = 0; i < PUSH_AFTER_LINK_TRIES + 2; i++) {
      w.set({ link: online })
      await flush()
    }
    expect(enableWake).toHaveBeenCalledTimes(PUSH_AFTER_LINK_TRIES)
    expect(w.log).toHaveBeenCalledWith('push wake: enable after link failed', { error: 'gateway refused', try: 1 })
  })

  it('a later new link starts over', async () => {
    const enableWake = jest.fn(async (): Promise<PushWakeOutcome> => {
      throw new Error('gateway refused')
    })
    const w = start({ link: { kind: 'unlinked' }, activity: [] }, { enableWake })
    w.set({ link: online, activity: [{ at: T0 + 5, kind: 'linked' }] })
    await flush()
    for (let i = 0; i < PUSH_AFTER_LINK_TRIES; i++) {
      w.set({ link: online })
      await flush()
    }
    enableWake.mockImplementation(async () => wakeable)
    w.set({ link: online, activity: [{ at: T0 + 50, kind: 'linked' }] })
    await flush()
    expect(enableWake).toHaveBeenCalledTimes(PUSH_AFTER_LINK_TRIES + 1)
  })
})

it('stops listening when stopped', () => {
  const w = start({ link: { kind: 'unlinked' }, activity: [] })
  expect(w.listeners.size).toBe(1)
  w.stop()
  expect(w.listeners.size).toBe(0)
})
