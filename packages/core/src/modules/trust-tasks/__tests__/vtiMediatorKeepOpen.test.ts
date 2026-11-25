/**
 * A listening session keeps its socket. Measured 2026-11-24, 281's live mailbox check: phone B's mailbox socket
 * closed (1006) with nothing left to send on it, the transport said "it reopens on the next send", no send ever came,
 * and phone A's offer sat queued at the mediator for the rest of the run. The rule was right for a VTA session,
 * which is driven by what it asks, and wrong for a mailbox, whose whole job is to listen.
 *
 * Also here: a drain's queued copy of the mediator's own answer to an `ask` (its live copy is taken by the asker and
 * deliberately not acknowledged) is taken or dropped as on the live path and acknowledged, never handed on — the
 * same check found every such copy logged by the mailbox as a dropped envelope, which read as lost mail.
 *
 * And: a message is remembered only once its consumer has settled, so the live copy and the first drain's copy of
 * the same forward (80 ms apart in the same check) were both handed on. A copy of a message being taken is left
 * alone; the taker acknowledges it.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import {
  DELIVERY_POLL_MS,
  REOPEN_BACKOFF_MAX_MS,
  REOPEN_BACKOFF_MIN_MS,
  REOPEN_STABLE_MS,
  VtiMediatorSession,
  type VtiClientIdentity,
  type VtiMediatorEndpoints,
} from '../module/VtiMediatorTransport'

const identity: VtiClientIdentity = { did: 'did:peer:2:phone', kid: 'did:peer:2:phone#key-2', senderKey: {} as never }
const mediator: VtiMediatorEndpoints = {
  did: 'did:peer:2:mediator',
  authEndpoint: 'https://mediator.example/mediator/v1',
  wsEndpoint: 'wss://mediator.example/mediator/v1/ws',
  publicJwk: {} as never,
  kid: 'did:peer:2:mediator#key-1',
}
const agent = {
  config: { logger: { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined } },
  context: {},
  dependencyManager: { resolve: () => ({ pack: async (_c: unknown, plaintext: unknown) => plaintext }) },
} as never

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (name: string, inSec: number) =>
  `${b64url({ alg: 'EdDSA' })}.${b64url({ sub: name, exp: Math.floor(Date.now() / 1000) + inSec })}.sig`

/** The mediator's sockets: each opens on the next tick; the test ends one with `serverClose`. */
function mediatorSockets() {
  const opened: string[] = []
  const frames: { token: string; frame: unknown }[] = []
  const live: FakeSocket[] = []
  class FakeSocket {
    readyState = 0
    onmessage: unknown
    private listeners: Record<string, ((e?: unknown) => void)[]> = {}
    token: string
    constructor(_url: string, protocols: string[]) {
      this.token = (protocols.find((p) => p.startsWith('bearer.')) ?? '').slice('bearer.'.length)
      opened.push(this.token)
      live.push(this)
      setTimeout(() => {
        this.readyState = 1
        this.emit('open')
      }, 0)
    }
    emit(name: string, e?: unknown) {
      const listeners = [...(this.listeners[name] ?? [])]
      listeners.forEach((f) => f(e))
    }
    /** The far end (or the OS) ends the socket: a close event, as React Native delivers one. */
    serverClose(code = 1006, reason = 'Software caused connection abort') {
      if (this.readyState === 3) return
      this.readyState = 3
      this.emit('close', { code, reason })
    }
    addEventListener(name: string, fn: (e?: unknown) => void) {
      const listeners = (this.listeners[name] ??= [])
      listeners.push(fn)
    }
    removeEventListener(name: string, fn: (e?: unknown) => void) {
      this.listeners[name] = (this.listeners[name] ?? []).filter((f) => f !== fn)
    }
    send(frame: unknown) {
      if (this.readyState !== 1) throw new Error('INVALID_STATE_ERR')
      frames.push({ token: this.token, frame })
    }
    close() {
      this.readyState = 3
    }
  }
  return { FakeSocket, opened, frames, live }
}

function stubLogin(token: string) {
  global.fetch = (async (url: string) => {
    if (String(url).endsWith('/challenge')) {
      return { status: 200, text: async () => JSON.stringify({ data: { challenge: 'c', session_id: 's' } }) }
    }
    return { status: 200, json: async () => ({ data: { access_token: token } }) }
  }) as never
}

const LIVE_DELIVERY_CHANGE = 'https://didcomm.org/messagepickup/3.0/live-delivery-change'
/** Frames go out as JSON text (the pack stub returns the plaintext, so the text is the plaintext). */
const liveDeliveryChanges = (frames: { frame: unknown }[]) =>
  frames.filter((f) => {
    if (typeof f.frame !== 'string') return false
    try {
      return (JSON.parse(f.frame) as { type?: string })?.type === LIVE_DELIVERY_CHANGE
    } catch {
      return false
    }
  }).length

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('VtiMediatorSession — a socket that closes under a listening session', () => {
  const realWebSocket = global.WebSocket
  const realFetch = global.fetch
  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    warn.mockRestore()
    global.WebSocket = realWebSocket
    global.fetch = realFetch
  })
  const said = () => warn.mock.calls.map(([line]) => String(line)).join('\n')

  test('a keepOpen session reopens it on its own and asks for live delivery again, with nothing to send', async () => {
    const m = mediatorSockets()
    global.WebSocket = m.FakeSocket as never
    stubLogin(jwt('t', 900))
    const session = new VtiMediatorSession(agent, identity, mediator, { keepOpen: true })
    await session.start()
    expect(m.opened).toHaveLength(1)
    expect(liveDeliveryChanges(m.frames)).toBe(1)

    m.live[0].serverClose()
    expect(session.isOpen).toBe(false)
    expect(said()).toMatch(/closed \(1006 Software caused connection abort\); reopening in 1000 ms/)
    // Nothing is sent. The reopen is the session's own, after the backoff.
    await sleep(REOPEN_BACKOFF_MIN_MS + 300)
    expect(m.opened).toHaveLength(2)
    expect(session.isOpen).toBe(true)
    expect(liveDeliveryChanges(m.frames)).toBe(2)
    await session.stop()
  })

  test('CONTROL: a session without keepOpen (every VTA session) leaves a closed socket for its next send, as before', async () => {
    const m = mediatorSockets()
    global.WebSocket = m.FakeSocket as never
    stubLogin(jwt('t', 900))
    const session = new VtiMediatorSession(agent, identity, mediator, {})
    await session.start()
    m.live[0].serverClose()
    expect(said()).toMatch(/closed \(1006 Software caused connection abort\); it reopens on the next send/)
    await sleep(REOPEN_BACKOFF_MIN_MS + 300)
    expect(m.opened).toHaveLength(1)
    expect(session.isOpen).toBe(false)
    await session.stop()
  })

  test('CONTROL: a stopped keepOpen session never reopens, whether it is closed after the stop or while a reopen is due', async () => {
    const m = mediatorSockets()
    global.WebSocket = m.FakeSocket as never
    stubLogin(jwt('t', 900))
    // Closed, a reopen due in a second, then stopped before it: the reopen is cancelled.
    const first = new VtiMediatorSession(agent, identity, mediator, { keepOpen: true })
    await first.start()
    m.live[0].serverClose()
    expect(said()).toMatch(/reopening in 1000 ms/)
    await first.stop()
    // Stopped, then the far end closes what stop() already closed: nothing is said, nothing reopens.
    const second = new VtiMediatorSession(agent, identity, mediator, { keepOpen: true })
    await second.start()
    const socket = m.live[1]
    await second.stop()
    const saidBeforeClose = warn.mock.calls.length
    socket.serverClose()
    await sleep(REOPEN_BACKOFF_MIN_MS + 300)
    expect(m.opened).toHaveLength(2)
    expect(warn.mock.calls).toHaveLength(saidBeforeClose)
    // The one "reopening in" is the first session's, said at its close and cancelled by its stop.
    expect(said().match(/reopening in/g)).toHaveLength(1)
  })

  test('CONTROL: a socket that closes under start() itself arms no reopen; start throws and nothing comes back', async () => {
    const m = mediatorSockets()
    // The mediator drops the socket as soon as the first frame (live-delivery-change) is sent on it: the 1006 of
    // the 281 run, here before start() has returned. A failed start leaves no session running.
    const Dropping = class extends m.FakeSocket {
      send(frame: unknown) {
        this.serverClose(1006, 'dropped on the first frame')
        super.send(frame)
      }
    }
    global.WebSocket = Dropping as never
    stubLogin(jwt('t', 900))
    const session = new VtiMediatorSession(agent, identity, mediator, { keepOpen: true })
    await expect(session.start()).rejects.toThrow()
    expect(said()).toMatch(/closed \(1006 dropped on the first frame\); while starting/)
    expect(said()).not.toMatch(/reopening in/)
    await sleep(REOPEN_BACKOFF_MIN_MS + 300)
    expect(m.opened).toHaveLength(1)
    expect(session.isOpen).toBe(false)
    await session.stop()
  })
})

describe('VtiMediatorSession — a mediator that answers and then drops every socket', () => {
  const realWebSocket = global.WebSocket
  const realFetch = global.fetch
  let warn: jest.SpyInstance
  beforeEach(() => {
    jest.useFakeTimers()
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    warn.mockRestore()
    jest.useRealTimers()
    global.WebSocket = realWebSocket
    global.fetch = realFetch
  })
  const said = () => warn.mock.calls.map(([line]) => String(line)).join('\n')

  test('the waits double on every short-lived socket, and a socket that lived REOPEN_STABLE_MS resets them', async () => {
    const m = mediatorSockets()
    global.WebSocket = m.FakeSocket as never
    stubLogin(jwt('t', 900))
    const session = new VtiMediatorSession(agent, identity, mediator, { keepOpen: true })
    const started = session.start()
    await jest.advanceTimersByTimeAsync(10)
    await started
    expect(m.opened).toHaveLength(1)

    // Each socket is heard (the mediator's status answering live-delivery-change arrives) and then dropped at once.
    const live = () => m.live[m.live.length - 1]
    const hear = () => {
      const socket = live() as unknown as { onmessage?: (e: { data: string }) => void }
      socket.onmessage?.({ data: JSON.stringify({ type: 'https://didcomm.org/messagepickup/3.0/status', body: {} }) })
    }

    hear()
    live().serverClose()
    expect(said()).toMatch(/reopening in 1000 ms/)
    await jest.advanceTimersByTimeAsync(REOPEN_BACKOFF_MIN_MS + 10)
    expect(m.opened).toHaveLength(2)
    hear()
    live().serverClose()
    expect(said()).toMatch(/reopening in 2000 ms/)
    await jest.advanceTimersByTimeAsync(REOPEN_BACKOFF_MIN_MS * 2 + 10)
    expect(m.opened).toHaveLength(3)
    hear()
    live().serverClose()
    expect(said()).toMatch(/reopening in 4000 ms/)
    await jest.advanceTimersByTimeAsync(REOPEN_BACKOFF_MIN_MS * 4 + 10)
    expect(m.opened).toHaveLength(4)

    // This socket lives a minute (its open time set back by REOPEN_STABLE_MS, standing in for the minute: advancing
    // the clock that far would run the poll's own silent-poll reopen, which no fake mediator answers here), then
    // closes: the wait is back at the start.
    ;(session as unknown as { socketOpenedAt: number }).socketOpenedAt -= REOPEN_STABLE_MS
    live().serverClose()
    expect(said().match(/reopening in 1000 ms/g)).toHaveLength(2)
    await session.stop()
  })
})

describe('VtiMediatorSession — the reopen schedule itself (no sockets)', () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    jest.useFakeTimers()
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    warn.mockRestore()
    jest.useRealTimers()
  })

  type Internals = {
    scheduleReopen: () => void
    reopen: jest.Mock<Promise<void>, []>
    reopenDelayMs: number
    socket?: { readyState: number; close: () => void }
    options: { keepOpen?: boolean; onError?: jest.Mock }
  }
  const scheduler = (keepOpen: boolean, reopen: () => Promise<void>) => {
    const onError = jest.fn()
    const session = new VtiMediatorSession(agent, identity, mediator, { keepOpen, onError })
    const internals = session as unknown as Internals
    internals.reopen = jest.fn(reopen)
    return { session, internals, onError }
  }

  test('a reopen that fails doubles the wait, up to the cap, and is reported each time', async () => {
    const { session, internals, onError } = scheduler(true, () => Promise.reject(new Error('offline')))
    internals.scheduleReopen()
    expect(internals.reopen).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(REOPEN_BACKOFF_MIN_MS)
    expect(internals.reopen).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(REOPEN_BACKOFF_MIN_MS * 2)
    expect(internals.reopen).toHaveBeenCalledTimes(2)
    await jest.advanceTimersByTimeAsync(REOPEN_BACKOFF_MIN_MS * 4)
    expect(internals.reopen).toHaveBeenCalledTimes(3)
    // Keeps doubling, then holds at the cap.
    for (let i = 0; i < 12; i++) await jest.advanceTimersByTimeAsync(REOPEN_BACKOFF_MAX_MS)
    expect(internals.reopenDelayMs).toBe(REOPEN_BACKOFF_MAX_MS)
    const calls = internals.reopen.mock.calls.length
    await jest.advanceTimersByTimeAsync(REOPEN_BACKOFF_MAX_MS)
    expect(internals.reopen.mock.calls).toHaveLength(calls + 1)
    await session.stop()
  })

  test('one reopen at a time: scheduling twice runs it once', async () => {
    const { session, internals } = scheduler(true, () => Promise.resolve())
    internals.scheduleReopen()
    internals.scheduleReopen()
    await jest.advanceTimersByTimeAsync(REOPEN_BACKOFF_MIN_MS)
    expect(internals.reopen).toHaveBeenCalledTimes(1)
    await session.stop()
  })

  test('the backstop poll reopens a keepOpen session whose socket is found closed, and leaves another session alone', async () => {
    for (const keepOpen of [true, false]) {
      const { session, internals } = scheduler(keepOpen, () => Promise.resolve())
      const live = session as unknown as {
        startLiveDelivery: () => Promise<void>
        sendOnSocket: () => Promise<void>
        requestDelivery: () => Promise<void>
      }
      // The poll as a start arms it, over a socket that then dies without any close event (readyState 3, nothing fired).
      live.sendOnSocket = async () => undefined
      live.requestDelivery = async () => undefined
      internals.socket = { readyState: 1, close: () => undefined }
      await live.startLiveDelivery()
      internals.socket = { readyState: 3, close: () => undefined }
      await jest.advanceTimersByTimeAsync(DELIVERY_POLL_MS)
      await jest.advanceTimersByTimeAsync(REOPEN_BACKOFF_MIN_MS)
      expect(internals.reopen).toHaveBeenCalledTimes(keepOpen ? 1 : 0)
      await session.stop()
    }
  })
})

describe('VtiMediatorSession — a drain that carries the mediator’s own answers', () => {
  const ENVELOPE = 'https://trusttasks.org/binding/didcomm/0.1/envelope'
  const DELIVERY = 'https://didcomm.org/messagepickup/3.0/delivery'
  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => warn.mockRestore())
  const said = () => warn.mock.calls.map(([line]) => String(line)).join('\n')

  type Internals = {
    unpack: (jwe: unknown) => Promise<unknown>
    acknowledge: (ids: string[]) => Promise<void>
    handleDelivery: (d: unknown) => Promise<void>
    asks: Map<
      string,
      { resolve: (a: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
    >
  }
  function drainWith(byId: Record<string, Record<string, unknown>>) {
    const onMessage = jest.fn(async () => undefined)
    const session = new VtiMediatorSession(agent, identity, mediator, { onMessage: onMessage as never })
    const internals = session as unknown as Internals
    internals.unpack = async (jwe) => byId[(jwe as { marker: string }).marker]
    const acknowledge = jest.fn(async () => undefined)
    internals.acknowledge = acknowledge
    const attach = (id: string) => ({ id, data: { json: { marker: id, protected: 'e30' } } })
    const drain = (ids: string[]) => internals.handleDelivery({ type: DELIVERY, attachments: ids.map(attach) })
    return { session, internals, onMessage, acknowledge, drain }
  }

  test('an answer still waited for settles its ask; one no longer waited for is dropped; both acknowledged, neither handed on', async () => {
    const s = drainWith({
      a: { id: 'a', type: ENVELOPE, from: mediator.did, thid: 'ask-1', body: { ok: true } },
      b: { id: 'b', type: ENVELOPE, from: mediator.did, thid: 'ask-gone', body: { ok: true } },
    })
    const resolve = jest.fn()
    s.internals.asks.set('ask-1', { resolve, reject: jest.fn(), timer: setTimeout(() => undefined, 60_000) })
    await s.drain(['a', 'b'])
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
    expect(s.internals.asks.has('ask-1')).toBe(false)
    expect(s.onMessage).not.toHaveBeenCalled()
    expect(s.acknowledge).toHaveBeenCalledWith(['a', 'b'])
    expect(said()).toMatch(
      /drained 2 queued .*: 0 taken, 0 dropped as never openable, 0 left queued, 2 the mediator's own answers/
    )
  })

  test('CONTROL: a queued envelope from anyone else is handed on as before, and counted as taken', async () => {
    const s = drainWith({
      p: { id: 'p', type: ENVELOPE, from: 'did:peer:2:someone', body: {} },
    })
    await s.drain(['p'])
    expect(s.onMessage).toHaveBeenCalledTimes(1)
    expect(s.onMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'p' }))
    expect(s.acknowledge).toHaveBeenCalledWith(['p'])
    expect(said()).toMatch(/drained 1 queued .*: 1 taken, 0 dropped as never openable, 0 left queued$/m)
  })
})

describe('VtiMediatorSession — the same message live and in a drain, while its consumer still runs', () => {
  const ENVELOPE = 'https://trusttasks.org/binding/didcomm/0.1/envelope'
  const DELIVERY = 'https://didcomm.org/messagepickup/3.0/delivery'
  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => warn.mockRestore())

  type Internals = {
    unpack: (jwe: unknown) => Promise<unknown>
    acknowledge: (ids: string[]) => Promise<void>
    handleFrame: (raw: string) => Promise<void>
    handleDelivery: (d: unknown) => Promise<void>
  }

  test('the drain copy is left queued and not handed on; the live copy is handed on once and acknowledged once', async () => {
    // The live frame as the mediator streams it; the mediator ids the stored copy by sha256 of these bytes.
    const raw = JSON.stringify({ marker: 'f', protected: 'e30', ciphertext: 'x' })
    const queueId = bytesToHex(sha256(utf8ToBytes(raw)))
    let settle: () => void = () => undefined
    const onMessage = jest.fn(() => new Promise<void>((resolve) => (settle = resolve)))
    const session = new VtiMediatorSession(agent, identity, mediator, { onMessage: onMessage as never })
    const internals = session as unknown as Internals
    internals.unpack = async () => ({ id: 'f', type: ENVELOPE, from: 'did:peer:2:someone', body: {} })
    const acknowledge = jest.fn(async () => undefined)
    internals.acknowledge = acknowledge

    const live = internals.handleFrame(raw)
    await Promise.resolve()
    expect(onMessage).toHaveBeenCalledTimes(1)
    // The first drain answers with the same message, 80 ms later on the phone, here before the consumer settles.
    await internals.handleDelivery({
      type: DELIVERY,
      attachments: [{ id: queueId, data: { json: { marker: 'f', protected: 'e30' } } }],
    })
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(acknowledge).not.toHaveBeenCalled()
    expect(warn.mock.calls.map(([l]) => String(l)).join('\n')).toMatch(
      /drained 1 queued .*: 0 taken, 0 dropped as never openable, 1 left queued$/m
    )

    settle()
    await live
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(acknowledge).toHaveBeenCalledTimes(1)
    expect(acknowledge).toHaveBeenCalledWith([queueId])
    // Once settled, a late copy is a plain repeat: acknowledged, not handed on.
    await internals.handleDelivery({
      type: DELIVERY,
      attachments: [{ id: queueId, data: { json: { marker: 'f', protected: 'e30' } } }],
    })
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(acknowledge).toHaveBeenCalledTimes(2)
  })

  test('CONTROL: a consumer that throws on the live copy leaves the message for the drain, which hands it on', async () => {
    const raw = JSON.stringify({ marker: 'g', protected: 'e30', ciphertext: 'x' })
    const queueId = bytesToHex(sha256(utf8ToBytes(raw)))
    const onMessage = jest.fn().mockRejectedValueOnce(new Error('store busy')).mockResolvedValue(undefined)
    const onError = jest.fn()
    const session = new VtiMediatorSession(agent, identity, mediator, { onMessage: onMessage as never, onError })
    const internals = session as unknown as Internals
    internals.unpack = async () => ({ id: 'g', type: ENVELOPE, from: 'did:peer:2:someone', body: {} })
    const acknowledge = jest.fn(async () => undefined)
    internals.acknowledge = acknowledge

    await internals.handleFrame(raw)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(acknowledge).not.toHaveBeenCalled()
    await internals.handleDelivery({
      type: DELIVERY,
      attachments: [{ id: queueId, data: { json: { marker: 'g', protected: 'e30' } } }],
    })
    expect(onMessage).toHaveBeenCalledTimes(2)
    expect(acknowledge).toHaveBeenCalledWith([queueId])
  })
})
