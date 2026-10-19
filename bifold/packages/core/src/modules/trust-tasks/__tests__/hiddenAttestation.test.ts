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
import { fakeAgent } from '../../../../__tests__/helpers/cardVault'
import { GenericRecordsCommunityStore } from '../module/VtiCommunityStore'
import { CREDENTIAL_EXCHANGE_ISSUE, receiveIssue } from '../module/vtiInbox'
import { registryPath, expectNoDrift } from './fixtures/registryDrift'
import { VETTING_SCHEMA_DIR, vendoredValidatorIn } from './fixtures/vtcJoinSchemas'

const mockSend = jest.fn(async (..._args: unknown[]) => undefined)
const mockTake = jest.fn()
const mockLoadRecord = jest.fn()
const mockFetchChallenge = jest.fn(async () => ({ challenge: 'z2Challenge', expiresAt: '2026-10-16T00:00:00Z' }))
const mockApply = jest.fn(async () => ({ effect: 'joined', requestId: 'req-9' }))
const mockExtensions = jest.fn(async () => ({ hiddenVetting: { proof: 'z2proof' } }))
const mockBegin = jest.fn(async () => HIDDEN_RECORD)
const mockConnect = jest.fn(async () => undefined)
const CLIENT = { name: 'the agent client' }

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
// The store's change events are deferred on a timer; nothing here listens for them.
jest.mock('../module/communityChanged', () => ({
  ...jest.requireActual('../module/communityChanged'),
  emitCommunityChanged: jest.fn(),
}))
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  // Signing is not what is tested here.
  signDocumentProof: jest.fn(async (_agent: unknown, doc: Record<string, unknown>) => ({ ...doc, proof: {} })),
}))
jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  vtiAgent: {
    send: (...a: unknown[]) => mockSend(...a),
    onInbound: () => () => undefined,
    fetchChallenge: (...a: unknown[]) => mockFetchChallenge(...a),
    apply: (...a: unknown[]) => mockApply(...a),
  },
}))
jest.mock('../module/hiddenVetting', () => ({
  ...jest.requireActual('../module/hiddenVetting'),
  loadHiddenVettingRecord: (...a: unknown[]) => mockLoadRecord(...a),
  takeHiddenAttestation: (...a: unknown[]) => mockTake(...a),
  hiddenSubmissionExtensions: (...a: unknown[]) => mockExtensions(...a),
  beginHiddenApplication: (...a: unknown[]) => mockBegin(...a),
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
  // The persona: "the DID the applicant joins the community as", which is what
  // the proof binds to. It was the phone's manager DID until 260, which made
  // `hiddenRequestExt`'s guard always false and sent private requests with no
  // hidden ext at all.
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
  mockFetchChallenge.mockClear()
  mockApply.mockClear()
  mockExtensions.mockClear()
  mockBegin.mockClear()
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
    // The wrong value this really took: the phone's identity at its own agent.
    // Until 260 that was what `beginHiddenApplication` stored, so this guard
    // fired on every normal application and the ext was dropped — a private
    // request answered with a named statement (258, 259).
    mockLoadRecord.mockResolvedValue({ ...HIDDEN_RECORD, joinDid: 'did:peer:2.Ephone' })
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

  describe('the request it answers moves on, so the screen leaves "checking"', () => {
    // The applicant's request as the session left it: card sent, waiting.
    const waiting = (session = 'session-1', vetterDid = VETTER) => ({
      vetterDid,
      requestDocumentId: `req-${session}`,
      status: 'cardSent' as const,
      session: {
        documentId: session,
        challenge: 'c',
        domain: COMMUNITY,
        requiredClaims: ['name.legal'],
        method: 'inPerson' as const,
        expiresAt: '2099-01-01T00:00:00Z',
        matchCode: 'PBWW-HACW',
      },
    })
    const requestsAfter = async (store: VtiVettingStore, m: Record<string, unknown>) => {
      mockLoadRecord.mockResolvedValue(HIDDEN_RECORD)
      mockTake.mockResolvedValue({ ...HIDDEN_RECORD, held: 1 })
      await deliver(applicantWith(store), m)
      return (await store.getApplication(COMMUNITY))?.requests ?? []
    }

    it('the request threaded on the attestation’s session is attested, with no statement id', async () => {
      const store = memoryStore({ requests: [waiting(), waiting('session-2', 'did:webvh:Qm:vta.example:other')] })
      const [answered, other] = await requestsAfter(store, attestationMessage(ATTESTATION))
      expect(answered.status).toBe('attested')
      expect(answered.statementId).toBeUndefined()
      expect(other.status).toBe('cardSent')
    })

    it('not when the agent refused it', async () => {
      const store = memoryStore({ requests: [waiting()] })
      mockLoadRecord.mockResolvedValue(HIDDEN_RECORD)
      mockTake.mockRejectedValue({ document: { payload: { code: 'vta/pcs/verify-attestation:wrongCommunity' } } })
      await deliver(applicantWith(store), attestationMessage(ATTESTATION))
      expect((await store.getApplication(COMMUNITY))?.requests[0].status).toBe('cardSent')
    })

    it('not for a session no request ran, nor from anyone but that request’s vetter', async () => {
      const store = memoryStore({ requests: [waiting()] })
      expect((await requestsAfter(store, { ...attestationMessage(ATTESTATION), thid: 'session-9' }))[0].status).toBe(
        'cardSent'
      )
      expect(
        (
          await requestsAfter(store, { ...attestationMessage(ATTESTATION), from: 'did:webvh:Qm:vta.example:stranger' })
        )[0].status
      ).toBe('cardSent')
    })
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

// Alberto, 2026-10-15: the same flow as named vetting, with the
// zero-knowledge part on the agent and detected from state. So these exercise
// the ordinary members a screen already calls — `start`, `checklist`,
// `submit` — on an application whose way in is private, and assert they behave
// privately without anyone passing a mode in.
describe('the named flow, applied to a private way in', () => {
  const manifest = {
    wire: '0.3',
    criteria: [
      {
        id: 'Vetted-Member',
        requirementsDigest: 'zQmDigest',
        // test-vtc's own `Vetted-Member` requirement, so the shape is one a
        // community really publishes and passes `checkVettingRequirements`.
        vetting: {
          version: '0.1',
          statementType: 'https://registry.trustoverip.org/dtg/vsc/vetted/1',
          minStatements: 1,
          acceptedMethods: ['inPerson', 'video'],
          requiredClaims: ['name.legal'],
          maxStatementAge: 'P120D',
          eligibleVetters: { role: 'vetter' },
          independence: { requireConsistentIdentityCommitment: true },
          invitation: 'none',
          ext: { 'org.openvtc.hidden-vetting': { suite: 'ps-ddh-bls12381' } },
        },
      },
    ],
  } as never

  // His 2026-10-15 run: the vetter was on an older build, sent a NAMED
  // statement for a private application, and the applicant's screen sat
  // unchanged. The statement passed every named check (its subject IS the join
  // DID), so it was accepted and counted for nothing.
  it('refuses a named statement in words, rather than keeping one that cannot count', async () => {
    mockLoadRecord.mockResolvedValue({ ...HIDDEN_RECORD, held: 0, minimum: 1 })
    const store = memoryStore({ requests: [{ vetterDid: VETTER, status: 'session', sentAt: 't' }] } as never)
    const applicant = applicantWith(store)
    await deliver(applicant, {
      id: 'm-2',
      type: 'https://trusttasks.org/spec/credential-exchange/issue/0.1',
      from: VETTER,
      to: [PERSONA.did],
      thid: 'session-1',
      body: {
        credential_response: {
          credential: {
            id: 'urn:uuid:statement-1',
            type: ['VerifiableCredential', 'StatementCredential'],
            issuer: VETTER,
            credentialSubject: {
              id: PERSONA.did,
              predicate: 'https://registry.trustoverip.org/dtg/vsc/vetted/1',
              object: { value: { method: 'inPerson', claimsVerified: ['name.legal'] } },
            },
          },
        },
      },
    })
    const kept = await store.getApplication(COMMUNITY)
    expect(kept?.requests?.[0]).toMatchObject({ status: 'statementRefused', statementRefusal: 'namedForPrivate' })
    // And the agent is never asked to verify a named statement.
    expect(mockTake).not.toHaveBeenCalled()
  })

  it('binds the agent-side application to the persona, not the phone at its agent', async () => {
    // 258 and 259 bound `client.managerDid`. The registry says this member is
    // "the DID the applicant joins the community as. Bound into the proof, so
    // the proof cannot be carried to another join" — the persona. Binding the
    // other one broke the ext silently and would have broken the proof too.
    mockLoadRecord.mockResolvedValue(undefined)
    await applicantWith(memoryStore()).start(manifest, { 'name.legal': 'A Person' })
    expect(mockBegin).toHaveBeenCalledTimes(1)
    expect(mockBegin.mock.calls[0]?.[4]).toBe(PERSONA.did)
    expect(mockBegin.mock.calls[0]?.[4]).not.toBe('did:peer:2.Ephone')
  })

  it('creates the agent-side application in the same tap as the named one', async () => {
    mockLoadRecord.mockResolvedValue(undefined)
    const store = memoryStore()
    await applicantWith(store).start(manifest, { 'name.legal': 'A Person' })
    // The private criterion is found from the manifest, and the shared
    // `beginHiddenApplication` is what creates it, so the two routes into a
    // private application cannot drift.
    expect(mockBegin).toHaveBeenCalledTimes(1)
    expect(mockBegin.mock.calls[0]?.[3]).toMatchObject({ id: 'Vetted-Member' })
  })

  it('still starts the named application when the agent cannot carry the private one', async () => {
    // A phone whose agent cannot do this has still started applying, and the
    // refusal belongs where the person acts, not at the start of a flow they
    // were offered.
    mockLoadRecord.mockResolvedValue(undefined)
    mockBegin.mockRejectedValueOnce(new Error('agentTooOld'))
    const store = memoryStore()
    await expect(applicantWith(store).start(manifest, { 'name.legal': 'A Person' })).resolves.toMatchObject({
      communityDid: COMMUNITY,
    })
  })

  it('counts vouches it cannot show, in the same shape the named checklist uses', async () => {
    mockLoadRecord.mockResolvedValue({ ...HIDDEN_RECORD, held: 1, minimum: 1 })
    const list = await applicantWith(memoryStore({})).checklist()
    expect(list).toMatchObject({
      mode: 'private',
      held: 1,
      counted: 1,
      needed: 1,
      meets: true,
      statements: [],
      discounted: 0,
      needs: [],
      // A community that cannot see who vouched cannot apply a relationship
      // cap, so this is true by the nature of the exchange, not by skipping it.
      independenceOk: true,
      exceededCaps: [],
    })
  })

  it('says what is still missing, and does not claim it meets the threshold', async () => {
    mockLoadRecord.mockResolvedValue({ ...HIDDEN_RECORD, held: 0, minimum: 2 })
    const list = await applicantWith(memoryStore({})).checklist()
    expect(list).toMatchObject({ mode: 'private', meets: false, needs: [{ kind: 'statements', n: 2 }] })
  })

  it('proves at submit, and sends the proof with no statements', async () => {
    mockLoadRecord.mockResolvedValue({ ...HIDDEN_RECORD, held: 1, minimum: 1 })
    const verdict = await applicantWith(memoryStore({})).submit(manifest, [], 'zQmDigest')
    expect(verdict).toMatchObject({ effect: 'joined' })
    // The challenge is read immediately before proving: a community replaces
    // any it had open, so one fetched earlier is already spent.
    expect(mockFetchChallenge).toHaveBeenCalledWith(COMMUNITY, { criterionId: 'Vetted-Member' })
    expect(mockExtensions.mock.calls[0]?.[3]).toBe('z2Challenge')
    // No statements: a submission carrying both would name the vetters the
    // proof keeps hidden.
    expect(mockApply.mock.calls[0]?.[2]).toMatchObject({
      credentials: [],
      hiddenVetting: { proof: 'z2proof' },
    })
  })

  it('records that the admission came through a proof, for the membership that follows', async () => {
    // The membership is filed later, by the inbox, and the credential says
    // nothing about how the community decided — so the submission carries it.
    mockLoadRecord.mockResolvedValue({ ...HIDDEN_RECORD, held: 1, minimum: 1 })
    const store = memoryStore({})
    const saved: Record<string, unknown>[] = []
    const community = { saveSubmission: async (x: Record<string, unknown>) => void saved.push(x) } as never
    await new VtiApplicant({ config: { logger: logger() } } as never, PERSONA as never, store, community).submit(
      manifest,
      [],
      'zQmDigest'
    )
    // Every save of the request's record, not only the first: each replaces the last.
    expect(saved.length).toBeGreaterThan(0)
    for (const record of saved) expect(record).toMatchObject({ via: 'vetting', privateVetting: true })
  })

  it('the membership that follows says it came through a proof: the mark survives to the card the inbox files', async () => {
    // With the store the phone uses, where a request's record is replaced on
    // every save, and the community's card filed by the inbox as on a phone.
    // Every save of the record has to keep the mark, not only the first.
    mockLoadRecord.mockResolvedValue({ ...HIDDEN_RECORD, held: 1, minimum: 1 })
    const { agent } = fakeAgent()
    const community = new GenericRecordsCommunityStore(agent)
    await new VtiApplicant(
      { config: { logger: logger() } } as never,
      PERSONA as never,
      memoryStore({}),
      community
    ).submit(manifest, [], 'zQmDigest')
    expect(await community.getSubmission(COMMUNITY, PERSONA.did)).toMatchObject({
      via: 'vetting',
      privateVetting: true,
    })

    const card = {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://firstperson.network/credentials/dtg/v1'],
      id: 'urn:uuid:9b0e5c1a-3d2f-4e6a-8b7c-1d2e3f4a5b6c',
      type: ['VerifiableCredential', 'DTGCredential', 'MembershipCredential'],
      issuer: COMMUNITY,
      validFrom: '2026-10-18T09:00:00Z',
      credentialSubject: { id: PERSONA.did },
      proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', proofValue: 'z-test' },
    }
    await receiveIssue(
      community,
      PERSONA.did,
      {
        id: 'urn:uuid:1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        type: CREDENTIAL_EXCHANGE_ISSUE,
        from: COMMUNITY,
        body: { credential_response: { credential: card } },
      } as never,
      { checkCard: async () => undefined }
    )
    expect(await community.getMembership(COMMUNITY, PERSONA.did)).toMatchObject({ privateVetting: true })
  })

  it('a private request under a directory statement keeps both: the mark and the statement it was shown', async () => {
    // One record per send, which both have to be in: dropping either is silent,
    // since both are optional (manifest/0.4, tf#823).
    mockLoadRecord.mockResolvedValue({ ...HIDDEN_RECORD, held: 1, minimum: 1 })
    const { agent } = fakeAgent()
    const community = new GenericRecordsCommunityStore(agent)
    const shown = { ...manifest, directoryDisclosure: { statementDigest: 'zQmShownStatement' } }
    await new VtiApplicant(
      { config: { logger: logger() } } as never,
      PERSONA as never,
      memoryStore({}),
      community
    ).submit(shown as never, [], 'zQmDigest')
    expect(await community.getSubmission(COMMUNITY, PERSONA.did)).toMatchObject({
      privateVetting: true,
      directoryStatementDigest: 'zQmShownStatement',
    })
  })

  it('refuses to submit a private way in with no private application, rather than naming vetters', async () => {
    // `start` could not create the agent-side application — an unreachable
    // agent, most likely. Falling through to the named path would send
    // statements for a hidden criterion and name the vetters a proof exists
    // to hide, which is the downgrade #405 prevents.
    mockLoadRecord.mockResolvedValue(undefined)
    const code = await applicantWith(memoryStore({}))
      .submit(manifest, [], 'zQmDigest')
      .then(() => undefined)
      .catch((e: unknown) => (e as { code?: string }).code)
    expect(code).toBe('keyring/hidden-vetting/submit:noApplication')
    expect(mockApply).not.toHaveBeenCalled()
  })

  it('leaves a named community alone, without reading the private record at all', async () => {
    // A named submit must not pay a store read, or be broken by one, for a
    // question that does not apply to it (three suites failed this way).
    mockLoadRecord.mockRejectedValue(new Error('no generic records here'))
    const named = {
      wire: '0.3',
      criteria: [{ id: 'Named', requirementsDigest: 'zQmNamed', vetting: { version: '0.1', minStatements: 1 } }],
    } as never
    await applicantWith(memoryStore({})).submit(named, [], 'zQmNamed')
    expect(mockApply).toHaveBeenCalledTimes(1)
    expect(mockApply.mock.calls[0]?.[2]).not.toMatchObject({ hiddenVetting: expect.anything() })
  })

  it('reads too few vouches as progress at submit, and sends nothing', async () => {
    mockLoadRecord.mockResolvedValue({ ...HIDDEN_RECORD, held: 0, minimum: 1 })
    mockExtensions.mockResolvedValueOnce('notEnoughYet' as never)
    const code = await applicantWith(memoryStore({}))
      .submit(manifest, [], 'zQmDigest')
      .then(() => undefined)
      .catch((e: unknown) => (e as { code?: string }).code)
    expect(code).toBe('vta/pcs/prove:noUsableAttestation')
    expect(mockApply).not.toHaveBeenCalled()
  })
})
