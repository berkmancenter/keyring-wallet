/**
 * The phone's log leaves the device (remote logs, testers' problem reports).
 * A line pairing `vetting/attestation` with the DID that sent it names the
 * applicant's vetter, the one thing hidden vetting keeps from everyone but the
 * applicant. So a hidden-vetting message is logged by its type alone: no
 * sender, no session DID, not even a prefix of either.
 *
 * `deliver` is driven here; the TSP receive line (`receiveTspFrame`) makes the
 * same choice through the same `isHiddenVettingType`, tested below as a rule.
 */
import { isHiddenVettingType, vtiAgent } from '../module/vtiAgent'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const VETTER = 'did:webvh:QmVetterScidXyz:vta.example:vett-zq83'
const APPLICANT = 'did:webvh:QmApplicantScid:vta.example:appl-zq82'
const COMMUNITY = 'did:webvh:QmCommunityScid:vtc.example:tvtc-zq81'
const ATTESTATION = 'https://trusttasks.org/spec/vetting/attestation/0.1'
const CHALLENGE = 'https://trusttasks.org/spec/vtc/vetting/pcs-challenge/0.1'
const ERROR = 'https://trusttasks.org/spec/trust-task-error/0.5'

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
const internals = vtiAgent as unknown as {
  agent?: unknown
  state: { did?: string }
  deliver(m: unknown): Promise<void>
  asks: Map<string, unknown>
}

/** Every DID, and every piece of one a prefix could show, that must not appear. */
const fragments = (did: string) => [did, ...did.split(':').filter((p) => p.length > 6)]
const logged = () => JSON.stringify([logger.debug.mock.calls, logger.info.mock.calls, logger.warn.mock.calls])

beforeEach(() => {
  for (const f of Object.values(logger)) f.mockClear()
  internals.agent = { config: { logger } }
  internals.state.did = APPLICANT
})

describe('which types are hidden vetting', () => {
  it.each([
    ATTESTATION,
    `${ATTESTATION}#response`,
    'https://trusttasks.org/spec/vta/pcs/prove/0.1',
    'https://trusttasks.org/spec/vta/pcs/verify-attestation/0.1#response',
    CHALLENGE,
    `${CHALLENGE}#response`,
    'https://trusttasks.org/spec/vtc/vetting/hidden/show/0.1',
  ])('%s is', (type) => expect(isHiddenVettingType(type)).toBe(true))

  it.each([
    'https://trusttasks.org/spec/vetting/request/0.1',
    'https://trusttasks.org/spec/vetting/session/0.1',
    'https://trusttasks.org/spec/credential-exchange/issue/0.1',
    'https://trusttasks.org/spec/vtc/join-requests/submit/0.3',
    ERROR,
  ])('%s is not, and keeps its sender in the log', (type) => expect(isHiddenVettingType(type)).toBe(false))
})

describe('the inbound log line', () => {
  it('for a vetter’s attestation names the type and no DID at all', async () => {
    await internals.deliver({ id: 'm-1', type: ATTESTATION, from: VETTER, to: [APPLICANT], body: {} })
    expect(logger.info).toHaveBeenCalledWith(`vtiAgent: inbound ${ATTESTATION}`)
    for (const piece of [...fragments(VETTER), ...fragments(APPLICANT)]) expect(logged()).not.toContain(piece)
  })

  it('for anything else still says who sent it, as before', async () => {
    const type = 'https://trusttasks.org/spec/vetting/session/0.1'
    await internals.deliver({ id: 'm-2', type, from: VETTER, to: [APPLICANT], body: {} })
    const line = String(logger.info.mock.calls.find(([l]) => String(l).includes(type))?.[0])
    expect(line).toMatch(/ from did:webvh:/)
  })

  it('for a refusal of a hidden-vetting ask names no DID either', async () => {
    internals.asks.set('t-1', {
      id: 't-1',
      did: APPLICANT,
      communityDid: COMMUNITY,
      type: CHALLENGE,
      payloadKey: '{}',
      write: true,
      correlation: new Set(['t-1']),
      sentAt: Date.now(),
      lastSentAt: Date.now(),
      waiters: [],
    })
    await internals.deliver({
      id: 'm-3',
      type: ERROR,
      from: COMMUNITY,
      thid: 't-1',
      body: { threadId: 't-1', payload: { code: 'vtc/vetting/pcs-challenge:notHiddenVetting' } },
    })
    internals.asks.delete('t-1')
    expect(logged()).toContain('notHiddenVetting')
    for (const piece of [...fragments(COMMUNITY), ...fragments(APPLICANT)]) expect(logged()).not.toContain(piece)
  })
})
