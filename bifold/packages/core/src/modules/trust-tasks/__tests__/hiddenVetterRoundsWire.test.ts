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
  },
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

import { enrolVetter, drawVetterTokens, isEnrolled } from '../module/hiddenVetterRounds'
import { PCS_VETTER_TASK, VTC_VETTER_TASK } from '../module/pcsVetterTasks'
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
  mockTask.mockImplementation(async (type: string) => {
    if (type === PCS_VETTER_TASK.rootRequest) return rootRequestAnswer
    if (type === PCS_VETTER_TASK.tokensRequest) return tokensRequestAnswer
    return {}
  })
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
      answered(VTC_VETTER_TASK.pcsTokens, { label: 'token/2026-10', tick: 1, preCredentials: ['zCPre', 'zDPre'] })
    )
  )

  it('carries the agent’s draw as the pcs-tokens schema requires, and hands back as tokens/accept requires', async () => {
    await expect(drawVetterTokens(agent(), COMMUNITY, criterion)).resolves.toEqual({ drawn: 2 })
    const carried = sentToCommunity(VTC_VETTER_TASK.pcsTokens)
    expect(PCS_TOKENS(carried)).toBe(true)
    expect(carried).toEqual(tokensRequestAnswer.request)
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
    expect(abandon.draw).toEqual({ label: 'token/2026-10', tick: 1 })
    // Not recorded as drawn, so the next round tries this tick again.
    mockAsk.mockResolvedValue(
      answered(VTC_VETTER_TASK.pcsTokens, { label: 'token/2026-10', tick: 1, preCredentials: ['zCPre', 'zDPre'] })
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
    mockTask.mockImplementation(async (type: string) => {
      if (type === PCS_VETTER_TASK.vetterShow) return typeof show === 'function' ? show() : show
      if (type === PCS_VETTER_TASK.rootRequest) return rootRequest
      if (type === PCS_VETTER_TASK.tokensRequest) return tokensRequestAnswer
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

  it('a re-enrolment that would carry a new PCS identifier is not sent (the community refuses identifierRebound)', async () => {
    answering(engineBoundTo(MANAGER, { id: 'z9AnotherKey' }))
    await expect(enrolVetter(agent(), COMMUNITY, criterion)).rejects.toMatchObject({
      code: 'keyring/hidden-vetter:memberMismatch',
    })
    expect(mockAsk).not.toHaveBeenCalled()
  })

  it('an engine that keeps the old DID after re-enrolling is said once, then not re-enrolled again', async () => {
    const community = 'did:webvh:QmCommScid:vtc.example:tvtc-wq49'
    answering(engineBoundTo(MANAGER))
    mockAsk.mockResolvedValue(
      answered(VTC_VETTER_TASK.pcsRoot, { label: 'vetter/2026-10', preCredential: 'zBPreCred' })
    )
    await expect(enrolVetter(agent(), community, criterion)).rejects.toMatchObject({
      code: 'keyring/hidden-vetter:memberMismatch',
    })
    expect(mockAsk).toHaveBeenCalledTimes(1)
    // Trying again would spend one of the community's re-issues for nothing.
    await expect(enrolVetter(agent(), community, criterion)).rejects.toMatchObject({
      code: 'keyring/hidden-vetter:memberMismatch',
    })
    expect(mockAsk).toHaveBeenCalledTimes(1)
  })

  it('an engine the re-enrolment re-binds is fine, and draws', async () => {
    let shows = 0
    answering(() => engineBoundTo(++shows === 1 ? MANAGER : SIGNER))
    mockAsk.mockResolvedValue(
      answered(VTC_VETTER_TASK.pcsRoot, { label: 'vetter/2026-10', preCredential: 'zBPreCred' })
    )
    await expect(enrolVetter(agent(), COMMUNITY, criterion)).resolves.toBeUndefined()
    mockAsk.mockResolvedValue(
      answered(VTC_VETTER_TASK.pcsTokens, { label: 'token/2026-10', tick: 1, preCredentials: ['zCPre', 'zDPre'] })
    )
    await expect(drawVetterTokens(agent(), COMMUNITY, criterion)).resolves.toEqual({ drawn: 2 })
  })
})
