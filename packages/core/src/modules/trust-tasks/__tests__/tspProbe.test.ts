/**
 * The TSP 1.0 probe's policy (cutover plan §6.2 and its approval changes):
 * at most one probe per peer per hour whatever the outcome, a day's back-off
 * after a probe the peer ignored while answering otherwise, "inconclusive"
 * when the peer answered nothing at all, and the TSP 1.0 record carrying its
 * own expiry.
 */
import {
  MemoryTspProbeStore,
  TSP_PROBE_MIN_INTERVAL_MS,
  TSP_PROBE_TIMEOUT_MS,
  TSP_PROBE_UNANSWERED_BACKOFF_MS,
  probeAllowed,
  probeRecord,
  runTspProbe,
  type TspProbeRun,
} from '../module/tspProbe'
import { MemoryTspPeerRevisionStore, V1_RECORD_TTL_MS, isFreshV1 } from '../module/vtiTsp'

const HOUR = 60 * 60 * 1000

// Probe outcomes are Release lines (`releaseWarn`, console.warn).
const released: string[] = []
let warnSpy: jest.SpyInstance
beforeEach(() => {
  released.length = 0
  warnSpy = jest.spyOn(console, 'warn').mockImplementation((m: unknown) => void released.push(String(m)))
})
afterEach(() => warnSpy.mockRestore())
const T0 = Date.parse('2026-10-23T12:00:00Z')

function probeRun(overrides: Partial<TspProbeRun> & { at: number; store: MemoryTspProbeStore }) {
  const logger = { info: jest.fn(), debug: jest.fn() }
  const send = jest.fn(async () => undefined)
  const onAnswered = jest.fn()
  const run: TspProbeRun = {
    did: 'did:example:vta',
    serviceId: 'did:example:vta#tsp',
    logger,
    send,
    waitForAnswer: async () => false,
    peerAnsweredOtherwise: () => false,
    onAnswered,
    now: () => overrides.at,
    ...overrides,
  }
  return { run, logger, send, onAnswered }
}

describe('what a probe outcome leaves', () => {
  it('answered and inconclusive: the next probe no sooner than an hour; unanswered: a day', () => {
    expect(Date.parse(probeRecord('d', 'answered', undefined, T0).notBefore) - T0).toBe(TSP_PROBE_MIN_INTERVAL_MS)
    expect(Date.parse(probeRecord('d', 'inconclusive', undefined, T0).notBefore) - T0).toBe(TSP_PROBE_MIN_INTERVAL_MS)
    expect(Date.parse(probeRecord('d', 'started', undefined, T0).notBefore) - T0).toBe(TSP_PROBE_MIN_INTERVAL_MS)
    expect(Date.parse(probeRecord('d', 'unanswered', undefined, T0).notBefore) - T0).toBe(
      TSP_PROBE_UNANSWERED_BACKOFF_MS
    )
    expect(TSP_PROBE_MIN_INTERVAL_MS).toBe(HOUR)
    expect(TSP_PROBE_UNANSWERED_BACKOFF_MS).toBe(24 * HOUR)
    expect(TSP_PROBE_TIMEOUT_MS).toBe(15_000)
  })

  it('never within the hour, whatever the outcome — inconclusive included', () => {
    for (const outcome of ['started', 'answered', 'unanswered', 'inconclusive'] as const) {
      const record = probeRecord('d', outcome, 'did:d#tsp', T0)
      expect([outcome, probeAllowed(record, 'did:d#tsp', T0 + HOUR - 1)]).toEqual([outcome, false])
      // Not even for a changed service: the hour holds.
      expect([outcome, probeAllowed(record, 'did:d#tsp2', T0 + HOUR - 1)]).toEqual([outcome, false])
    }
  })

  it('after the hour, again — except after "unanswered", which waits a day unless the TSP service changed', () => {
    expect(probeAllowed(probeRecord('d', 'inconclusive', 's', T0), 's', T0 + HOUR)).toBe(true)
    expect(probeAllowed(probeRecord('d', 'answered', 's', T0), 's', T0 + HOUR)).toBe(true)
    const unanswered = probeRecord('d', 'unanswered', 's', T0)
    expect(probeAllowed(unanswered, 's', T0 + HOUR)).toBe(false)
    expect(probeAllowed(unanswered, 's', T0 + 24 * HOUR)).toBe(true)
    expect(probeAllowed(unanswered, 's-moved', T0 + HOUR)).toBe(true)
    expect(probeAllowed(undefined, 's', T0)).toBe(true)
  })

  it('a record whose dates cannot be read blocks nothing (read as no record)', () => {
    const broken = { did: 'd', outcome: 'unanswered' as const, at: 'yesterday', notBefore: 'soon' }
    expect(probeAllowed(broken, 's', T0)).toBe(true)
    expect(probeAllowed({ ...probeRecord('d', 'answered', 's', T0), notBefore: 'x' }, 's', T0 + 1)).toBe(true)
  })
})

describe('running a probe', () => {
  it('answered: sends once, says so at Info, records it, and moves the session to TSP 1.0', async () => {
    const store = new MemoryTspProbeStore()
    const { run, logger, send, onAnswered } = probeRun({ at: T0, store, waitForAnswer: async () => true })
    expect(await runTspProbe(run)).toBe('answered')
    expect(send).toHaveBeenCalledTimes(1)
    expect(onAnswered).toHaveBeenCalledTimes(1)
    expect(store.records.get('did:example:vta')).toMatchObject({
      outcome: 'answered',
      serviceId: 'did:example:vta#tsp',
    })
    expect(logger.info).not.toHaveBeenCalled()
    expect(released.join('\n')).toMatch(/answered a TSP 1\.0 probe in \d+ ms — TSP 1\.0 for this session/)
  })

  it('silent while the peer answered otherwise: "unanswered", a day before the next one', async () => {
    const store = new MemoryTspProbeStore()
    const { run, logger, onAnswered } = probeRun({ at: T0, store, peerAnsweredOtherwise: () => true })
    expect(await runTspProbe(run)).toBe('unanswered')
    expect(onAnswered).not.toHaveBeenCalled()
    expect(Date.parse(store.records.get('did:example:vta')!.notBefore) - T0).toBe(24 * HOUR)
    expect(logger.info).not.toHaveBeenCalled()
    expect(released.join('\n')).toContain(
      'did not answer a TSP 1.0 probe in 15 s — DIDComm for this session (unanswered)'
    )
  })

  it('silent, and the peer answered nothing at all: "inconclusive" — it may be down; only the hourly cap', async () => {
    const store = new MemoryTspProbeStore()
    const { run } = probeRun({ at: T0, store })
    expect(await runTspProbe(run)).toBe('inconclusive')
    expect(Date.parse(store.records.get('did:example:vta')!.notBefore) - T0).toBe(HOUR)
  })

  it("a send that fails is our failure, not the peer's silence: inconclusive even when the peer answered otherwise", async () => {
    const store = new MemoryTspProbeStore()
    const waitForAnswer = jest.fn(async () => false)
    const { run } = probeRun({
      at: T0,
      store,
      peerAnsweredOtherwise: () => true,
      waitForAnswer,
      send: async () => {
        throw new Error('socket closed')
      },
    })
    expect(await runTspProbe(run)).toBe('inconclusive')
    expect(waitForAnswer).not.toHaveBeenCalled()
    expect(Date.parse(store.records.get('did:example:vta')!.notBefore) - T0).toBe(HOUR)
  })

  it('a reconnect storm: the record is written before anything is sent, so a second session finds it and skips', async () => {
    const store = new MemoryTspProbeStore()
    let release: (answered: boolean) => void = () => undefined
    const first = probeRun({
      at: T0,
      store,
      waitForAnswer: () => new Promise<boolean>((resolve) => (release = resolve)),
    })
    const running = runTspProbe(first.run)
    await new Promise((resolve) => setImmediate(resolve))
    expect(store.records.get('did:example:vta')?.outcome).toBe('started')
    // Reconnects every few minutes for the next hour: none probes again.
    for (const minutes of [2, 5, 20, 59]) {
      const again = probeRun({ at: T0 + minutes * 60 * 1000, store })
      expect(await runTspProbe(again.run)).toBe('skipped')
      expect(again.send).not.toHaveBeenCalled()
    }
    // A skip is the cap working: nothing said in Release.
    expect(released).toHaveLength(0)
    release(false)
    expect(await running).toBe('inconclusive')
  })
})

describe('the TSP 1.0 record carries its own expiry', () => {
  it('written when the 1.0 frame is recorded: seven days on, and fresh until then', async () => {
    const store = new MemoryTspPeerRevisionStore()
    const before = new Date().valueOf()
    const record = await store.observe('did:example:vtc', 'v1', 0)
    const expiresAt = Date.parse(record.expiresAt!)
    expect(expiresAt - before).toBeGreaterThanOrEqual(V1_RECORD_TTL_MS)
    expect(expiresAt - before).toBeLessThan(V1_RECORD_TTL_MS + 60_000)
    expect(isFreshV1(record, expiresAt - 1)).toBe(true)
    expect(isFreshV1(record, expiresAt)).toBe(false)
  })

  it('a later change to the window does not stretch a record already held: freshness reads the record, not the constant', () => {
    const held = {
      vid: 'did:x',
      revision: 'v1' as const,
      firstSeenAt: '2026-10-01T00:00:00Z',
      lastSeenAt: '2026-10-01T00:00:00Z',
      expiresAt: '2026-10-08T00:00:00Z',
    }
    expect(isFreshV1(held, Date.parse('2026-10-09T00:00:00Z'))).toBe(false)
  })

  it('no expiry for a Rev 3 record, and a Rev 3 record is never fresh 1.0', async () => {
    const record = await new MemoryTspPeerRevisionStore().observe('did:x', 'rev3', 2)
    expect(record.expiresAt).toBeUndefined()
    expect(isFreshV1(record)).toBe(false)
  })

  it('marked stale after an unanswered TSP 1.0 ask; the next 1.0 frame makes it fresh again', async () => {
    const store = new MemoryTspPeerRevisionStore()
    await store.observe('did:x', 'v1', 0)
    await store.markStale('did:x')
    expect(isFreshV1(await store.get('did:x'))).toBe(false)
    await store.observe('did:x', 'v1', 0)
    expect(isFreshV1(await store.get('did:x'))).toBe(true)
  })
})
