/**
 * Notifications turned on before the phone had an agent (in onboarding, or in
 * Settings) become a wake channel once the phone is linked: push/pushAfterLink.ts.
 */
import {
  PUSH_AFTER_LINK_RETRY_MS,
  PUSH_AFTER_LINK_TRIES,
  watchLinkForPush,
  type LinkSource,
} from '@/push/pushAfterLink'
import { PushGatewayRefusal } from '@/push/pushGateway'
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

function start(
  initial: State,
  opts: {
    optedIn?: boolean
    enableWake?: jest.Mock
    whenTokenArrives?: (arrived: () => void) => () => void
    unwakeableAgents?: () => Promise<string[]>
  } = {}
) {
  const fake = fakeSource(initial)
  let optedIn = opts.optedIn ?? true
  const enableWake = opts.enableWake ?? jest.fn(async () => wakeable)
  const log = jest.fn()
  const stop = watchLinkForPush({
    source: fake.source,
    since: T0,
    optedIn: () => optedIn,
    enableWake,
    log,
    ...(opts.whenTokenArrives ? { whenTokenArrives: opts.whenTokenArrives } : {}),
    ...(opts.unwakeableAgents ? { unwakeableAgents: opts.unwakeableAgents } : {}),
  })
  return { ...fake, enableWake, log, stop, setOptedIn: (v: boolean) => (optedIn = v) }
}

/** A stand-in for the platform: holds the `arrived` callback until the test hands the token over. */
function lateToken() {
  let arrived: (() => void) | undefined
  const stopped = jest.fn()
  const whenTokenArrives = jest.fn((cb: () => void) => {
    arrived = cb
    return () => {
      arrived = undefined
      stopped()
    }
  })
  return { whenTokenArrives, stopped, deliver: () => arrived?.(), watching: () => arrived !== undefined }
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
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate'] }))
  afterEach(() => jest.useRealTimers())
  const refused = () =>
    jest.fn(async (): Promise<PushWakeOutcome> => {
      throw new Error('gateway refused')
    })
  const waitOut = async (ms: number) => {
    jest.advanceTimersByTime(ms)
    await flush()
  }

  // Alberto's iPhone, 10-06: one failed try right after a link left the agent
  // with no wake channel until the switch was turned off and on.
  it(`tries again after a while, without waiting for the link to change, at most ${PUSH_AFTER_LINK_TRIES} times`, async () => {
    const enableWake = refused()
    const w = start({ link: { kind: 'unlinked' }, activity: [] }, { enableWake })
    w.set({ link: online, activity: [{ at: T0 + 5, kind: 'linked' }] })
    await flush()
    expect(enableWake).toHaveBeenCalledTimes(1)
    expect(w.log).toHaveBeenCalledWith('push wake: enable after link failed', { error: 'gateway refused', try: 1 })
    // Not again at once on the next change: after its wait.
    w.set({ link: online })
    await flush()
    expect(enableWake).toHaveBeenCalledTimes(1)
    for (const ms of PUSH_AFTER_LINK_RETRY_MS) await waitOut(ms)
    expect(enableWake).toHaveBeenCalledTimes(PUSH_AFTER_LINK_TRIES)
    await waitOut(10 * 60_000)
    expect(enableWake).toHaveBeenCalledTimes(PUSH_AFTER_LINK_TRIES)
  })

  // A tester on 242, 10-10: `noToken` once after a link, never tried again, so
  // the phone was never woken. Apple's token can arrive after the first look.
  it(`no platform token yet is tried again the same way, at most ${PUSH_AFTER_LINK_TRIES} times`, async () => {
    const enableWake = jest.fn(async (): Promise<PushWakeOutcome> => ({ status: 'noToken' }))
    const w = start({ link: { kind: 'unlinked' }, activity: [] }, { enableWake })
    w.set({ link: { ...online, vtaDid: 'did:web:agent' }, activity: [{ at: T0 + 5, kind: 'linked' }] })
    await flush()
    expect(enableWake).toHaveBeenCalledTimes(1)
    expect(w.log).toHaveBeenCalledWith('push wake: enable after link', {
      status: 'noToken',
      agent: 'did:web:agent',
      try: 1,
    })
    for (const ms of PUSH_AFTER_LINK_RETRY_MS) await waitOut(ms)
    expect(enableWake).toHaveBeenCalledTimes(PUSH_AFTER_LINK_TRIES)
    await waitOut(10 * 60_000)
    expect(enableWake).toHaveBeenCalledTimes(PUSH_AFTER_LINK_TRIES)
  })

  it('a token that arrives by a later try makes the phone wakeable and stops the retries', async () => {
    const enableWake = jest.fn(async (): Promise<PushWakeOutcome> => ({ status: 'noToken' }))
    const w = start({ link: { kind: 'unlinked' }, activity: [] }, { enableWake })
    w.set({ link: online, activity: [{ at: T0 + 5, kind: 'linked' }] })
    await flush()
    enableWake.mockImplementation(async () => wakeable)
    await waitOut(PUSH_AFTER_LINK_RETRY_MS[0])
    expect(enableWake).toHaveBeenCalledTimes(2)
    expect(w.log).toHaveBeenLastCalledWith('push wake: enable after link', { status: 'wakeable', agent: undefined })
    await waitOut(10 * 60_000)
    expect(enableWake).toHaveBeenCalledTimes(2)
  })

  // IN-277, 263: every try found no token (each waited its 10 s), then Apple
  // handed the token over about two minutes after the last one gave up, and
  // the phone stayed unwakeable until the person toggled notifications.
  describe('a token that arrives after every try gave up', () => {
    const allTriesNoToken = async (late: ReturnType<typeof lateToken>) => {
      const enableWake = jest.fn(async (): Promise<PushWakeOutcome> => ({ status: 'noToken' }))
      const w = start(
        { link: { kind: 'unlinked' }, activity: [] },
        { enableWake, whenTokenArrives: late.whenTokenArrives }
      )
      w.set({ link: { ...online, vtaDid: 'did:web:agent' }, activity: [{ at: T0 + 5, kind: 'linked' }] })
      await flush()
      for (const ms of PUSH_AFTER_LINK_RETRY_MS) await waitOut(ms)
      expect(enableWake).toHaveBeenCalledTimes(PUSH_AFTER_LINK_TRIES)
      return { w, enableWake }
    }

    it('makes the phone wakeable when it comes, with no toggle', async () => {
      const late = lateToken()
      const { w, enableWake } = await allTriesNoToken(late)
      expect(late.whenTokenArrives).toHaveBeenCalledTimes(1)
      expect(w.log).toHaveBeenCalledWith('push wake: no token after every try; waiting for it')
      enableWake.mockImplementation(async () => wakeable)
      late.deliver()
      await flush()
      expect(enableWake).toHaveBeenCalledTimes(PUSH_AFTER_LINK_TRIES + 1)
      expect(w.log).toHaveBeenCalledWith('push wake: token arrived after the tries; enabling')
      expect(w.log).toHaveBeenLastCalledWith('push wake: enable after link', {
        status: 'wakeable',
        agent: 'did:web:agent',
      })
      await waitOut(10 * 60_000)
      expect(enableWake).toHaveBeenCalledTimes(PUSH_AFTER_LINK_TRIES + 1)
    })

    it('starts watching only when the tries ran out for want of a token, not for a refusal', async () => {
      const late = lateToken()
      const enableWake = refused()
      const w = start(
        { link: { kind: 'unlinked' }, activity: [] },
        { enableWake, whenTokenArrives: late.whenTokenArrives }
      )
      w.set({ link: online, activity: [{ at: T0 + 5, kind: 'linked' }] })
      await flush()
      for (const ms of PUSH_AFTER_LINK_RETRY_MS) await waitOut(ms)
      expect(late.whenTokenArrives).not.toHaveBeenCalled()
    })

    it('a new link stops the watch and starts over; stopping stops it too', async () => {
      const late = lateToken()
      const { w } = await allTriesNoToken(late)
      expect(late.watching()).toBe(true)
      w.set({ link: { ...online, vtaDid: 'did:web:agent' }, activity: [{ at: T0 + 50, kind: 'linked' }] })
      await flush()
      expect(late.stopped).toHaveBeenCalledTimes(1)

      const again = lateToken()
      const second = await allTriesNoToken(again)
      second.w.stop()
      expect(again.stopped).toHaveBeenCalledTimes(1)
    })
  })

  // IN-277: the tester switched A → B while Apple had not yet handed over a
  // token, and only the agent current when it came was ever made wakeable. A
  // wake is registered with the current agent only (the session is with it),
  // so another agent becomes wakeable when it is switched to again.
  describe('several agents, and a token that comes late', () => {
    const A = 'did:web:agent-a'
    const B = 'did:web:agent-b'
    const C = 'did:web:agent-c'
    const at = (vtaDid: string) => ({ ...online, vtaDid })

    it('the token arrives while B is current: B is wakeable; switching back to A makes A wakeable, with no toggle', async () => {
      const late = lateToken()
      let tokenThere = false
      const enableWake = jest.fn(async (): Promise<PushWakeOutcome> => (tokenThere ? wakeable : { status: 'noToken' }))
      const w = start(
        { link: { kind: 'unlinked' }, activity: [] },
        { enableWake, whenTokenArrives: late.whenTokenArrives }
      )
      w.set({ link: at(A), activity: [{ at: T0 + 5, kind: 'linked' }] })
      await flush()
      w.set({ link: at(B) })
      await flush()
      for (const ms of PUSH_AFTER_LINK_RETRY_MS) await waitOut(ms)
      expect(late.watching()).toBe(true)

      tokenThere = true
      late.deliver()
      await flush()
      expect(w.log).toHaveBeenLastCalledWith('push wake: enable after link', { status: 'wakeable', agent: B })

      w.set({ link: at(A) })
      await flush()
      expect(w.log).toHaveBeenLastCalledWith('push wake: enable after link', { status: 'wakeable', agent: A })
    })

    it('says which other linked agents still cannot wake the phone, once one is made wakeable', async () => {
      const unwakeableAgents = jest.fn(async () => [A, B, C])
      const w = start({ link: { kind: 'unlinked' }, activity: [] }, { unwakeableAgents })
      w.set({ link: at(B), activity: [{ at: T0 + 5, kind: 'linked' }] })
      await flush()
      await flush()
      expect(w.log).toHaveBeenCalledWith('push wake: linked agents without a wake', { agents: [A, C] })
    })

    it('says nothing when every other agent can wake it', async () => {
      const w = start({ link: { kind: 'unlinked' }, activity: [] }, { unwakeableAgents: async () => [B] })
      w.set({ link: at(B), activity: [{ at: T0 + 5, kind: 'linked' }] })
      await flush()
      await flush()
      expect(w.log).not.toHaveBeenCalledWith('push wake: linked agents without a wake', expect.anything())
    })
  })

  it('a try that then works stops the retries', async () => {
    const enableWake = refused()
    const w = start({ link: { kind: 'unlinked' }, activity: [] }, { enableWake })
    w.set({ link: online, activity: [{ at: T0 + 5, kind: 'linked' }] })
    await flush()
    enableWake.mockImplementation(async () => wakeable)
    await waitOut(PUSH_AFTER_LINK_RETRY_MS[0])
    expect(enableWake).toHaveBeenCalledTimes(2)
    await waitOut(10 * 60_000)
    expect(enableWake).toHaveBeenCalledTimes(2)
  })

  it('a later new link starts over', async () => {
    const enableWake = refused()
    const w = start({ link: { kind: 'unlinked' }, activity: [] }, { enableWake })
    w.set({ link: online, activity: [{ at: T0 + 5, kind: 'linked' }] })
    await flush()
    for (const ms of PUSH_AFTER_LINK_RETRY_MS) await waitOut(ms)
    expect(enableWake).toHaveBeenCalledTimes(PUSH_AFTER_LINK_TRIES)
    enableWake.mockImplementation(async () => wakeable)
    w.set({ link: online, activity: [{ at: T0 + 50, kind: 'linked' }] })
    await flush()
    expect(enableWake).toHaveBeenCalledTimes(PUSH_AFTER_LINK_TRIES + 1)
  })

  it('stopping cancels a retry that is waiting', async () => {
    const enableWake = refused()
    const w = start({ link: { kind: 'unlinked' }, activity: [] }, { enableWake })
    w.set({ link: online, activity: [{ at: T0 + 5, kind: 'linked' }] })
    await flush()
    w.stop()
    await waitOut(10 * 60_000)
    expect(enableWake).toHaveBeenCalledTimes(1)
  })
})

describe("the gateway's limit of handles for this token", () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate'] }))
  afterEach(() => jest.useRealTimers())

  it('is said to the person once, and not retried', async () => {
    const enableWake = jest.fn(async (): Promise<PushWakeOutcome> => {
      throw new PushGatewayRefusal('taskFailed', 'task failed: too many handles for this push token')
    })
    const fake = fakeSource({ link: { kind: 'unlinked' }, activity: [] })
    const onHandleLimit = jest.fn()
    watchLinkForPush({ source: fake.source, since: T0, optedIn: () => true, enableWake, log: jest.fn(), onHandleLimit })
    fake.set({ link: online, activity: [{ at: T0 + 5, kind: 'linked' }] })
    await flush()
    jest.advanceTimersByTime(10 * 60_000)
    await flush()
    expect(enableWake).toHaveBeenCalledTimes(1)
    expect(onHandleLimit).toHaveBeenCalledTimes(1)
  })
})

// Each agent holds its own wake channel (Alberto's iPhone, 10-06).
describe('switching to another agent', () => {
  const on = (vtaDid: string) => ({ kind: 'linked', vtaDid, connection: { kind: 'online' } })

  it('gives the agent switched to a wake channel', async () => {
    const w = start({ link: on('did:webvh:a'), activity: [] })
    await flush()
    expect(w.enableWake).not.toHaveBeenCalled()
    w.set({ link: { kind: 'linked', vtaDid: 'did:webvh:b', connection: { kind: 'offline' } } })
    await flush()
    expect(w.enableWake).not.toHaveBeenCalled()
    w.set({ link: on('did:webvh:b') })
    await flush()
    expect(w.enableWake).toHaveBeenCalledTimes(1)
    expect(w.log).toHaveBeenCalledWith('push wake: enable after link', { status: 'wakeable', agent: 'did:webvh:b' })
  })

  it('not for the agent the app started on, nor a reconnect of the same agent', async () => {
    const w = start({ link: on('did:webvh:a'), activity: [] })
    w.set({ link: { kind: 'linked', vtaDid: 'did:webvh:a', connection: { kind: 'offline' } } })
    w.set({ link: on('did:webvh:a') })
    await flush()
    expect(w.enableWake).not.toHaveBeenCalled()
  })

  it('not with notifications off', async () => {
    const w = start({ link: on('did:webvh:a'), activity: [] }, { optedIn: false })
    w.set({ link: on('did:webvh:b') })
    await flush()
    expect(w.enableWake).not.toHaveBeenCalled()
  })
})

it('stops listening when stopped', () => {
  const w = start({ link: { kind: 'unlinked' }, activity: [] })
  expect(w.listeners.size).toBe(1)
  w.stop()
  expect(w.listeners.size).toBe(0)
})
