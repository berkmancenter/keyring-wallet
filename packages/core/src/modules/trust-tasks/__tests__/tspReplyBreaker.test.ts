/**
 * Report D7FG-2Y9J (2026-10-21): two TSP asks went unanswered and the client opened its breaker to hold asks for
 * 300 s — and four seconds later a new client, made at the next reconnect, greeted the agent again with no hold at all,
 * every ~40 s, for minutes. A peer that found the phone not collecting drops its replies for five minutes, and each
 * greeting only added to an inbox already full.
 *
 * The breaker is now the agent's: kept across the clients made for it, so the hold holds. It backs off — 30 s, 60, 120,
 * then 300 — so a quick recovery is noticed in seconds, not minutes; a reply starts it over; and coming back to the
 * foreground lets one probe go early. And a socket that reads open but answers nothing is taken for dead and reopened.
 */
import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'
import { REPLIES_STALLED_STEPS_MS, REPLY_TIMEOUT_BREAKER, TspReplyBreaker } from '../module/VtaClient'
import { VtaAgentController } from '../module/vtaAgent'
import {
  ALIVE_CHECK_MS,
  SILENT_POLLS_BEFORE_REOPEN,
  VtiMediatorSession,
  type VtiClientIdentity,
  type VtiMediatorEndpoints,
} from '../module/VtiMediatorTransport'

const T0 = Date.parse('2026-10-21T14:52:00Z')

describe("the agent's reply breaker", () => {
  it(`opens at ${REPLY_TIMEOUT_BREAKER} unanswered asks, holding 30 s, then 60, 120 and 300 s from then on`, () => {
    const breaker = new TspReplyBreaker()
    expect(breaker.unanswered(T0)).toBeUndefined()
    expect(breaker.open).toBe(false)
    const holds: number[] = []
    let now = T0
    for (let i = 0; i < 6; i++) {
      const hold = breaker.unanswered(now)
      expect(hold).toBeDefined()
      holds.push(hold as number)
      expect(breaker.holding(now + (hold as number) - 1)).toBe(true)
      now += hold as number
      // The hold over, the next ask goes as the probe.
      expect(breaker.holding(now)).toBe(false)
    }
    expect(holds).toEqual([30_000, 60_000, 120_000, 300_000, 300_000, 300_000])
    expect(holds.slice(0, 4)).toEqual([...REPLIES_STALLED_STEPS_MS])
  })

  it('a reply closes it and starts the steps over', () => {
    const breaker = new TspReplyBreaker()
    breaker.unanswered(T0)
    breaker.unanswered(T0)
    breaker.unanswered(T0 + 30_000)
    expect(breaker.replied()).toBe(true)
    expect(breaker.open).toBe(false)
    breaker.unanswered(T0 + 100_000)
    expect(breaker.unanswered(T0 + 100_000)).toBe(30_000)
  })

  it('back in the foreground, one probe goes early, once a step', () => {
    const breaker = new TspReplyBreaker()
    breaker.unanswered(T0)
    breaker.unanswered(T0)
    expect(breaker.holding(T0 + 5_000)).toBe(true)
    expect(breaker.allowEarlyProbe(T0 + 5_000)).toBe(true)
    expect(breaker.holding(T0 + 5_000)).toBe(false)
    // The probe unanswered: the next step, and its own early probe.
    expect(breaker.unanswered(T0 + 6_000)).toBe(60_000)
    expect(breaker.allowEarlyProbe(T0 + 7_000)).toBe(true)
    expect(breaker.allowEarlyProbe(T0 + 8_000)).toBe(false)
    expect(new TspReplyBreaker().allowEarlyProbe(T0)).toBe(false)
  })
})

// The controller keeps one breaker per agent, and hands it to every client it makes for that agent.
const mockClients: { options: { breaker?: TspReplyBreaker } }[] = []
jest.mock('../module/VtaClient', () => {
  const actual = jest.requireActual('../module/VtaClient')
  return {
    ...actual,
    VtaClient: jest.fn().mockImplementation((_agent: unknown, _vtaDid: string, _store: unknown, options: object) => {
      const client = {
        options,
        disconnect: jest.fn(async () => undefined),
        managerDid: 'did:peer:2.m',
        isConnected: false,
      }
      mockClients.push(client as never)
      return client
    }),
  }
})
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

describe('kept across clients', () => {
  it('the breaker a reset client held is the one the next client for the agent gets', async () => {
    const vta = new VtaAgentController()
    vta.configure({ identityStore: () => ({}) as never })
    const agent = {} as never
    const first = vta.client(agent, 'did:webvh:QmA:dids.example:alberto5-vta')
    await (vta as unknown as { reset(): Promise<void> }).reset()
    const second = vta.client(agent, 'did:webvh:QmA:dids.example:alberto5-vta')
    expect(second).not.toBe(first)
    const [a, b] = mockClients.slice(-2).map((c) => c.options.breaker)
    expect(a).toBeInstanceOf(TspReplyBreaker)
    expect(b).toBe(a)
    // Another agent's is its own.
    vta.client(agent, 'did:webvh:QmB:dids.example:other-vta')
    expect(mockClients[mockClients.length - 1].options.breaker).not.toBe(a)
  })
})

// A socket that reads open and answers nothing is reopened.
const identity: VtiClientIdentity = {
  did: 'did:peer:2.manager',
  kid: 'did:peer:2.manager#key-2',
  senderKey: {} as never,
}
const mediator: VtiMediatorEndpoints = {
  did: 'did:webvh:QmM:dids.example:mediator',
  authEndpoint: 'https://mediator.example/mediator/v1',
  wsEndpoint: 'wss://mediator.example/mediator/v1/ws',
  publicJwk: {} as never,
  kid: 'did:webvh:QmM:dids.example:mediator#key-1',
}
const agent = {
  config: { logger: { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined } },
} as never
const STATUS = JSON.stringify({ type: 'https://didcomm.org/messagepickup/3.0/status', body: { message_count: 0 } })

function openSession() {
  const s = new VtiMediatorSession(agent, identity, mediator)
  const internals = s as unknown as {
    socket?: { readyState: number; close: () => void }
    requestDelivery: () => Promise<void>
    sendOnSocket: () => Promise<void>
    reopen: () => Promise<void>
    startLiveDelivery: () => Promise<void>
    handleFrame: (raw: string) => Promise<void>
  }
  internals.socket = { readyState: 1, close: jest.fn() }
  const requests = jest.fn(async () => undefined)
  internals.requestDelivery = requests
  internals.sendOnSocket = jest.fn(async () => undefined)
  const reopen = jest.fn(async () => undefined)
  internals.reopen = reopen
  return { s, internals, requests, reopen }
}

describe('a socket that reads open and is silent', () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    jest.useFakeTimers()
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    warn.mockRestore()
    jest.useRealTimers()
  })

  it(`after ${SILENT_POLLS_BEFORE_REOPEN} backstop polls heard nothing back: reopened, and said`, async () => {
    const { internals, reopen } = openSession()
    await internals.startLiveDelivery()
    await jest.advanceTimersByTimeAsync(15_000 * SILENT_POLLS_BEFORE_REOPEN)
    expect(reopen).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(15_000)
    expect(reopen).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls.map(([l]) => String(l)).join('\n')).toMatch(/reads open but is silent .* reopening it/)
  })

  it('a socket the mediator answers is left alone, however long it runs', async () => {
    const { internals, reopen } = openSession()
    await internals.startLiveDelivery()
    for (let i = 0; i < 8; i++) {
      await jest.advanceTimersByTimeAsync(15_000)
      await internals.handleFrame(STATUS)
    }
    expect(reopen).not.toHaveBeenCalled()
  })

  it(`back in the foreground: asked to prove itself, reopened if nothing comes back in ${ALIVE_CHECK_MS / 1000} s`, async () => {
    const { s, requests, reopen } = openSession()
    s.checkAlive()
    expect(requests).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(ALIVE_CHECK_MS)
    expect(reopen).toHaveBeenCalledTimes(1)
  })

  it('back in the foreground, answered in time: left as it is', async () => {
    const { s, internals, reopen } = openSession()
    s.checkAlive()
    await internals.handleFrame(STATUS)
    await jest.advanceTimersByTimeAsync(ALIVE_CHECK_MS)
    expect(reopen).not.toHaveBeenCalled()
  })
})

describe('what the person reads', () => {
  it('"isn\'t answering this phone", in every language', () => {
    for (const words of [en, fr, ptBr] as Record<string, Record<string, string>>[])
      expect(words.VtaLink.BannerNotAnswering).toEqual(expect.any(String))
    expect((en as Record<string, Record<string, string>>).VtaLink.BannerNotAnswering).toBe(
      "Your agent isn't answering this phone. Retrying."
    )
  })
})
