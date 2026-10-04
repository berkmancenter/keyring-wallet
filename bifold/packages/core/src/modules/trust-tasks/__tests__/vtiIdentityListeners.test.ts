/**
 * A listener for every identity of this phone that the shared session is not
 * signed in as (IN-102): which identities get one, the handover to the shared
 * session (one live connection per DID at a mediator), the background, and
 * retries.
 */
import { AppState, DeviceEventEmitter } from 'react-native'

import { VTI_PERSONA_KEYS_HELD_EVENT } from '../module/communityChanged'
import type { VtiPersona } from '../module/VtiIdentityStore'

type Guard = (did: string) => Promise<void>
const mockShared = {
  did: undefined as string | undefined,
  signingInAs: undefined as string | undefined,
  connected: false,
}
const mockSharedListeners = new Set<() => void>()
const mockGuards = new Set<Guard>()
jest.mock('../module/vtiAgent', () => ({
  vtiAgent: {
    getState: () => ({
      did: mockShared.did,
      signingInAs: mockShared.signingInAs,
      status: mockShared.connected ? 'connected' : 'disconnected',
    }),
    get isConnected() {
      return mockShared.connected
    },
    subscribe: (l: () => void) => {
      mockSharedListeners.add(l)
      return () => mockSharedListeners.delete(l)
    },
    beforeSignIn: (g: Guard) => {
      mockGuards.add(g)
      return () => mockGuards.delete(g)
    },
  },
  // The real one: what a listener keeps must be what the shared session keeps.
  unwrapBindingEnvelope: jest.requireActual('../module/vtiAgent').unwrapBindingEnvelope,
}))
jest.mock('../module/vtaAgent', () => ({
  vtaAgent: {
    getState: () => ({ link: { kind: 'linked', vtaDid: 'did:webvh:vta' } }),
    subscribe: () => () => undefined,
  },
}))
jest.mock('../module/vtiPersonaInbox', () => ({ keepForPersona: jest.fn() }))
jest.mock('../module/VtiMediatorTransport', () => ({}))
jest.mock('../module/vtiTsp', () => ({}))
jest.mock('../module/VtiIdentityStore', () => ({ GenericRecordsIdentityStore: jest.fn() }))

import { keepForPersona } from '../module/vtiPersonaInbox'
import {
  keepFromListener,
  LISTENER_RETRY_MS,
  listenerTargets,
  startIdentityListeners,
  type ListenerSession,
} from '../module/vtiIdentityListeners'

const persona = (name: string, over: Partial<VtiPersona> = {}): VtiPersona =>
  ({
    did: `did:webvh:${name}`,
    communityDid: `did:webvh:community-${name}`,
    vtaDid: 'did:webvh:vta',
    contextId: 'ctx',
    vtaKeyIds: { signing: 's', keyAgreement: 'k' },
    kmsKeyIds: { signing: 's', keyAgreement: 'k' },
    createdAt: '2026-10-03T00:00:00Z',
    ...over,
  }) as VtiPersona

// Enough turns for each step's deadline wrapper (a race and a finally) to settle.
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}
const sharedMoves = (next: Partial<typeof mockShared>) => {
  Object.assign(mockShared, next)
  mockSharedListeners.forEach((l) => l())
}

describe('which identities get a listener', () => {
  const a = persona('a')
  const b = persona('b')
  it('every identity of the linked agent, except the one the shared session is signed in or signing in as', () => {
    expect(listenerTargets([a, b], {}, 'did:webvh:vta')).toEqual([a, b])
    expect(listenerTargets([a, b], { did: a.did }, 'did:webvh:vta')).toEqual([b])
    expect(listenerTargets([a, b], { signingInAs: b.did }, 'did:webvh:vta')).toEqual([a])
  })
  it('not one whose key-agreement key is not borrowed yet, nor another agent’s, nor any without a linked agent', () => {
    const noKey = persona('c', { kmsKeyIds: { signing: 's' } })
    const other = persona('d', { vtaDid: 'did:webvh:other-vta' })
    expect(listenerTargets([a, noKey, other], {}, 'did:webvh:vta')).toEqual([a])
    expect(listenerTargets([a], {}, undefined)).toEqual([])
  })
})

describe('the listeners', () => {
  let opened: Map<string, { started: number; stopped: number }>
  let stops: Array<() => Promise<void>>
  const open = jest.fn(async (p: VtiPersona): Promise<ListenerSession> => {
    const rec = opened.get(p.did) ?? { started: 0, stopped: 0 }
    opened.set(p.did, rec)
    return {
      start: async () => void rec.started++,
      stop: async () => void rec.stopped++,
    }
  })
  const live = (did: string) => {
    const rec = opened.get(did)
    return Boolean(rec) && rec!.started > rec!.stopped
  }

  beforeEach(() => {
    opened = new Map()
    stops = []
    open.mockClear()
    Object.assign(mockShared, { did: undefined, signingInAs: undefined, connected: false })
    mockSharedListeners.clear()
    mockGuards.clear()
  })
  afterEach(async () => {
    for (const stop of stops) await stop()
  })
  const start = (personas: VtiPersona[], extra: Parameters<typeof startIdentityListeners>[1] = {}) => {
    const stop = startIdentityListeners({ config: { logger: {} } } as never, {
      open,
      personas: async () => personas,
      intervalMs: 3_600_000,
      ...extra,
    })
    stops.push(stop)
    return stop
  }

  it('open one per identity the shared session is not, and nothing for the shared one', async () => {
    const a = persona('a')
    const b = persona('b')
    sharedMoves({ did: a.did, connected: true })
    start([a, b])
    await flush()
    expect(live(a.did)).toBe(false)
    expect(live(b.did)).toBe(true)
  })

  it('hand an identity to the shared session: its listener is stopped before the sign-in, and comes back when the session leaves', async () => {
    const a = persona('a')
    const b = persona('b')
    sharedMoves({ did: a.did, connected: true })
    start([a, b])
    await flush()
    expect(live(b.did)).toBe(true)

    // The shared session is about to sign in as b: the guard runs first.
    expect(mockGuards.size).toBe(1)
    for (const guard of mockGuards) await guard(b.did)
    expect(live(b.did)).toBe(false)
    sharedMoves({ did: undefined, signingInAs: b.did, connected: false })
    await flush()
    // While the shared session signs in or holds b, b's listener stays off.
    expect(live(b.did)).toBe(false)
    sharedMoves({ did: b.did, signingInAs: undefined, connected: true })
    await flush()
    expect(live(b.did)).toBe(false)
    // a's listener has taken over a, which the shared session left.
    expect(live(a.did)).toBe(true)

    // The shared session leaves b: b's listener is back.
    sharedMoves({ did: a.did, connected: true })
    for (const guard of mockGuards) await guard(a.did)
    await flush()
    expect(live(b.did)).toBe(true)
    expect(live(a.did)).toBe(false)
  })

  it('close every listener when the app goes to the background, and open them again when it comes back', async () => {
    const handlers: Array<(s: string) => void> = []
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (s: string) => void) => {
      handlers.push(h)
      return { remove: () => undefined }
    }) as never)
    const a = persona('a')
    start([a])
    await flush()
    expect(live(a.did)).toBe(true)
    handlers.forEach((h) => h('background'))
    await flush()
    expect(live(a.did)).toBe(false)
    handlers.forEach((h) => h('active'))
    await flush()
    expect(live(a.did)).toBe(true)
    spy.mockRestore()
  })

  it('a listener that fails to open is tried again only after its wait', async () => {
    let clock = 1_000_000
    const failing = jest.fn(async (): Promise<ListenerSession> => {
      throw new Error('mediator unreachable')
    })
    const a = persona('a')
    const stop = startIdentityListeners({ config: { logger: {} } } as never, {
      open: failing,
      personas: async () => {
        return [a]
      },
      intervalMs: 3_600_000,
      now: () => clock,
    })
    stops.push(stop)
    await flush()
    expect(failing).toHaveBeenCalledTimes(1)
    sharedMoves({ did: 'did:webvh:nobody', connected: true })
    await flush()
    expect(failing).toHaveBeenCalledTimes(1)
    clock += LISTENER_RETRY_MS + 1
    sharedMoves({ did: 'did:webvh:somebody-else', connected: true })
    await flush()
    expect(failing).toHaveBeenCalledTimes(2)
  })

  it("a listener that failed for want of its key is tried at once when that identity's keys are held", async () => {
    const clock = 1_000_000
    let keyHeld = false
    const opening = jest.fn(async (p: VtiPersona): Promise<ListenerSession> => {
      if (!keyHeld) throw new Error(`Key with key id 'vta-copy:${p.did}' not found`)
      return open(p)
    })
    const a = persona('a')
    const stop = startIdentityListeners({ config: { logger: {} } } as never, {
      open: opening,
      personas: async () => [a],
      intervalMs: 3_600_000,
      now: () => clock,
    })
    stops.push(stop)
    await flush()
    expect(opening).toHaveBeenCalledTimes(1)
    expect(live(a.did)).toBe(false)
    // The keys come back well inside the wait.
    keyHeld = true
    DeviceEventEmitter.emit(VTI_PERSONA_KEYS_HELD_EVENT, { did: a.did })
    await flush()
    expect(opening).toHaveBeenCalledTimes(2)
    expect(live(a.did)).toBe(true)
  })

  // 233 candidate, 06:50:20Z: between the shared session's tries, a keys-held
  // retry reopened a listener for the identity it was signing in as.
  it('an identity handed to the shared session gets no listener between its tries, until it goes for another', async () => {
    const a = persona('a')
    const b = persona('b')
    sharedMoves({ did: a.did, connected: true })
    start([a, b])
    await flush()
    expect(live(b.did)).toBe(true)
    // The shared session goes for b: b's listener steps aside.
    for (const guard of mockGuards) await guard(b.did)
    // Its first try fails: neither signed in nor signing in, as b or anyone.
    sharedMoves({ did: undefined, signingInAs: undefined, connected: false })
    DeviceEventEmitter.emit(VTI_PERSONA_KEYS_HELD_EVENT, { did: b.did })
    await flush()
    expect(live(b.did)).toBe(false)
    expect(live(a.did)).toBe(true)
    // It goes for a instead: b is free again.
    for (const guard of mockGuards) await guard(a.did)
    sharedMoves({ did: a.did, connected: true })
    await flush()
    expect(live(b.did)).toBe(true)
    expect(live(a.did)).toBe(false)
  })

  // 233 head, Prague lane row 6: a listener that failed once was never tried
  // again for 17 min. Reconciles run one at a time, so one step that never
  // finished held every later one. Every step now has a deadline, and a failed
  // listener schedules its own retry.
  const realSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  it('an identities read that never answers does not hold up the reconciles after it', async () => {
    const a = persona('a')
    let calls = 0
    const stop = startIdentityListeners({ config: { logger: {} } } as never, {
      open,
      personas: () => (++calls === 1 ? new Promise<VtiPersona[]>(() => undefined) : Promise.resolve([a])),
      intervalMs: 3_600_000,
      deadlines: { personasMs: 30 },
    })
    stops.push(stop)
    await realSleep(60)
    // The next trigger reconciles at once, past the read that never answered.
    sharedMoves({ did: 'did:webvh:elsewhere', connected: true })
    await realSleep(20)
    expect(calls).toBeGreaterThanOrEqual(2)
    expect(live(a.did)).toBe(true)
  })

  it('a listener that failed is tried again at the end of its wait, with nothing else happening', async () => {
    const a = persona('a')
    let tries = 0
    const flaky = jest.fn(async (p: VtiPersona): Promise<ListenerSession> => {
      if (++tries === 1) throw new Error('key not held yet')
      return open(p)
    })
    const stop = startIdentityListeners({ config: { logger: {} } } as never, {
      open: flaky,
      personas: async () => [a],
      intervalMs: 3_600_000,
      retryMs: 30,
    })
    stops.push(stop)
    await realSleep(10)
    expect(live(a.did)).toBe(false)
    await realSleep(80)
    expect(flaky).toHaveBeenCalledTimes(2)
    expect(live(a.did)).toBe(true)
  })

  it('an open that never answers counts as failed after its deadline, and is tried again', async () => {
    const a = persona('a')
    let tries = 0
    const hanging = jest.fn((p: VtiPersona): Promise<ListenerSession> => {
      if (++tries === 1) return new Promise<ListenerSession>(() => undefined)
      return open(p)
    })
    const stop = startIdentityListeners({ config: { logger: {} } } as never, {
      open: hanging,
      personas: async () => [a],
      intervalMs: 3_600_000,
      retryMs: 20,
      deadlines: { openMs: 30 },
    })
    stops.push(stop)
    await realSleep(120)
    expect(hanging).toHaveBeenCalledTimes(2)
    expect(live(a.did)).toBe(true)
  })

  it('stopping closes them all and removes the sign-in guard', async () => {
    const a = persona('a')
    const b = persona('b')
    const stop = start([a, b])
    await flush()
    expect(live(a.did) && live(b.did)).toBe(true)
    await stop()
    expect(live(a.did) || live(b.did)).toBe(false)
    expect(mockGuards.size).toBe(0)
  })
})

describe('what a listener keeps', () => {
  // 233 candidate: a removal notice arrived in the binding envelope, matched
  // nothing by its outer type, and was neither applied nor reported.
  it('a Trust Task in the binding envelope is kept as the task itself, as the shared session keeps it', async () => {
    const keep = keepForPersona as jest.Mock
    keep.mockClear()
    const a = persona('a')
    const envelope = {
      id: 'm1',
      type: 'https://trusttasks.org/binding/didcomm/0.1/envelope',
      body: { type: 'https://trusttasks.org/spec/vtc/members/removal-notice/0.1', payload: { did: a.did } },
    }
    await keepFromListener({ config: { logger: {} } } as never, a, envelope as never, 'didcomm')
    expect(keep).toHaveBeenCalledWith(
      expect.anything(),
      a,
      expect.objectContaining({
        type: 'https://trusttasks.org/spec/vtc/members/removal-notice/0.1',
        body: envelope.body,
      })
    )
  })

  it('a message not in the envelope is kept as it came', async () => {
    const keep = keepForPersona as jest.Mock
    keep.mockClear()
    const plain = { id: 'm2', type: 'https://example.org/plain', body: {} }
    await keepFromListener({ config: { logger: {} } } as never, persona('a'), plain as never, 'tsp')
    expect(keep).toHaveBeenCalledWith(expect.anything(), expect.anything(), plain)
  })
})
