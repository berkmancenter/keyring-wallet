/**
 * The applicant's half of hidden vetting in `vtiVetting`:
 *
 * - asking a vetter (`vetting/request/0.1`) carries the applicant's PCS
 *   identifier in `ext["org.openvtc.hidden-vetting"]`, as openvtc's
 *   `hidden::request_ext` sends it, because the join DID is not the name a
 *   vetter attests to;
 * - a vetter's attestation (`vetting/attestation/0.1`) is taken as it came and
 *   handed to the agent (`vta/pcs/verify-attestation`, through
 *   `takeHiddenAttestation`), never opened as a peer document and never stored
 *   beside who sent it.
 *
 * No attestation has reached a phone yet. The shapes here are the published
 * schemas' and the specification's own example, not a captured delivery.
 */
import { encodeTicketUri } from '@bifold/trust-tasks'

import {
  HIDDEN_VETTING_NS,
  VtiApplicant,
  readHiddenAttestation,
  type VettingApplication,
  type VtiVettingStore,
} from '../module/vtiVetting'
import { registryPath, expectNoDrift } from './fixtures/registryDrift'
import { VETTING_SCHEMA_DIR, vendoredValidatorIn } from './fixtures/vtcJoinSchemas'

const mockSend = jest.fn(async (..._args: unknown[]) => undefined)
const mockTake = jest.fn()
const mockLoadRecord = jest.fn()
const mockConnect = jest.fn(async () => undefined)
const CLIENT = { name: 'the agent client' }

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  // Signing is not what is tested here.
  signDocumentProof: jest.fn(async (_agent: unknown, doc: Record<string, unknown>) => ({ ...doc, proof: {} })),
}))
jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  vtiAgent: { send: (...a: unknown[]) => mockSend(...a), onInbound: () => () => undefined },
}))
jest.mock('../module/hiddenVetting', () => ({
  ...jest.requireActual('../module/hiddenVetting'),
  loadHiddenVettingRecord: (...a: unknown[]) => mockLoadRecord(...a),
  takeHiddenAttestation: (...a: unknown[]) => mockTake(...a),
}))
jest.mock('../module/vtaAgent', () => ({
  vtaAgent: {
    agentAddress: () => 'did:webvh:Qm:vta.example:agent',
    connect: () => mockConnect(),
    client: () => CLIENT,
  },
}))

const COMMUNITY = 'did:webvh:Qm:vtc.example:mine'
const VETTER = 'did:webvh:Qm:vta.example:vetter'
const PERSONA = {
  did: 'did:webvh:Qm:vta.example:me',
  communityDid: COMMUNITY,
  vtaKeyIds: { signing: 'did:webvh:Qm:vta.example:me#key-0', keyAgreement: 'did:webvh:Qm:vta.example:me#key-1' },
  kmsKeyIds: { signing: 's', keyAgreement: 'k' },
}
const ATTESTATION_TYPE = 'https://trusttasks.org/spec/vetting/attestation/0.1'
// The specification's own example (specs/vetting/attestation/0.1/spec.md).
const ATTESTATION = {
  suite: 'ps-ddh-bls12381',
  attestation: 'zBbsywyzdGiuJ3aCc147SQheEgDJFJHkgNKctAcZPqHkJqPcYTwKcWQV6wYqPnB1e9N',
  meta: {
    community: 'did:example:community',
    requirementsDigest: 'zQmdmF2WvyXF9dgZeb2W2VxxwYeSzqN3fBykoLTkru5QUYE',
    method: 'inPerson',
    claimsVerified: ['name.legal'],
    livenessConfirmed: true,
    declaredRelationship: 'none',
    identityCommitment: 'zQmPRccGTPKwUUB8nUdSGuK7oN8Ht7c6iEDsLqdK7LNsxKz',
    cardDigestMultibase: 'zQmRnZq46vDQnAzSuEnWz3zvfQoigbe23KtSp6S1Vm1UXuL',
    validFrom: '2026-09-20',
    validUntil: '2027-01-18',
    tokenLabel: 'token/2026-09',
    tokenSerial: 'zBKHjA2kQWBpQPgwiHBG1DrzCykjsvdMfnKBYrhiM4STW',
  },
  token: {
    label: 'token/2026-09',
    serial: 'zBKHjA2kQWBpQPgwiHBG1DrzCykjsvdMfnKBYrhiM4STW',
    shown: 'z26q5oFrp6i2aTKLp6Y6jsLESJMoNfZQwk8VKXc37c24bJPj5fwBoUEsqv51ADbnUNM',
  },
}
const HIDDEN_RECORD = {
  community: COMMUNITY,
  joinDid: PERSONA.did,
  applicationId: 'app-1',
  id: 'zApplicantPcsIdentifier',
  requirementsDigest: 'zQmDigest',
  parameters: {},
  held: 0,
  minimum: 2,
}

function memoryStore(application?: Partial<VettingApplication>) {
  let held = application
    ? ({
        communityDid: COMMUNITY,
        joinDid: PERSONA.did,
        minStatements: 1,
        requiredClaims: [],
        acceptedMethods: ['inPerson'],
        commitmentSalt: 's',
        claims: {},
        requests: [],
        startedAt: 't',
        ...application,
      } as VettingApplication)
    : undefined
  return {
    getApplication: async () => held,
    saveApplication: async (a: VettingApplication) => void (held = { ...a }),
  } as unknown as VtiVettingStore
}

function logger() {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}

const applicantWith = (store: VtiVettingStore, log = logger(), onChange = jest.fn()) =>
  new VtiApplicant({ config: { logger: log } } as never, PERSONA as never, store, {} as never, onChange)

/** The private inbound handler, as `vtiAgent.onInbound` calls it. */
const deliver = (applicant: VtiApplicant, m: Record<string, unknown>) =>
  (applicant as unknown as { inbound(m: unknown): Promise<void> }).inbound(m)

const attestationMessage = (body: unknown) => ({
  id: 'm-1',
  type: ATTESTATION_TYPE,
  from: VETTER,
  to: [PERSONA.did],
  thid: 'session-1',
  body,
})

beforeEach(() => {
  mockSend.mockClear()
  mockTake.mockReset()
  mockLoadRecord.mockReset()
  mockConnect.mockClear()
})

describe('the published shapes', () => {
  it('the specification example is an attestation the schema accepts, and the reader takes', () => {
    expect(vendoredValidatorIn(VETTING_SCHEMA_DIR, 'vetting-attestation.payload.schema.json')(ATTESTATION)).toBe(true)
    expect(readHiddenAttestation(ATTESTATION)).toEqual(ATTESTATION)
    // A TSP peer leg packs the body with its `type`; only the published members go on.
    expect(
      readHiddenAttestation({ ...ATTESTATION, type: 'https://trusttasks.org/spec/vetting/attestation/0.1' })
    ).toEqual(ATTESTATION)
  })

  it.each([
    ['nothing', undefined],
    ['a string', 'zAttestation'],
    ['no token', { ...ATTESTATION, token: undefined }],
    ['a token missing its serial', { ...ATTESTATION, token: { label: 'l', shown: 'z1' } }],
    ['no meta', { ...ATTESTATION, meta: undefined }],
    ['an attestation that is not a string', { ...ATTESTATION, attestation: 7 }],
  ])('the reader refuses %s, so nothing malformed reaches the agent', (_what, body) => {
    expect(readHiddenAttestation(body)).toBeUndefined()
  })
})

describe('asking a vetter', () => {
  const ticket = encodeTicketUri({
    community: COMMUNITY,
    vetter: VETTER,
    presentation: { code: { code: 'ABCD-EFGH' } },
  })
  const sentPayload = () => (mockSend.mock.calls[0][2] as { payload: Record<string, unknown> }).payload

  it('under a hidden criterion, carries the PCS identifier in ext, and the schema accepts the request', async () => {
    mockLoadRecord.mockResolvedValue(HIDDEN_RECORD)
    await applicantWith(memoryStore({})).requestVetter({ link: ticket })
    const payload = sentPayload()
    expect(payload.ext).toEqual({ [HIDDEN_VETTING_NS]: { suite: 'ps-ddh-bls12381', id: 'zApplicantPcsIdentifier' } })
    expect(payload.joinDid).toBe(PERSONA.did)
    expect(vendoredValidatorIn(VETTING_SCHEMA_DIR, 'vetting-request.payload.schema.json')(payload)).toBe(true)
  })

  it('on the named path, sends the request exactly as before: no ext', async () => {
    mockLoadRecord.mockResolvedValue(undefined)
    await applicantWith(memoryStore({})).requestVetter({ link: ticket })
    expect(sentPayload()).not.toHaveProperty('ext')
  })

  it('ignores a hidden application made for another join DID', async () => {
    mockLoadRecord.mockResolvedValue({ ...HIDDEN_RECORD, joinDid: 'did:webvh:Qm:vta.example:someone-else' })
    await applicantWith(memoryStore({})).requestVetter({ link: ticket })
    expect(sentPayload()).not.toHaveProperty('ext')
  })

  it('refuses to ask while the hidden application has no identifier, and sends nothing', async () => {
    mockLoadRecord.mockResolvedValue({ ...HIDDEN_RECORD, id: undefined })
    await expect(applicantWith(memoryStore({})).requestVetter({ link: ticket })).rejects.toThrow(/no identifier/)
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe("a vetter's attestation arriving", () => {
  it('is handed to the agent as it came, for this community, and the screen is told', async () => {
    mockLoadRecord.mockResolvedValue(HIDDEN_RECORD)
    mockTake.mockResolvedValue({ ...HIDDEN_RECORD, held: 1 })
    const log = logger()
    const onChange = jest.fn()
    // No named application: the hidden one is kept apart and is enough.
    await deliver(applicantWith(memoryStore(), log, onChange), attestationMessage(ATTESTATION))
    expect(mockConnect).toHaveBeenCalled()
    expect(mockTake).toHaveBeenCalledTimes(1)
    const [, client, community, attestation] = mockTake.mock.calls[0]
    expect(client).toBe(CLIENT)
    expect(community).toBe(COMMUNITY)
    expect(attestation).toEqual(ATTESTATION)
    expect(onChange).toHaveBeenCalled()
  })

  it('never writes down who sent it', async () => {
    mockLoadRecord.mockResolvedValue(HIDDEN_RECORD)
    mockTake.mockResolvedValue({ ...HIDDEN_RECORD, held: 1 })
    const log = logger()
    await deliver(applicantWith(memoryStore(), log), attestationMessage(ATTESTATION))
    const everything = JSON.stringify([
      log.debug.mock.calls,
      log.info.mock.calls,
      log.warn.mock.calls,
      log.error.mock.calls,
    ])
    expect(everything).not.toContain(VETTER)
    // Nor which community: the log leaves the device.
    expect(everything).not.toContain(COMMUNITY)
    expect(JSON.stringify(mockTake.mock.calls)).not.toContain(VETTER)
  })

  it('is dropped, without asking the agent, when it is not an attestation or there is no hidden application', async () => {
    mockLoadRecord.mockResolvedValue(HIDDEN_RECORD)
    await deliver(applicantWith(memoryStore()), attestationMessage({ suite: 'ps-ddh-bls12381' }))
    mockLoadRecord.mockResolvedValue(undefined)
    await deliver(applicantWith(memoryStore()), attestationMessage(ATTESTATION))
    expect(mockTake).not.toHaveBeenCalled()
  })

  it('is taken and dropped when the agent refuses it, since the same bytes would be refused again', async () => {
    mockLoadRecord.mockResolvedValue(HIDDEN_RECORD)
    mockTake.mockRejectedValue({ document: { payload: { code: 'vta/pcs/verify-attestation:wrongCommunity' } } })
    const log = logger()
    await expect(deliver(applicantWith(memoryStore(), log), attestationMessage(ATTESTATION))).resolves.toBeUndefined()
    expect(JSON.stringify(log.warn.mock.calls)).toContain('wrongCommunity')
  })

  it('is left for redelivery when the agent cannot be reached', async () => {
    mockLoadRecord.mockResolvedValue(HIDDEN_RECORD)
    mockTake.mockRejectedValue(new Error('socket closed'))
    await expect(deliver(applicantWith(memoryStore()), attestationMessage(ATTESTATION))).rejects.toThrow(
      'socket closed'
    )
  })
})

describe('the vendored schemas still match the registry', () => {
  const maybe = registryPath() ? it : it.skip

  maybe('the vendored copies are byte-identical to the commit PROVENANCE names', () => {
    expectNoDrift(VETTING_SCHEMA_DIR, {
      'vetting-attestation.payload.schema.json': 'specs/vetting/attestation/0.1/payload.schema.json',
      'vetting-request.payload.schema.json': 'specs/vetting/request/0.1/payload.schema.json',
      'vetting-shared-hidden-vetting.schema.json': 'specs/vetting/_shared/0.1/hidden-vetting.schema.json',
      'vetting-shared-vetting.schema.json': 'specs/vetting/_shared/0.1/vetting.schema.json',
      'framework-0.2.schema.json': 'specs/_framework/0.2/framework.schema.json',
      'framework-0.3.schema.json': 'specs/_framework/0.3/framework.schema.json',
    })
  })
})
