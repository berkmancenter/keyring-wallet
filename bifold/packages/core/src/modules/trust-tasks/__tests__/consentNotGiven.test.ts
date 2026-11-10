/**
 * A held task whose question changed (trusted-approver plan T3, mock frame 6b). The agent answers a re-submit with the
 * same challenge while the question is pending; once it was answered no or lapsed, the pending record is deleted and
 * the next re-submit raises a new question, with a new challenge (VTI task-consent.md, "Pending vs denied"). So the
 * phone stops there with ConsentNotGiven instead of asking again until its wait runs out, as upstream's own client
 * does (vta-cli-common consent.rs, `ConsentOutcome::Resolved`). Without a challenge on both, the two cannot be told
 * apart, and the wait goes on as before.
 */
import { VtaClient, consentNotGiven, consentPendingOf } from '../module/VtaClient'
import { VtaAgentController } from '../module/vtaAgent'
import { deviceRefusalOf } from '../module/vtaOwner'
import { VtiRefusal } from '../module/vtiAgent'

jest.mock('react-native-config', () => ({ __esModule: true, default: {} }))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const VTA = 'did:webvh:QmVta:dids.example:sams-agent'
const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }
const agent = { config: { logger } } as never
const PERSONA_MINT = 'https://trusttasks.org/spec/vta/webvh/dids/create/1.2'

const held = (challenge?: string, where: 'details' | 'request' = 'details') =>
  new VtiRefusal('taskFailed', 'task failed: auth:consent_required', {
    reason: 'auth:consent_required',
    payloadDigest: `digest-${challenge ?? 'none'}`,
    ...(challenge && where === 'details' ? { challenge } : {}),
    consentRequests: challenge && where === 'request' ? [{ payload: { challenge } }] : [],
  })

/**
 * Hold one task: the first refusal is `first`, each re-submit answers with the next of `then` (the last repeats);
 * a value instead of a refusal is the task running. What it ended with, and how many times it asked again.
 */
async function hold(first: VtiRefusal, then: (VtiRefusal | 'ran')[], onConsentNotGiven = jest.fn()) {
  const client = new VtaClient(agent, VTA, {} as never, { consentWaitMs: 60_000, onConsentNotGiven })
  const internals = client as unknown as Record<'enqueue' | 'sendTask' | 'relayConsentRequests' | 'awaitGrant', unknown>
  jest.spyOn(internals as never, 'enqueue' as never).mockImplementation((async () => {
    throw first
  }) as never)
  let n = 0
  const resubmit = jest.spyOn(internals as never, 'sendTask' as never).mockImplementation((async () => {
    const next = then[Math.min(n++, then.length - 1)]
    if (next === 'ran') return { ok: true }
    throw next
  }) as never)
  jest.spyOn(internals as never, 'relayConsentRequests' as never).mockImplementation((async () => undefined) as never)
  // As the real wait: up to its bound (8 s), on the fake clock.
  jest
    .spyOn(internals as never, 'awaitGrant' as never)
    .mockImplementation(((_digest: unknown, ms: number) => new Promise((resolve) => setTimeout(resolve, ms))) as never)

  let outcome: { value?: unknown; error?: unknown } | undefined
  void client.task(PERSONA_MINT, {}).then(
    (value) => (outcome = { value }),
    (error: unknown) => (outcome = { error })
  )
  for (let i = 0; i < 200 && !outcome; i++) await jest.advanceTimersByTimeAsync(1000)
  return { outcome, asksAgain: resubmit.mock.calls.length, onConsentNotGiven }
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('a held task whose question changed', () => {
  it('stops at the first new challenge with ConsentNotGiven, and says so once', async () => {
    const { outcome, asksAgain, onConsentNotGiven } = await hold(held('c-1'), [held('c-1'), held('c-2'), held('c-3')])
    expect((outcome?.error as { code?: string } | undefined)?.code === 'consentNotGiven').toBe(true)
    expect((outcome?.error as { details?: { taskType?: string } }).details?.taskType).toBe(PERSONA_MINT)
    expect((outcome?.error as { code?: string }).code).toBe('consentNotGiven')
    // Once pending, once changed: never a third question.
    expect(asksAgain).toBe(2)
    expect(onConsentNotGiven).toHaveBeenCalledTimes(1)
    expect(onConsentNotGiven).toHaveBeenCalledWith({ taskType: PERSONA_MINT })
  })

  it('reads the challenge from the signed request when details carry none', async () => {
    const { outcome, asksAgain } = await hold(held('c-1', 'request'), [held('c-2', 'request')])
    expect((outcome?.error as { code?: string } | undefined)?.code === 'consentNotGiven').toBe(true)
    expect(asksAgain).toBe(1)
  })

  it('control: the same challenge keeps waiting, and the grant runs the task', async () => {
    const { outcome, asksAgain, onConsentNotGiven } = await hold(held('c-1'), [held('c-1'), held('c-1'), 'ran'])
    expect(outcome).toEqual({ value: { ok: true } })
    expect(asksAgain).toBe(3)
    expect(onConsentNotGiven).not.toHaveBeenCalled()
  })

  it('without a challenge to compare, the wait goes on as before, to its end', async () => {
    const { outcome, asksAgain, onConsentNotGiven } = await hold(held(), [held('c-2')])
    expect((outcome?.error as { code?: string } | undefined)?.code === 'consentNotGiven').toBe(false)
    expect(asksAgain).toBeGreaterThan(2)
    expect(onConsentNotGiven).not.toHaveBeenCalled()
  })

  it('consentPendingOf reads the challenge, details first', () => {
    expect(consentPendingOf(held('c-1'))?.challenge).toBe('c-1')
    expect(consentPendingOf(held('c-1', 'request'))?.challenge).toBe('c-1')
    expect(consentPendingOf(held())?.challenge).toBeUndefined()
  })

  // Derived both ways: the error comes from VtaClient's factory and is read by vtaOwner's own literal, so a change to
  // either side's code string fails this row.
  it("an owner act refused this way reads as not approved, never as the agent's refusal (control: still waiting)", () => {
    // addDevice and the other owner acts read a refusal through deviceRefusalOf: without its own case, this one fell
    // through to "Your agent refused this (consentNotGiven)".
    const ended = deviceRefusalOf(consentNotGiven('https://trusttasks.org/spec/vta/acl/grant/1.0'))
    expect(ended.reason).toBe('notApproved')
    expect(ended.message).not.toMatch(/consentNotGiven|refused/)
    expect(deviceRefusalOf(held('c-1')).reason).toBe('awaitingApproval')
  })
})

describe("what Sam's phone keeps", () => {
  const options = (vta: VtaAgentController) => {
    const fakeAgent = { config: { logger }, genericRecords: {}, dids: {}, wallet: {} } as never
    const client = vta.client(fakeAgent, VTA)
    return (client as unknown as { options: { onConsentPending(i: object): void; onConsentNotGiven(i: object): void } })
      .options
  }

  it('a question that changed ends the hold and remembers which task, and when', () => {
    const vta = new VtaAgentController()
    const o = options(vta)
    o.onConsentPending({ taskType: PERSONA_MINT })
    expect(vta.getState().awaitingConsentFor).toBe(PERSONA_MINT)
    const before = Date.now()
    o.onConsentNotGiven({ taskType: PERSONA_MINT })
    const state = vta.getState()
    expect(state.awaitingConsentFor).toBeUndefined()
    expect(state.consentNotGiven?.taskType).toBe(PERSONA_MINT)
    expect(state.consentNotGiven?.at).toBeGreaterThanOrEqual(before)
  })

  it('the next hold clears it (control: the one above)', () => {
    const vta = new VtaAgentController()
    const o = options(vta)
    o.onConsentNotGiven({ taskType: PERSONA_MINT })
    o.onConsentPending({ taskType: PERSONA_MINT })
    expect(vta.getState().consentNotGiven).toBeUndefined()
    expect(vta.getState().awaitingConsentFor).toBe(PERSONA_MINT)
  })
})
