/**
 * A listener for every identity of this phone that the shared session is not
 * signed in as (IN-102): which identities get one, the handover to the shared
 * session (one live connection per DID at a mediator), the background, and
 * retries.
 */
import { AppState } from 'react-native'

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

import {
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

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
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
