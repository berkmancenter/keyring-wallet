/**
 * The vetter's desk for hidden vetting (`VtiVetterDesk`):
 *
 * - a request that asks to be vetted privately carries the applicant's PCS
 *   identifier in `ext["org.openvtc.hidden-vetting"]`, and the desk keeps it as
 *   `hiddenApplicantId` — the only thing that tells a private request from a
 *   named one;
 * - `hiddenRequests` lists only those, never the named queue;
 * - `attestHidden` assembles the ten `meta` members, has the agent build the
 *   attestation, and delivers it to the applicant as `vetting/attestation/0.1`;
 * - a hidden request is declined through the ordinary decline.
 *
 * `now` is passed explicitly: in this package's jest environment `Date.now()`
 * and `new Date()` do not agree, and a date taken from one and compared with
 * the other reads correctly and computes nonsense.
 */
const sent: { to: string; type: string; body: unknown; options?: { thid?: string } }[] = []

jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  vtiAgent: {
    onInbound: () => () => undefined,
    send: jest.fn(async (to: string, type: string, body: unknown, options?: { thid?: string }) => {
      sent.push({ to, type, body, options })
    }),
  },
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))
// What `attest` reaches for when it dispatches a private request: the vetter's
// client and the community's current hidden criterion.
const mockPcsAttest = jest.fn(async () => ({
  suite: 'ps-ddh-bls12381',
  attestation: 'zAtt',
  meta: {},
  token: { label: 'l', serial: 'z1', shown: 'z2' },
}))
jest.mock('../module/hiddenVetterRounds', () => ({
  ...jest.requireActual('../module/hiddenVetterRounds'),
  connectedVetterClient: async () => ({ pcsAttest: mockPcsAttest }),
  vetterContextOf: async () => 'ctx-1',
  // A complete published config: `parametersToSend` refuses a partial one, so
  // a thin fixture here would pass for the wrong reason.
  currentHiddenCriterion: async () => ({
    id: 'Vetted-Member',
    requirementsDigest: 'zQmDigest',
    vetting: {
      minStatements: 1,
      ext: {
        'org.openvtc.hidden-vetting': {
          suite: 'ps-ddh-bls12381',
          helperKey: 'z6MkhelperKey',
          tokenKey: 'z6MktokenKey',
          vetterLabels: ['vetter/2026-10'],
          tokenLabels: ['token/2026-10'],
          dripPerTick: 3,
          tickLength: 'P3D',
          events: [],
        },
      },
    },
  }),
}))
jest.mock('@bifold/trust-tasks', () => {
  const actual = jest.requireActual('@bifold/trust-tasks')
  return { ...actual, signDocumentProof: jest.fn(async (_a: unknown, doc: unknown) => doc) }
})

import {
  HIDDEN_VETTING_NS,
  VtiVetterDesk,
  cardDigestMultibase,
  hiddenApplicantIdOf,
  type VettingDeskRequest,
  type VettingTicket,
} from '../module/vtiVetting'
import { VETTING_SCHEMA_DIR, vendoredValidatorIn } from './fixtures/vtcJoinSchemas'

const COMMUNITY = 'did:webvh:Qm:vtc.example:community'
const APPLICANT = 'did:webvh:Qm:vta.example:applicant'
const PCS_ID = 'zApplicantPcsIdentifier'
const SUITE = 'ps-ddh-bls12381'
const DIGEST = 'zQmdmF2WvyXF9dgZeb2W2VxxwYeSzqN3fBykoLTkru5QUYE'
const ATTESTATION_TYPE = 'https://trusttasks.org/spec/vetting/attestation/0.1'
const agent = { config: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } } } as never
const persona = {
  did: 'did:webvh:Qm:vta.example:vetter',
  communityDid: COMMUNITY,
  kmsKeyIds: { signing: 'sig' },
  vtaKeyIds: { signing: 'did:webvh:Qm:vta.example:vetter#key-0' },
} as never

const CARD = {
  identityCommitment: 'zQmPRccGTPKwUUB8nUdSGuK7oN8Ht7c6iEDsLqdK7LNsxKz',
  claims: [{ type: 'name.legal' }, { type: 'birthDate' }],
}
const SESSION = {
  documentId: 'urn:uuid:session-1',
  challenge: 'c',
  domain: APPLICANT,
  requiredClaims: ['name.legal'],
  method: 'inPerson' as const,
  expiresAt: '2099-01-01T00:00:00Z',
  matchCode: '123-456',
}

function memoryStore(rows: VettingDeskRequest[] = [], tickets: VettingTicket[] = []) {
  const desk = new Map(rows.map((r) => [r.requestId, { ...r }]))
  return {
    rows: () => [...desk.values()],
    store: {
      listTickets: async () => tickets,
      saveTicket: jest.fn(async () => undefined),
      listDesk: async () => [...desk.values()].map((r) => ({ ...r })),
      saveDesk: async (r: VettingDeskRequest) => void desk.set(r.requestId, { ...r }),
      getApplication: async () => undefined,
    } as never,
  }
}
const communityStore = { listHeldCredentials: async () => [], getMembership: async () => undefined } as never

const row = (over: Partial<VettingDeskRequest>): VettingDeskRequest => ({
  requestId: 'r-1',
  applicantDid: APPLICANT,
  communityDid: COMMUNITY,
  requirementsDigest: DIGEST,
  status: 'cardReceived',
  receivedAt: '2026-10-15T00:00:00Z',
  session: SESSION,
  card: CARD,
  hiddenApplicantId: PCS_ID,
  ...over,
})

const STATEMENT = {
  method: 'inPerson' as const,
  claimsVerified: ['name.legal'],
  livenessConfirmed: true,
  declaredRelationship: 'none' as const,
}
const NOW = Date.parse('2026-10-15T23:30:00Z')

beforeEach(() => {
  sent.length = 0
  jest.restoreAllMocks()
})

describe('reading the hidden-vetting ext', () => {
  it('takes the identifier under the suite this build implements', () => {
    expect(hiddenApplicantIdOf({ [HIDDEN_VETTING_NS]: { suite: SUITE, id: PCS_ID } })).toBe(PCS_ID)
  })

  it.each([
    ['no ext', undefined],
    ['another namespace', { 'org.example': { suite: SUITE, id: PCS_ID } }],
    ['another suite, which this build cannot honour', { [HIDDEN_VETTING_NS]: { suite: 'bbs-2023', id: PCS_ID } }],
    ['no identifier', { [HIDDEN_VETTING_NS]: { suite: SUITE } }],
    ['an empty identifier', { [HIDDEN_VETTING_NS]: { suite: SUITE, id: '' } }],
  ])('reads %s as the named path', (_what, ext) => expect(hiddenApplicantIdOf(ext)).toBeUndefined())
})

describe('taking a request', () => {
  const ticket: VettingTicket = {
    ticketId: 'vt-1',
    code: 'AAAA-BBBB',
    secret: 's',
    communityDid: COMMUNITY,
    usesLeft: 2,
    expiresAt: '2099-01-01T00:00:00Z',
    createdAt: '2026-10-01T00:00:00Z',
  }
  const request = (ext?: Record<string, unknown>) => ({
    id: 'urn:uuid:req-1',
    type: 'https://trusttasks.org/spec/vetting/request/0.1',
    from: APPLICANT,
    body: {
      id: 'urn:uuid:req-1',
      type: 'https://trusttasks.org/spec/vetting/request/0.1',
      issuer: APPLICANT,
      payload: {
        community: COMMUNITY,
        joinDid: APPLICANT,
        requirementsDigest: DIGEST,
        ticket: { code: 'AAAA-BBBB' },
        ...(ext ? { ext } : {}),
      },
    },
  })
  const take = async (ext?: Record<string, unknown>) => {
    const { store, rows } = memoryStore([], [{ ...ticket }])
    const desk = new VtiVetterDesk(agent, persona, store, communityStore)
    // An active grant, without the network: standing is not what is tested here.
    jest.spyOn(desk, 'grantWithState').mockResolvedValue({ state: { state: 'active' } } as never)
    jest.spyOn(desk, 'grant').mockResolvedValue(undefined)
    await (desk as unknown as { takeRequest: (m: unknown) => Promise<void> }).takeRequest(request(ext))
    return rows()
  }

  it('keeps the PCS identifier of a request that asks to be vetted privately', async () => {
    const [kept] = await take({ [HIDDEN_VETTING_NS]: { suite: SUITE, id: PCS_ID } })
    expect(kept.hiddenApplicantId).toBe(PCS_ID)
    expect(kept.status).toBe('accepted')
  })

  it('marks nothing on a named request, nor on one under a suite this build cannot honour', async () => {
    expect((await take())[0].hiddenApplicantId).toBeUndefined()
    expect(
      (await take({ [HIDDEN_VETTING_NS]: { suite: 'bbs-2023', id: PCS_ID } }))[0].hiddenApplicantId
    ).toBeUndefined()
  })
})

describe('the private queue', () => {
  it('holds only open requests that asked to be vetted privately, for this community', async () => {
    const { store } = memoryStore([
      row({ requestId: 'hidden-open' }),
      row({ requestId: 'named', hiddenApplicantId: undefined }),
      row({ requestId: 'hidden-done', status: 'attested' }),
      row({ requestId: 'hidden-declined', status: 'declined' }),
      row({ requestId: 'hidden-elsewhere', communityDid: 'did:webvh:Qm:vtc.example:other' }),
    ])
    const desk = new VtiVetterDesk(agent, persona, store, communityStore)
    expect((await desk.hiddenRequests(COMMUNITY)).map((r) => r.requestId)).toEqual(['hidden-open'])
  })
})

describe('vouching privately', () => {
  const desk = (rows: VettingDeskRequest[]) => {
    const s = memoryStore(rows)
    return { desk: new VtiVetterDesk(agent, persona, s.store, communityStore), rows: s.rows }
  }
  const ATTESTATION = { suite: SUITE, attestation: 'zAtt', meta: {}, token: { label: 'l', serial: 'z1', shown: 'z2' } }

  it('builds the ten meta members, and the published schema accepts them', async () => {
    const build = jest.fn(async () => ATTESTATION)
    await desk([row({})]).desk.attestHidden('r-1', STATEMENT, build, NOW)
    expect(build).toHaveBeenCalledTimes(1)
    const [{ applicantId, meta }] = build.mock.calls[0] as unknown as [
      { applicantId: string; meta: Record<string, unknown> },
    ]
    expect(applicantId).toBe(PCS_ID)
    expect(meta).toEqual({
      community: COMMUNITY,
      requirementsDigest: DIGEST,
      method: 'inPerson',
      claimsVerified: ['name.legal'],
      livenessConfirmed: true,
      declaredRelationship: 'none',
      identityCommitment: CARD.identityCommitment,
      cardDigestMultibase: cardDigestMultibase(CARD),
      validFrom: '2026-10-15',
      validUntil: '2027-02-12',
    })
    // The attest task's meta is the shared StatementMeta less the token members,
    // which the agent fills in from the token it spends.
    const statementMeta = vendoredValidatorIn(
      VETTING_SCHEMA_DIR,
      'vetting-shared-hidden-vetting.schema.json',
      '/$defs/StatementMeta'
    )
    expect(statementMeta({ ...meta, tokenLabel: 'token/2026-10', tokenSerial: 'zBKHjA2kQWBpQPgw' })).toBe(true)
  })

  // Build 258's defect, and the only test that would have caught it: the
  // screens call ONE method for both kinds of request, and on 258 that method
  // had no dispatch, so a private request was answered with a named statement.
  // 03's tests proved the screen calls `attest`; 32's proved `attestHidden`
  // works; nothing proved the call arrived there.
  describe('the one method the screens call', () => {
    const named = { documentClasses: ['passport'], claimsVerified: ['name.legal'], livenessConfirmed: true }
    beforeEach(() => mockPcsAttest.mockClear())

    it('sends a private request down the private path, never the named one', async () => {
      const shape = jest.spyOn(VtiVetterDesk.prototype as never, 'statementShapeFor' as never)
      const { desk: d, rows } = desk([row({})])
      await d.attest('r-1', { ...named, declaredRelationship: 'none' })
      // The agent built a PCS attestation...
      expect(mockPcsAttest).toHaveBeenCalledTimes(1)
      expect(mockPcsAttest.mock.calls[0]?.[0]).toMatchObject({
        community: COMMUNITY,
        applicantId: PCS_ID,
        contextId: 'ctx-1',
      })
      // ...and the named writer was never reached.
      expect(shape).not.toHaveBeenCalled()
      expect(rows().find((r) => r.requestId === 'r-1')?.status).toBe('attested')
      shape.mockRestore()
    })

    it('says what blocked the round, rather than sending them to a desk that cannot help', async () => {
      // A vetter whose engine is bound to the wrong DID cannot draw. Telling
      // them "draw tokens first" would send them round in a circle (32).
      const { desk: d } = desk([row({})])
      ;(d as unknown as { hiddenRoundFailure?: string }).hiddenRoundFailure = 'keyring/hidden-vetter:memberMismatch'
      const code = await d
        .attest('r-1', { ...named, declaredRelationship: 'none' })
        .then(() => undefined)
        .catch((e: unknown) => (e as { code?: string }).code)
      expect(code).toBe('keyring/hidden-vetter:memberMismatch')
      expect(mockPcsAttest).not.toHaveBeenCalled()
    })

    it('refuses rather than guess how the vetter knows the person', async () => {
      // `declaredRelationship` is a human judgement and a member of the
      // attestation the community verifies, so a missing one is refused.
      const { desk: d } = desk([row({})])
      const code = await d
        .attest('r-1', named)
        .then(() => undefined)
        .catch((e: unknown) => (e as { code?: string }).code)
      expect(code).toBe('vtiVetting/attest:noDeclaredRelationship')
      expect(mockPcsAttest).not.toHaveBeenCalled()
    })

    it('leaves a named request on the named path', async () => {
      const { desk: d } = desk([row({ hiddenApplicantId: undefined })])
      await d.attest('r-1', named).catch(() => undefined)
      expect(mockPcsAttest).not.toHaveBeenCalled()
    })
  })

  it('takes both dates from one clock, as dates and never as times', async () => {
    const build = jest.fn(async () => ATTESTATION)
    await desk([row({})]).desk.attestHidden(
      'r-1',
      { ...STATEMENT, validDays: 1 },
      build,
      Date.parse('2026-12-31T23:59:59Z')
    )
    const [{ meta }] = build.mock.calls[0] as unknown as [{ meta: { validFrom: string; validUntil: string } }]
    expect(meta.validFrom).toBe('2026-12-31')
    expect(meta.validUntil).toBe('2027-01-01')
  })

  it('delivers the attestation to the applicant as it came, threaded on the session, and closes the request', async () => {
    const { desk: d, rows } = desk([row({})])
    await d.attestHidden('r-1', STATEMENT, async () => ATTESTATION, NOW)
    expect(sent).toEqual([
      { to: APPLICANT, type: ATTESTATION_TYPE, body: ATTESTATION, options: { thid: SESSION.documentId } },
    ])
    expect(rows()[0].status).toBe('attested')
    // Nothing that would name this vetter beside it.
    expect(rows()[0].statementId).toBeUndefined()
  })

  it.each([
    ['a named request', row({ hiddenApplicantId: undefined }), /did not ask to be vetted privately/],
    ['one already answered', row({ status: 'attested' }), /already attested/],
    ['one declined', row({ status: 'declined' }), /already declined/],
    ['one with no card yet', row({ card: undefined, status: 'session' }), /no card/],
    ['one that named no criterion', row({ requirementsDigest: undefined }), /named no criterion/],
  ])('refuses %s, without asking the agent or sending anything', async (_what, r, message) => {
    const build = jest.fn(async () => ATTESTATION)
    await expect(desk([r]).desk.attestHidden('r-1', STATEMENT, build, NOW)).rejects.toThrow(message)
    expect(build).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })

  it('refuses without the person present, or for a claim the card does not carry or the session required', async () => {
    const build = jest.fn(async () => ATTESTATION)
    const d = desk([row({})]).desk
    await expect(d.attestHidden('r-1', { ...STATEMENT, livenessConfirmed: false }, build, NOW)).rejects.toThrow(
      /match code/
    )
    await expect(
      d.attestHidden('r-1', { ...STATEMENT, claimsVerified: ['name.legal', 'nationality'] }, build, NOW)
    ).rejects.toThrow(/does not carry nationality/)
    await expect(d.attestHidden('r-1', { ...STATEMENT, claimsVerified: ['birthDate'] }, build, NOW)).rejects.toThrow(
      /name.legal was not verified/
    )
    expect(build).not.toHaveBeenCalled()
  })

  it('leaves the request open when the agent cannot build the attestation', async () => {
    const { desk: d, rows } = desk([row({})])
    await expect(
      d.attestHidden('r-1', STATEMENT, async () => Promise.reject(new Error('vta/pcs/attest:noToken')), NOW)
    ).rejects.toThrow('noToken')
    expect(sent).toHaveLength(0)
    expect(rows()[0].status).toBe('cardReceived')
  })
})

describe('declining a private request', () => {
  it('goes through the ordinary decline, to the applicant', async () => {
    const { store, rows } = memoryStore([row({})])
    await new VtiVetterDesk(agent, persona, store, communityStore).decline('r-1')
    expect(sent.map((s) => s.type)).toEqual(['https://trusttasks.org/spec/vetting/decline/0.1'])
    expect(sent[0].to).toBe(APPLICANT)
    expect(rows()[0].status).toBe('declined')
  })
})
