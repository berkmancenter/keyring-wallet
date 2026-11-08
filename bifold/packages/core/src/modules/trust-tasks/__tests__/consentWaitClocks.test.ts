/**
 * A task the agent holds for consent waits for an approver, re-asking about every 8 s (VtaClient.task). In a store
 * build that wait is three minutes. A gate row that holds a link's key swap on purpose (linkfail's held rows) waited
 * all of it and re-asked about twenty-two times, each one a request the runner agent had to store (IN-560). A test
 * build with `E2E_CLOCKS=short` waits 20 s instead, clear of its 30 s auto-lock; every other build, the store build first, keeps the
 * three minutes.
 */
import Config from 'react-native-config'

import { SHORT_AUTO_LOCK_MINUTES, SHORT_CONSENT_WAIT_MS, effectiveConsentWaitMs } from '../../../utils/e2eClocks'
import { CONSENT_WAIT_MS } from '../clocks'
import { VtaClient } from '../module/VtaClient'
import { VtiRefusal } from '../module/vtiAgent'

jest.mock('react-native-config', () => ({ __esModule: true, default: {} }))

const config = Config as Record<string, string | undefined>
const VTA = 'did:webvh:QmVta:dids.example:keyring-runner-vta'
const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }
const agent = { config: { logger } } as never
const SWAP = 'https://trusttasks.org/spec/acl/swap-key/0.1'

const held = () =>
  new VtiRefusal('taskFailed', 'task failed: auth:consent_required', {
    reason: 'auth:consent_required',
    payloadDigest: 'digest-swap',
  })

/** Hold one task for consent no approver gives; how long it waited and how many times it asked again. */
async function holdUntilGivenUp(options: { consentWaitMs?: number } = {}) {
  const client = new VtaClient(agent, VTA, {} as never, options)
  const internals = client as unknown as Record<'enqueue' | 'sendTask' | 'relayConsentRequests', unknown>
  jest.spyOn(internals as never, 'enqueue' as never).mockImplementation((async () => {
    throw held()
  }) as never)
  const resubmit = jest.spyOn(internals as never, 'sendTask' as never).mockImplementation((async () => {
    throw held()
  }) as never)
  jest.spyOn(internals as never, 'relayConsentRequests' as never).mockImplementation((async () => undefined) as never)

  const started = Date.now()
  let outcome: unknown
  let settled = false
  void client.task(SWAP, { did: 'did:key:z6MkPhone' }).then(
    () => {
      settled = true
    },
    (error: unknown) => {
      outcome = error
      settled = true
    }
  )
  for (let i = 0; i < 400 && !settled; i++) await jest.advanceTimersByTimeAsync(1000)
  return { settled, outcome, waitedMs: Date.now() - started, asksAgain: resubmit.mock.calls.length }
}

beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  delete config.E2E_CLOCKS
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('the consent wait', () => {
  it('is three minutes in a store build, 20 s with E2E_CLOCKS=short, clear of the short auto-lock', () => {
    expect(CONSENT_WAIT_MS).toBe(180_000)
    expect(SHORT_CONSENT_WAIT_MS).toBe(20_000)
    // The refusal must be on screen before the phone locks, never at the same moment.
    expect(SHORT_CONSENT_WAIT_MS).toBeLessThan(SHORT_AUTO_LOCK_MINUTES * 60_000)
    expect(effectiveConsentWaitMs(CONSENT_WAIT_MS)).toBe(180_000)
    config.E2E_CLOCKS = 'short'
    expect(effectiveConsentWaitMs(CONSENT_WAIT_MS)).toBe(20_000)
  })

  it.each([
    ['unset, as in the store build', undefined],
    ['real, the nightly real-clocks build', 'real'],
    ['anything but the exact word short', 'SHORT'],
  ])('with E2E_CLOCKS %s: a held task waits three minutes and asks again 23 times', async (_what, value) => {
    if (value !== undefined) config.E2E_CLOCKS = value
    const { settled, outcome, waitedMs, asksAgain } = await holdUntilGivenUp()
    expect(settled).toBe(true)
    expect(String(outcome)).toContain('auth:consent_required')
    expect(waitedMs).toBeGreaterThanOrEqual(180_000)
    expect(waitedMs).toBeLessThan(182_000)
    expect(asksAgain).toBe(23)
  })

  it('with E2E_CLOCKS=short: a held task gives up after 20 s, having asked again 3 times', async () => {
    config.E2E_CLOCKS = 'short'
    const { settled, outcome, waitedMs, asksAgain } = await holdUntilGivenUp()
    expect(settled).toBe(true)
    expect(String(outcome)).toContain('auth:consent_required')
    expect(waitedMs).toBeGreaterThanOrEqual(20_000)
    expect(waitedMs).toBeLessThan(22_000)
    expect(asksAgain).toBe(3)
  })

  it('a wait the caller sets still wins over the build, short clocks or not', async () => {
    config.E2E_CLOCKS = 'short'
    const { waitedMs, asksAgain } = await holdUntilGivenUp({ consentWaitMs: 60_000 })
    expect(waitedMs).toBeGreaterThanOrEqual(60_000)
    expect(waitedMs).toBeLessThan(62_000)
    expect(asksAgain).toBe(8)
  })
})
