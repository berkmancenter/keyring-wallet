/**
 * The vetter's two rounds, graded on the wire by the registry's own schemas.
 *
 * Build 256, a vetter on test-vtc: the community refused
 * `vtc/vetting/vetters/pcs-root` as `malformedRequest` ("doesn't match pattern
 * ^z[1-9A-HJ-NP-Za-km-z]+$"), and the round went on to `root-accept` anyway.
 * Two faults. The agent answers `root-request` as `{ request: { label, id,
 * request } }` and the client read `id` one level up, so the community got an
 * empty id; and a trust-task-error was read as an answer, because it has a
 * payload too.
 *
 * So these tests start from the agent's answer — graded against the
 * registry's `#response` for its task, so the stub cannot drift from what an
 * agent sends — and run it through the real `VtaClient` parsing and the real
 * rounds, grading what the phone carries to the community against the
 * community's schema.
 */
const mockTask = jest.fn()
const mockAsk = jest.fn()
const mockFetchManifest = jest.fn()

jest.mock('../module/vtaAgent', () => {
  // A real client, with only the hop to the agent stubbed: its parsing of the
  // agent's answers is what is under test.
  const { VtaClient } = jest.requireActual('../module/VtaClient')
  const client = Object.create(VtaClient.prototype)
  Object.defineProperty(client, 'managerDid', { get: () => 'did:peer:2.Ephone' })
  Object.assign(client, {
    connect: async () => undefined,
    listContexts: async () => [{ id: 'vta' }],
    task: (...a: unknown[]) => mockTask(...a),
  })
  return { vtaAgent: { agentAddress: () => 'did:webvh:QmAgent:example:agent', client: () => client } }
})
jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  vtiAgent: {
    // The persona the community requests are signed as — deliberately not the
    // phone's identity at its VTA (`did:peer:2.Ephone` above), which is the
    // confusion build 259 shipped.
    did: 'did:webvh:QmPersonaScid:vta.example:prsn-wq42',
    ask: (...a: unknown[]) => mockAsk(...a),
    fetchManifest: (...a: unknown[]) => mockFetchManifest(...a),
    // The rounds sign the session in as the persona and run inside the hold.
    holding: (_agent: unknown, _mediator: unknown, persona: { did: string }, fn: (did: string) => unknown) =>
      fn(persona.did),
  },
}))
// This phone's persona for the community: the DID the session above is signed in as.
jest.mock('../module/VtiIdentityStore', () => ({
  GenericRecordsIdentityStore: class {
    getPersona = async (communityDid: string) => ({
      did: 'did:webvh:QmPersonaScid:vta.example:prsn-wq42',
      communityDid,
    })
  },
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

import {
  boundElsewhere,
  drawVetterTokens,
  enrolVetter,
  isEnrolled,
  monthLabelAt,
  nextOwedTick,
  nextTickOpensAt,
} from '../module/hiddenVetterRounds'
import { PCS_VETTER_ERROR, PCS_VETTER_TASK, VTC_VETTER_TASK } from '../module/pcsVetterTasks'
import { VtiRefusal } from '../module/vtiAgent'

import { PCS_VETTER_SCHEMA_DIR, vendoredValidatorIn } from './fixtures/vtcJoinSchemas'

const graded = (file: string, anchor?: string) => {
  const validate = vendoredValidatorIn(PCS_VETTER_SCHEMA_DIR, file, anchor)
  return (value: unknown) => validate(value) || validate.errors
}
const ROOT_REQUEST_ANSWER = graded('vta-pcs-root-request.payload.schema.json', 'response')
const ROOT_REQUEST = graded('vta-pcs-root-request.payload.schema.json')
const PCS_ROOT = graded('vtc-vetting-vetters-pcs-root.payload.schema.json')
const PCS_ROOT_ANSWER = graded('vtc-vetting-vetters-pcs-root.payload.schema.json', 'response')
const ROOT_ACCEPT = graded('vta-pcs-root-accept.payload.schema.json')
const TOKENS_REQUEST_ANSWER = graded('vta-pcs-tokens-request.payload.schema.json', 'response')
const PCS_TOKENS = graded('vtc-vetting-vetters-pcs-tokens.payload.schema.json')
const PCS_TOKENS_ANSWER = graded('vtc-vetting-vetters-pcs-tokens.payload.schema.json', 'response')
const TOKENS_ACCEPT = graded('vta-pcs-tokens-accept.payload.schema.json')
const TOKENS_ABANDON = graded('vta-pcs-tokens-abandon.payload.schema.json')

const COMMUNITY = 'did:webvh:QmCommScid:vtc.example:tvtc-wq41'
const SIGNER = 'did:webvh:QmPersonaScid:vta.example:prsn-wq42'
const MANAGER = 'did:peer:2.Ephone'
const criterion = {
  id: 'Vetted-Member',
  requirementsDigest: 'zQmPublished',
  vetting: {
    minStatements: 1,
    ext: {
      'org.openvtc.hidden-vetting': {
        suite: 'ps-ddh-bls12381',
        helperKey: 'z6MkhelperKey',
        tokenKey: 'z6MktokenKey',
        vetterLabels: ['vetter/2026-10'],
        tokenLabels: ['token/2026-10'],
        dripPerTick: 2,
        tickLength: 'P3D',
        events: [],
      },
    },
  },
} as never

/** What an agent answers `vta/pcs/root-request/0.1` with: the community's payload, nested. */
const rootRequestAnswer = {
  request: {
    label: 'vetter/2026-10',
    id: 'z3VetterPcsKey',
    request: { encoding: 'z4Encoding', t0: 'z5TagRoot', proof: 'z6ProofWF' },
  },
}
/** What an agent answers `vta/pcs/tokens/request/0.1` with. */
const tokensRequestAnswer = {
  request: {
    label: 'token/2026-10',
    tick: 1,
    requests: [
      { commitment: 'z7Commit', openingProof: 'z8Prf' },
      { commitment: 'z9Commit', openingProof: 'zAPrf' },
    ],
  },
}

const answered = (type: string, payload: unknown) => ({ type: `${type}#response`, body: { payload } })
const refused = (code: string, message: string) => ({
  type: 'https://trusttasks.org/spec/trust-task-error/0.5',
  body: { payload: { code, message } },
})
/** The payload the client sent the agent for `type`, or undefined if it never asked. */
const sentToAgent = (type: string) => mockTask.mock.calls.find(([t]) => t === type)?.[1]
const sentToCommunity = (type: string) => mockAsk.mock.calls.find(([, t]) => t === type)?.[2]

const agent = () => {
  const rows: { content: unknown; tags: Record<string, string> }[] = []
  return {
    genericRecords: {
      findAllByQuery: async (q: Record<string, string>) =>
        rows.filter((r) => Object.entries(q).every(([k, v]) => r.tags[k] === v)),
      save: async (r: { content: unknown; tags: Record<string, string> }) => void rows.push(r),
      update: async () => undefined,
      delete: async () => undefined,
    },
  } as never
}

beforeEach(() => {
  mockTask.mockReset()
  mockAsk.mockReset()
  mockTask.mockImplementation(async (type: string, ...rest: unknown[]) => {
    if (type === PCS_VETTER_TASK.rootRequest) return rootRequestAnswer
    if (type === PCS_VETTER_TASK.tokensRequest) return tokensRequestFor(rest[0])
    return {}
  })
  // 12:00Z on 1 October: tick 0 of token/2026-10 has begun and no other has,
  // so one draw is owed. jestSetup freezes Date.now at 2024, when no label here
  // was live.
  jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 1, 12))
})

/** The agent's tokens/request answer for the tick it was asked for. */
const tokensRequestFor = (payload: unknown) => ({
  request: { ...tokensRequestAnswer.request, tick: (payload as { tick?: number })?.tick ?? 1 },
})

describe('the stubbed agent answers as the registry says an agent does', () => {
  it('root-request and tokens/request, each nested in `request`', () => {
    expect(ROOT_REQUEST_ANSWER(rootRequestAnswer)).toBe(true)
    expect(TOKENS_REQUEST_ANSWER(tokensRequestAnswer)).toBe(true)
  })

  it('and the old reading of it — the id at the top level — is not an answer', () => {
    expect(ROOT_REQUEST_ANSWER({ id: 'z3VetterPcsKey', request: rootRequestAnswer.request.request })).not.toBe(true)
  })
})

/** The agent answers `root-request` with `answer`, and everything else as before. */
const rootRequestAnswers = (answer: unknown) => {
  const before = mockTask.getMockImplementation()
  mockTask.mockImplementation(async (type: string, ...rest: unknown[]) =>
    type === PCS_VETTER_TASK.rootRequest ? answer : before?.(type, ...rest)
  )
}

describe('enrolling', () => {
  beforeEach(() =>
    mockAsk.mockResolvedValue(
      answered(VTC_VETTER_TASK.pcsRoot, { label: 'vetter/2026-10', preCredential: 'zBPreCred' })
    )
  )

  it('carries the agent’s request to the community as the pcs-root schema requires', async () => {
    await enrolVetter(agent(), COMMUNITY, criterion)
    expect(ROOT_REQUEST(sentToAgent(PCS_VETTER_TASK.rootRequest))).toBe(true)
    const carried = sentToCommunity(VTC_VETTER_TASK.pcsRoot)
    expect(PCS_ROOT(carried)).toBe(true)
    // Unchanged: the phone does not rebuild what the agent blinded.
    expect(carried).toEqual(rootRequestAnswer.request)
  })

  it('hands the community’s answer back as root-accept requires', async () => {
    await enrolVetter(agent(), COMMUNITY, criterion)
    const accept = sentToAgent(PCS_VETTER_TASK.rootAccept)
    expect(PCS_ROOT_ANSWER(accept.response)).toBe(true)
    expect(ROOT_ACCEPT(accept)).toBe(true)
  })

  it('stops at a refusal: no root-accept, and the community’s code is what is thrown', async () => {
    mockAsk.mockResolvedValue(
      refused('malformedRequest', 'validation error: payload: doesn\'t match pattern "^z[1-9A-HJ-NP-Za-km-z]+$"')
    )
    const thrown = await enrolVetter(agent(), COMMUNITY, criterion).catch((e: unknown) => e)
    expect(thrown).toBeInstanceOf(VtiRefusal)
    expect((thrown as VtiRefusal).code).toBe('malformedRequest')
    expect(sentToAgent(PCS_VETTER_TASK.rootAccept)).toBeUndefined()
  })

  it('stops when the community does not answer', async () => {
    mockAsk.mockResolvedValue(undefined)
    await expect(enrolVetter(agent(), COMMUNITY, criterion)).rejects.toMatchObject({
      code: 'keyring/hidden-vetter:noAnswer',
    })
    expect(sentToAgent(PCS_VETTER_TASK.rootAccept)).toBeUndefined()
  })

  it('sends the community nothing when the agent’s answer carries no request', async () => {
    rootRequestAnswers({ id: 'z3VetterPcsKey' })
    await expect(enrolVetter(agent(), COMMUNITY, criterion)).rejects.toThrow('returned no request')
    expect(mockAsk).not.toHaveBeenCalled()
  })

  it('sends the community nothing when the agent’s id is not base58btc, and says so on the phone', async () => {
    rootRequestAnswers({ request: { ...rootRequestAnswer.request, id: 'z0lIO' } })
    await expect(enrolVetter(agent(), COMMUNITY, criterion)).rejects.toMatchObject({
      code: 'vta/pcs/root-request:noIdentifier',
    })
    expect(mockAsk).not.toHaveBeenCalled()
  })
})

describe('drawing', () => {
  beforeEach(() =>
    mockAsk.mockResolvedValue(
      answered(VTC_VETTER_TASK.pcsTokens, { label: 'token/2026-10', tick: 0, preCredentials: ['zCPre', 'zDPre'] })
    )
  )

  it('carries the agent’s draw as the pcs-tokens schema requires, and hands back as tokens/accept requires', async () => {
    await expect(drawVetterTokens(agent(), COMMUNITY, criterion)).resolves.toEqual({ drawn: 2 })
    const carried = sentToCommunity(VTC_VETTER_TASK.pcsTokens)
    expect(PCS_TOKENS(carried)).toBe(true)
    expect(carried).toEqual({ ...tokensRequestAnswer.request, tick: 0 })
    const accept = sentToAgent(PCS_VETTER_TASK.tokensAccept)
    expect(PCS_TOKENS_ANSWER(accept.response)).toBe(true)
    expect(TOKENS_ACCEPT(accept)).toBe(true)
  })

  it('stops at a refusal, gives the draw up at the agent, and does not count it drawn', async () => {
    mockAsk.mockResolvedValue(refused('vtc/vetting/vetters/pcs-tokens:tickAhead', 'tick is ahead'))
    const a = agent()
    await expect(drawVetterTokens(a, COMMUNITY, criterion)).rejects.toBeInstanceOf(VtiRefusal)
    expect(sentToAgent(PCS_VETTER_TASK.tokensAccept)).toBeUndefined()
    const abandon = sentToAgent(PCS_VETTER_TASK.tokensAbandon)
    expect(TOKENS_ABANDON(abandon)).toBe(true)
    expect(abandon.draw).toEqual({ label: 'token/2026-10', tick: 0 })
    // Not recorded as drawn, so the next round tries this tick again.
    mockAsk.mockResolvedValue(
      answered(VTC_VETTER_TASK.pcsTokens, { label: 'token/2026-10', tick: 0, preCredentials: ['zCPre', 'zDPre'] })
    )
    await expect(drawVetterTokens(a, COMMUNITY, criterion)).resolves.toEqual({ drawn: 2 })
  })
})

describe('the member DID the agent binds is the DID that signs to the community', () => {
  /** `vta/pcs/vetter/show` answering with an engine bound to `memberDid`. */
  const engineBoundTo = (memberDid: string, extra: Record<string, unknown> = {}) => ({
    vetter: {
      contextId: 'vta',
      community: COMMUNITY,
      memberDid,
      suite: 'ps-ddh-bls12381',
      id: rootRequestAnswer.request.id,
      enrolledLabels: ['vetter/2026-10'],
      pendingLabels: [],
      tokensFree: 0,
      tokensHeld: 0,
      drawsInFlight: [],
      attested: 0,
      ...extra,
    },
  })
  const answering = (show: unknown, rootRequest: unknown = rootRequestAnswer) =>
    mockTask.mockImplementation(async (type: string, ...rest: unknown[]) => {
      if (type === PCS_VETTER_TASK.vetterShow) return typeof show === 'function' ? show() : show
      if (type === PCS_VETTER_TASK.rootRequest) return rootRequest
      if (type === PCS_VETTER_TASK.tokensRequest) return tokensRequestFor(rest[0])
      return {}
    })

  it('enrol binds the persona that signs pcs-root and pcs-tokens, never the phone’s identity at its VTA', async () => {
    mockAsk.mockResolvedValue(
      answered(VTC_VETTER_TASK.pcsRoot, { label: 'vetter/2026-10', preCredential: 'zBPreCred' })
    )
    await enrolVetter(agent(), COMMUNITY, criterion)
    expect(sentToAgent(PCS_VETTER_TASK.rootRequest).memberDid).toBe(SIGNER)
    expect(sentToAgent(PCS_VETTER_TASK.rootRequest).memberDid).not.toBe(MANAGER)
  })

  it('an engine bound to another DID is not enrolled, so the desk re-enrols it', async () => {
    answering(engineBoundTo(MANAGER))
    await expect(isEnrolled(agent(), COMMUNITY, criterion)).resolves.toBe(false)
    answering(engineBoundTo(SIGNER))
    await expect(isEnrolled(agent(), COMMUNITY, criterion)).resolves.toBe(true)
  })

  it('never draws from an engine bound to another DID: no tokens/request, and a code a screen can word', async () => {
    answering(engineBoundTo(MANAGER))
    await expect(drawVetterTokens(agent(), COMMUNITY, criterion)).rejects.toMatchObject({
      code: 'keyring/hidden-vetter:memberMismatch',
    })
    expect(sentToAgent(PCS_VETTER_TASK.tokensRequest)).toBeUndefined()
    expect(mockAsk).not.toHaveBeenCalled()
  })

  it('an engine enrolled under another DID is stuck: no re-enrolment the agent refuses, nothing to the community', async () => {
    // vta-service 0.60 keys an engine by context and community, keeps its first
    // member DID, refuses a root-request naming another, and has no reset.
    answering(engineBoundTo(MANAGER))
    await expect(enrolVetter(agent(), COMMUNITY, criterion)).rejects.toMatchObject({
      code: 'keyring/hidden-vetter:memberMismatch',
    })
    expect(sentToAgent(PCS_VETTER_TASK.rootRequest)).toBeUndefined()
    expect(mockAsk).not.toHaveBeenCalled()
  })

  it('a re-enrolment that would carry a new PCS identifier is not sent (the community refuses identifierRebound)', async () => {
    answering(engineBoundTo(SIGNER, { id: 'z9AnotherKey' }))
    await expect(enrolVetter(agent(), COMMUNITY, criterion)).rejects.toMatchObject({
      code: 'keyring/hidden-vetter:memberMismatch',
    })
    expect(mockAsk).not.toHaveBeenCalled()
  })

  it('the standing a screen reads says stuck, from the same comparison', () => {
    expect(boundElsewhere({ memberDid: MANAGER }, { did: SIGNER })).toBe(true)
    expect(boundElsewhere({ memberDid: SIGNER }, { did: SIGNER })).toBe(false)
    expect(boundElsewhere(undefined, { did: SIGNER })).toBe(false)
  })
})

describe('the draw follows the community’s schedule, not the phone’s', () => {
  const tokensServed = () =>
    mockAsk.mockImplementation(async (_did: string, _type: string, payload: { tick: number }) =>
      answered(VTC_VETTER_TASK.pcsTokens, {
        label: 'token/2026-10',
        tick: payload.tick,
        preCredentials: ['zCPre', 'zDPre'],
      })
    )
  const ticksAsked = () => mockAsk.mock.calls.map(([, , p]) => (p as { tick: number }).tick)

  it('tick 0 starts at 00:00Z on the label’s first day; each lasts tickLength', () => {
    const start = Date.UTC(2026, 9, 1)
    const day = 86400 * 1000
    expect(monthLabelAt(['token/2026-09', 'token/2026-10'], start + day)).toEqual({ label: 'token/2026-10', start })
    expect(nextOwedTick(start, 3 * day, undefined, start + day)).toBe(0)
    expect(nextOwedTick(start, 3 * day, 0, start + day)).toBeUndefined()
    expect(nextOwedTick(start, 3 * day, 0, start + 3 * day)).toBe(1)
    // A tick later than the current one belongs to no tick of this label.
    expect(nextOwedTick(start, 3 * day, 20000, start + day)).toBe(0)
  })

  it('right after enrolment, every owed tick is drawn, oldest first, each at the published drip', async () => {
    // 16 October 12:00Z under P3D: ticks 0 to 5 have begun.
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 16, 12))
    tokensServed()
    const a = agent()
    await expect(drawVetterTokens(a, COMMUNITY, criterion)).resolves.toEqual({ drawn: 12 })
    expect(ticksAsked()).toEqual([0, 1, 2, 3, 4, 5])
    for (const [type, payload] of mockTask.mock.calls)
      if (type === PCS_VETTER_TASK.tokensRequest) expect((payload as { count: number }).count).toBe(2)
    // And nothing again until tick 6 opens.
    mockAsk.mockClear()
    await expect(drawVetterTokens(a, COMMUNITY, criterion)).resolves.toEqual({ drawn: 0 })
    expect(mockAsk).not.toHaveBeenCalled()
  })

  it('a tick served before (an answer this phone lost) is passed over, and the next one drawn', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 4, 12))
    mockAsk.mockImplementation(async (_d: string, _t: string, payload: { tick: number }) =>
      payload.tick === 0
        ? refused('vtc/vetting/vetters/pcs-tokens:alreadyServed', 'served')
        : answered(VTC_VETTER_TASK.pcsTokens, { label: 'token/2026-10', tick: payload.tick, preCredentials: ['zCPre'] })
    )
    await expect(drawVetterTokens(agent(), COMMUNITY, criterion)).resolves.toEqual({ drawn: 1 })
    expect(ticksAsked()).toEqual([0, 1])
  })

  it('stops, without failing, when the community says a tick has not begun', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 4, 12))
    mockAsk.mockImplementation(async (_d: string, _t: string, payload: { tick: number }) =>
      payload.tick === 1
        ? refused('vtc/vetting/vetters/pcs-tokens:tickNotYet', 'not yet')
        : answered(VTC_VETTER_TASK.pcsTokens, { label: 'token/2026-10', tick: payload.tick, preCredentials: ['zCPre'] })
    )
    await expect(drawVetterTokens(agent(), COMMUNITY, criterion)).resolves.toEqual({ drawn: 1 })
    expect(ticksAsked()).toEqual([0, 1])
  })

  describe('a month the community has not rolled to', () => {
    const sep = Date.UTC(2026, 8, 1)
    const oct = Date.UTC(2026, 9, 1)
    const nov = Date.UTC(2026, 10, 1)
    const nov2 = Date.UTC(2026, 10, 2, 12)
    const logging = () => {
      const warn = jest.fn()
      return { warn, a: { ...(agent() as object), config: { logger: { warn } } } as never }
    }

    it('draws under the newest published label that has begun, and warns naming the one missing', async () => {
      // 2 November 12:00Z under P3D, on a manifest still at token/2026-10: ticks 0 to 10 have begun.
      jest.spyOn(Date, 'now').mockReturnValue(nov2)
      tokensServed()
      const { a, warn } = logging()
      await expect(drawVetterTokens(a, COMMUNITY, criterion)).resolves.toEqual({ drawn: 22 })
      expect(ticksAsked()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      expect((sentToAgent(PCS_VETTER_TASK.tokensRequest) as { label: string }).label).toBe('token/2026-10')
      expect(warn).toHaveBeenCalledWith('[hidden-vetting] token/2026-11 is not published: drawing under token/2026-10')
    })

    it('warns of nothing in a month a label covers', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 16, 12))
      tokensServed()
      const { a, warn } = logging()
      await drawVetterTokens(a, COMMUNITY, criterion)
      expect(warn).not.toHaveBeenCalled()
    })

    it('a roll published beside the old label: the month that covers today is drawn, from its own tick 0', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(nov2)
      mockAsk.mockImplementation(async (_d: string, _t: string, payload: { tick: number }) =>
        answered(VTC_VETTER_TASK.pcsTokens, { label: 'token/2026-11', tick: payload.tick, preCredentials: ['zCPre'] })
      )
      const rolled = JSON.parse(JSON.stringify(criterion))
      rolled.vetting.ext['org.openvtc.hidden-vetting'].tokenLabels = ['token/2026-10', 'token/2026-11']
      const { a, warn } = logging()
      await expect(drawVetterTokens(a, COMMUNITY, rolled)).resolves.toEqual({ drawn: 1 })
      expect((sentToAgent(PCS_VETTER_TASK.tokensRequest) as { label: string }).label).toBe('token/2026-11')
      expect(ticksAsked()).toEqual([0])
      expect(warn).not.toHaveBeenCalled()
    })

    it('picks by date: never by the order published, never a month still to come', () => {
      const covering = { label: 'token/2026-11', start: nov }
      expect(monthLabelAt(['token/2026-10', 'token/2026-11'], nov2)).toEqual(covering)
      expect(monthLabelAt(['token/2026-11', 'token/2026-10'], nov2)).toEqual(covering)
      // Published ahead of its month: not asked for until it begins.
      const before = { label: 'token/2026-10', start: oct }
      expect(monthLabelAt(['token/2026-10', 'token/2026-11'], nov - 1)).toEqual(before)
      expect(monthLabelAt(['token/2026-11', 'token/2026-10'], nov - 1)).toEqual(before)
      const stale = { label: 'token/2026-09', start: sep, stale: true }
      expect(monthLabelAt(['token/2026-08', 'token/2026-09'], nov2)).toEqual(stale)
      expect(monthLabelAt(['token/2026-09', 'token/2026-08'], nov2)).toEqual(stale)
      expect(monthLabelAt(['token/2026-12'], nov2)).toBeUndefined()
      expect(monthLabelAt(['token/event/summit'], nov2)).toBeUndefined()
      expect(monthLabelAt([], nov2)).toBeUndefined()
    })

    it('the desk still says when more can be drawn', () => {
      const parameters = { tokenLabels: ['token/2026-10'], tickLength: 'P3D' } as never
      expect(nextTickOpensAt(parameters, nov2)).toBe(new Date(oct + 33 * 86400 * 1000).toISOString())
    })

    it('with no label that has begun it asks nothing, warns, and refuses in the code the desk words', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 30, 12))
      const { a, warn } = logging()
      await expect(drawVetterTokens(a, COMMUNITY, criterion)).rejects.toMatchObject({
        code: PCS_VETTER_ERROR.tokensLabelNotLive,
      })
      expect(mockAsk).not.toHaveBeenCalled()
      expect(sentToAgent(PCS_VETTER_TASK.tokensRequest)).toBeUndefined()
      expect(warn).toHaveBeenCalledWith('[hidden-vetting] token/2026-09 is not published: no label to draw under')
    })
  })
})

describe('a fresh agent, with no vetter engine yet (build 261 stopped here)', () => {
  // What vta-service 0.60 answers vetter/show for an agent never enrolled in
  // this community: a refusal, which the client throws as a VtiRefusal.
  const noEngine = () => new VtiRefusal('vta/pcs/vetter/show:notFound', 'no such engine')
  let engine: Record<string, unknown> | undefined
  beforeEach(() => {
    engine = undefined
    mockTask.mockImplementation(async (type: string, ...rest: unknown[]) => {
      if (type === PCS_VETTER_TASK.vetterShow) {
        if (!engine) throw noEngine()
        return { vetter: engine }
      }
      if (type === PCS_VETTER_TASK.rootRequest) {
        // root-request creates the engine on first use (operations/pcs.rs).
        engine = {
          contextId: 'vta',
          community: COMMUNITY,
          memberDid: SIGNER,
          id: rootRequestAnswer.request.id,
          enrolledLabels: [],
        }
        return rootRequestAnswer
      }
      if (type === PCS_VETTER_TASK.rootAccept) {
        engine = { ...engine, enrolledLabels: ['vetter/2026-10'] }
        return {}
      }
      if (type === PCS_VETTER_TASK.tokensRequest) return tokensRequestFor(rest[0])
      return {}
    })
    mockAsk.mockImplementation(async (_d: string, type: string, payload: { tick?: number }) =>
      type === VTC_VETTER_TASK.pcsRoot
        ? answered(VTC_VETTER_TASK.pcsRoot, { label: 'vetter/2026-10', preCredential: 'zBPreCred' })
        : answered(VTC_VETTER_TASK.pcsTokens, {
            label: 'token/2026-10',
            tick: payload.tick,
            preCredentials: ['zCPre', 'zDPre'],
          })
    )
  })

  it('is not enrolled, rather than a failure', async () => {
    await expect(isEnrolled(agent(), COMMUNITY, criterion)).resolves.toBe(false)
  })

  // The spelling of the refusal is not the question: a `notFound` in reply to
  // "show me this vetter's engine" means there is none, however it is written.
  // Matching only the fully qualified code would put a differently-spelled
  // agent back in build 261, where a fresh vetter could not enrol at all.
  it.each([
    ['fully qualified, as 0.60 sends it', 'vta/pcs/vetter/show:notFound'],
    ['bare', 'notFound'],
    ['another prefix', 'pcs/vetter:notFound'],
  ])('reads a %s notFound as no engine', async (_shape, code) => {
    mockTask.mockImplementation(async (type: string) => {
      if (type === PCS_VETTER_TASK.vetterShow) throw new VtiRefusal(code, 'no such engine')
      return {}
    })
    await expect(isEnrolled(agent(), COMMUNITY, criterion)).resolves.toBe(false)
  })

  it('still throws a refusal that is not a notFound', async () => {
    // The guard must stay narrow: an agent too old, or a phone not allowed,
    // is not "no engine yet" and must not be read as one.
    mockTask.mockImplementation(async (type: string) => {
      if (type === PCS_VETTER_TASK.vetterShow) throw new VtiRefusal('vta/pcs/vetter/show:permissionDenied', 'no')
      return {}
    })
    const code = await isEnrolled(agent(), COMMUNITY, criterion)
      .then(() => undefined)
      .catch((e: unknown) => (e as { code?: string }).code)
    expect(code).toBe('vta/pcs/vetter/show:permissionDenied')
  })

  it('the desk’s round goes on: notFound → root-request → pcs-root → root-accept, then the draw', async () => {
    // The order readyHiddenVetter runs them in.
    const a = agent()
    expect(await isEnrolled(a, COMMUNITY, criterion)).toBe(false)
    await enrolVetter(a, COMMUNITY, criterion)
    await expect(drawVetterTokens(a, COMMUNITY, criterion)).resolves.toEqual({ drawn: 2 })
    const order = mockTask.mock.calls.map(([t]) => String(t).replace('https://trusttasks.org/spec/', ''))
    expect(order).toEqual([
      'vta/pcs/vetter/show/0.1',
      'vta/pcs/vetter/show/0.1',
      'vta/pcs/root-request/0.1',
      'vta/pcs/root-accept/0.1',
      'vta/pcs/vetter/show/0.1',
      'vta/pcs/tokens/request/0.1',
      'vta/pcs/tokens/accept/0.1',
    ])
    expect(sentToAgent(PCS_VETTER_TASK.rootRequest).memberDid).toBe(SIGNER)
    expect(PCS_ROOT(sentToCommunity(VTC_VETTER_TASK.pcsRoot))).toBe(true)
  })

  it('the draw’s own engine read takes notFound as no engine, and leaves the answer to the agent', async () => {
    // Not enrolled is a state, so the draw does not die on the read; the agent
    // says what it says about drawing without an engine.
    await expect(drawVetterTokens(agent(), COMMUNITY, criterion)).resolves.toEqual({ drawn: 2 })
    expect(sentToAgent(PCS_VETTER_TASK.tokensRequest)).toBeDefined()
  })

  it('any other vetter/show refusal still stops the round', async () => {
    mockTask.mockImplementation(async (type: string) => {
      if (type === PCS_VETTER_TASK.vetterShow) throw new VtiRefusal('vta/pcs/vetter/show:forbidden', 'no')
      return {}
    })
    await expect(isEnrolled(agent(), COMMUNITY, criterion)).rejects.toMatchObject({
      code: 'vta/pcs/vetter/show:forbidden',
    })
    await expect(enrolVetter(agent(), COMMUNITY, criterion)).rejects.toMatchObject({
      code: 'vta/pcs/vetter/show:forbidden',
    })
    expect(mockAsk).not.toHaveBeenCalled()
  })
})
