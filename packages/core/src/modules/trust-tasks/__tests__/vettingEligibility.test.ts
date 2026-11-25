/**
 * The vetter's eligibility presentation, both seats, as the spec and the VTI
 * SDK make and judge it.
 *
 * Measured 2026-09-25: an openvtc applicant refused a Keyring vetter's
 * acceptance — "vetter eligibility presentation did not verify … nonce does
 * not match", and the response "breaks its published schema: \"authentication\"
 * was expected". Keyring's vetter bound the presentation to its own desk uuid
 * and signed it for assertionMethod; the spec binds it to the request
 * document's `id` and the applicant's `joinDid`, signed for authentication
 * (dtgwg-trust-tasks-tf specs/vetting/request/0.1/spec.md:105-113,
 * payload.schema.json:216-220). Keyring's applicant demanded assertionMethod,
 * so it refused every spec-correct presentation in turn.
 *
 * Everything here is really signed: did:key signers, eddsa-jcs-2022 through
 * the shipping signDocumentProof. The upstream vector
 * (fixtures/vti-upstream-eligibility.json) was signed by vta-sdk
 * build_eligibility_vp — never by Keyring's code — and is judged by Keyring's
 * applicant: the two-way check.
 */
const sent: { to: string; type: string; body: Record<string, unknown>; options?: unknown }[] = []

jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  vtiAgent: {
    send: jest.fn(async (to: string, type: string, body: Record<string, unknown>, options?: unknown) => {
      sent.push({ to, type, body, options })
    }),
    onInbound: () => () => undefined,
  },
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

// eslint-disable-next-line import/order
import { DidKey, TypedArrayEncoder } from '@credo-ts/core'
// eslint-disable-next-line import/order
import { ed25519 } from '@noble/curves/ed25519.js'
// eslint-disable-next-line import/order
import { sha256 } from '@noble/hashes/sha2.js'
// eslint-disable-next-line import/order
import { jcsCanonicalize, signDocumentProof, verifyDocumentProof } from '@bifold/trust-tasks'

// eslint-disable-next-line import/order
import upstream from './fixtures/vti-upstream-eligibility.json'
// eslint-disable-next-line import/order
import {
  VETTING,
  VtiApplicant,
  VtiVetterDesk,
  type VettingApplicationRequest,
  type VettingDeskRequest,
  type VettingTicket,
  type VtiVettingStore,
} from '../module/vtiVetting'

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }

/** A did:key over an Ed25519 key, and an agent that can sign as it — nothing else. */
function didKeySigner() {
  const secret = ed25519.utils.randomSecretKey()
  const publicKey = ed25519.getPublicKey(secret)
  const did = `did:key:z${TypedArrayEncoder.toBase58(new Uint8Array([0xed, 0x01, ...publicKey]))}`
  const document = DidKey.fromDid(did).didDocument
  const verificationMethodId = document.verificationMethod?.[0]?.id as string
  const agent = {
    config: { logger },
    dids: { resolveDidDocument: async (d: string) => DidKey.fromDid(d).didDocument },
    dependencyManager: {
      resolve: () => ({
        sign: async ({ data }: { data: Uint8Array }) => ({ signature: ed25519.sign(data, secret) }),
      }),
    },
  }
  return { did, verificationMethodId, agent, secret }
}

/** eddsa-jcs-2022 by hand, for a proof shape the shipping signer refuses to make. */
function handSign(secret: Uint8Array, doc: Record<string, unknown>, verificationMethod: string, purpose: string) {
  const proofConfig = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    created: '2026-09-25T00:00:00Z',
    verificationMethod,
    proofPurpose: purpose,
  }
  const input = new Uint8Array([
    ...sha256(new TextEncoder().encode(jcsCanonicalize(proofConfig))),
    ...sha256(new TextEncoder().encode(jcsCanonicalize(doc))),
  ])
  return {
    ...doc,
    proof: { ...proofConfig, proofValue: `z${TypedArrayEncoder.toBase58(ed25519.sign(input, secret))}` },
  }
}

const community = didKeySigner()
const vetter = didKeySigner()
const applicantKey = didKeySigner()
const REQUEST_DOC_ID = 'urn:uuid:5b1d7a4e-request-document'
const DESK_UUID = '0f2c8a91-desk-request-id'
// `new Date()`: the test setup pins Date.now() to 2024.
const realNow = () => new Date()

async function grantFor(
  subject: string,
  options: { role?: string; validFrom?: string; validUntil?: string; issuer?: ReturnType<typeof didKeySigner> } = {}
) {
  const issuer = options.issuer ?? community
  return signDocumentProof(
    issuer.agent as never,
    {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://firstperson.network/credentials/dtg/v1'],
      type: ['VerifiableCredential', 'DTGCredential', 'EndorsementCredential'],
      id: 'urn:uuid:grant-1',
      issuer: issuer.did,
      validFrom: options.validFrom ?? new Date(realNow().getTime() - 86400000).toISOString(),
      validUntil: options.validUntil ?? new Date(realNow().getTime() + 90 * 86400000).toISOString(),
      credentialSubject: {
        id: subject,
        endorsement: { type: 'CommunityRole', role: options.role ?? 'vetter', communityDid: community.did },
      },
    },
    issuer.did,
    { kmsKeyId: 'community', verificationMethodId: issuer.verificationMethodId }
  )
}

beforeEach(() => {
  sent.length = 0
  jest.clearAllMocks()
})

// ---------------------------------------------------------------------------
// documentProof: the authentication purpose
// ---------------------------------------------------------------------------

describe('a document proof for authentication', () => {
  it('is signed with a key from the authentication relationship, and verifies only as that', async () => {
    const vp = await signDocumentProof(vetter.agent as never, { holder: vetter.did }, vetter.did, {
      kmsKeyId: 'vetter',
      verificationMethodId: vetter.verificationMethodId,
      proofPurpose: 'authentication',
    })
    const proof = vp.proof as Record<string, unknown>
    expect(proof.proofPurpose).toBe('authentication')
    expect(DidKey.fromDid(vetter.did).didDocument.authentication).toContain(proof.verificationMethod)
    await expect(
      verifyDocumentProof(vetter.agent as never, vp, vetter.did, { proofPurpose: 'authentication' })
    ).resolves.toBe(true)
    // Existing callers are not weakened: their default stays assertionMethod.
    await expect(verifyDocumentProof(vetter.agent as never, vp, vetter.did)).resolves.toBe(false)
  })

  it('is refused for a key the DID does not list under authentication', async () => {
    const assertionOnly = {
      ...vetter.agent,
      dids: {
        resolveDidDocument: async (d: string) => {
          const doc = DidKey.fromDid(d).didDocument
          return Object.assign(Object.create(Object.getPrototypeOf(doc)), doc, { authentication: [] })
        },
      },
    }
    await expect(
      signDocumentProof(assertionOnly as never, { holder: vetter.did }, vetter.did, {
        kmsKeyId: 'vetter',
        verificationMethodId: vetter.verificationMethodId,
        proofPurpose: 'authentication',
      })
    ).rejects.toThrow(/authentication/)
    // …and a proof claiming authentication with that key does not verify.
    const forged = handSign(vetter.secret, { holder: vetter.did }, vetter.verificationMethodId, 'authentication')
    await expect(
      verifyDocumentProof(assertionOnly as never, forged, vetter.did, { proofPurpose: 'authentication' })
    ).resolves.toBe(false)
    await expect(
      verifyDocumentProof(vetter.agent as never, forged, vetter.did, { proofPurpose: 'authentication' })
    ).resolves.toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The vetter's desk
// ---------------------------------------------------------------------------

function vetterDesk() {
  const tickets: VettingTicket[] = [
    {
      ticketId: 'vt-1',
      code: 'AAAA-BBBB',
      secret: 'shhh',
      communityDid: community.did,
      usesLeft: 1,
      expiresAt: new Date(realNow().getTime() + 86400000).toISOString(),
      createdAt: realNow().toISOString(),
    },
  ]
  const desk: VettingDeskRequest[] = []
  const store = {
    listTickets: async () => tickets.map((t) => ({ ...t })),
    saveTicket: jest.fn(async (t: VettingTicket) => {
      tickets.splice(
        tickets.findIndex((x) => x.ticketId === t.ticketId),
        1,
        { ...t }
      )
    }),
    listDesk: async () => desk.map((r) => ({ ...r })),
    saveDesk: jest.fn(async (r: VettingDeskRequest) => {
      const at = desk.findIndex((x) => x.requestId === r.requestId)
      if (at >= 0) desk[at] = { ...r }
      else desk.push({ ...r })
    }),
  } as unknown as VtiVettingStore
  const persona = {
    did: vetter.did,
    communityDid: community.did,
    vtaKeyIds: { signing: vetter.verificationMethodId, keyAgreement: vetter.verificationMethodId },
    kmsKeyIds: { signing: 'vetter', keyAgreement: 'vetter' },
  }
  const make = async () => {
    const grant = await grantFor(vetter.did)
    const communityStore = {
      listHeldCredentials: async () => [
        {
          kind: 'vetter-grant',
          communityDid: community.did,
          subjectDid: vetter.did,
          credential: grant,
          receivedAt: realNow().toISOString(),
        },
      ],
    }
    return new VtiVetterDesk(vetter.agent as never, persona as never, store, communityStore as never)
  }
  return { make, store, desk, tickets }
}

/** The applicant's request, as a DIDComm message whose own id is NOT the document's. */
const requestMessage = {
  id: 'urn:uuid:didcomm-message-id',
  type: VETTING.request,
  from: applicantKey.did,
  to: [vetter.did],
  body: {
    id: REQUEST_DOC_ID,
    type: VETTING.request,
    issuer: applicantKey.did,
    recipient: vetter.did,
    issuedAt: '2026-09-25T00:00:00Z',
    payload: { community: community.did, joinDid: applicantKey.did, ticket: { code: 'AAAA-BBBB' } },
  },
}

const take = (desk: VtiVetterDesk, m: unknown) =>
  (desk as unknown as { takeRequest(m: unknown): Promise<void> }).takeRequest(m)

describe("Keyring's vetter accepting a request", () => {
  it('presents its grant bound to the request document id and the join DID, signed for authentication', async () => {
    const { make } = vetterDesk()
    await take(await make(), requestMessage)

    expect(sent).toHaveLength(1)
    const payload = sent[0].body.payload as Record<string, unknown>
    const vp = payload.eligibilityVp as Record<string, unknown>
    const proof = vp.proof as Record<string, unknown>
    expect(vp.holder).toBe(vetter.did)
    expect(vp.nonce).toBe(REQUEST_DOC_ID)
    expect(vp.nonce).not.toBe(payload.requestId)
    expect(vp.domain).toBe(applicantKey.did)
    expect(proof.proofPurpose).toBe('authentication')
    expect(DidKey.fromDid(vetter.did).didDocument.authentication).toContain(proof.verificationMethod)
    await expect(
      verifyDocumentProof(vetter.agent as never, vp, vetter.did, { proofPurpose: 'authentication' })
    ).resolves.toBe(true)
    // Threaded on the request document, as trust-tasks-rs respond_with does.
    expect(sent[0].body.threadId).toBe(REQUEST_DOC_ID)

    // …and Keyring's own applicant takes it as eligible.
    const { deliver, request } = applicant({ now: realNow() })
    await deliver({ requestId: payload.requestId, eligibilityVp: vp })
    expect(request()).toMatchObject({ status: 'accepted', eligibilityOk: true })
    expect(request().eligibilityRefusal).toBeUndefined()
  })

  it('takes one request once, however many copies arrive and however they race', async () => {
    const { make, store } = vetterDesk()
    // Two desks, as a screen left and re-entered leaves two listeners.
    const [one, two] = [await make(), await make()]
    await Promise.all([take(one, requestMessage), take(two, requestMessage)])
    await take(one, requestMessage)
    await take(two, { ...requestMessage, id: 'urn:uuid:the-same-request-redelivered' })

    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe(`${VETTING.request}#response`)
    expect(store.saveTicket).toHaveBeenCalledTimes(1)
    expect(store.saveDesk).toHaveBeenCalledTimes(1)
  })

  it('still takes a different request from the same applicant', async () => {
    const { make, tickets } = vetterDesk()
    tickets[0].usesLeft = 2
    const desk = await make()
    await take(desk, requestMessage)
    await take(desk, { ...requestMessage, body: { ...requestMessage.body, id: 'urn:uuid:a-second-request' } })
    expect(sent).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// The applicant
// ---------------------------------------------------------------------------

function applicant(
  options: {
    now?: Date
    role?: string
    joinDid?: string
    communityDid?: string
    vetterDid?: string
    requestDocumentId?: string
    agent?: unknown
  } = {}
) {
  const application = {
    communityDid: options.communityDid ?? community.did,
    joinDid: options.joinDid ?? applicantKey.did,
    minStatements: 1,
    requiredClaims: ['name.legal'],
    acceptedMethods: ['inPerson'],
    vetterRole: options.role,
    commitmentSalt: 'salt',
    claims: {},
    startedAt: 't',
    requests: [
      {
        vetterDid: options.vetterDid ?? vetter.did,
        requestDocumentId: options.requestDocumentId ?? REQUEST_DOC_ID,
        status: 'sent',
        updatedAt: 't',
      },
    ],
  }
  const store = {
    getApplication: async () => application,
    saveApplication: jest.fn(async (a: typeof application) => {
      application.requests = a.requests
    }),
  } as unknown as VtiVettingStore
  const persona = { did: application.joinDid, communityDid: application.communityDid }
  const vti = new VtiApplicant(
    (options.agent ?? applicantKey.agent) as never,
    persona as never,
    store,
    {} as never,
    undefined,
    { now: () => options.now ?? new Date('2026-10-01T00:00:00Z') }
  )
  const from = options.vetterDid ?? vetter.did
  // Straight to the acceptance handler, past the envelope check: what is judged
  // here is the presentation inside. The envelope (its proof, issuer, type) is
  // opened before this runs — inboundProofs.test.ts — and the upstream vector
  // below comes with no key to sign an envelope as its vetter.
  const deliver = (payload: Record<string, unknown>) =>
    (vti as unknown as { accepted(m: unknown): Promise<void> }).accepted({
      type: `${VETTING.request}#response`,
      from,
      to: [application.joinDid],
      thid: options.requestDocumentId ?? REQUEST_DOC_ID,
      body: { issuer: from, threadId: options.requestDocumentId ?? REQUEST_DOC_ID, payload },
    })
  const request = () => application.requests[0] as unknown as VettingApplicationRequest
  return { deliver, request }
}

/** A presentation as the spec shapes it, signed by `holder` for `purpose`. */
async function presentation(
  overrides: { nonce?: string; domain?: string; purpose?: string; holder?: ReturnType<typeof didKeySigner> } = {},
  grant?: Record<string, unknown>
) {
  const holder = overrides.holder ?? vetter
  const vp = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiablePresentation'],
    holder: holder.did,
    verifiableCredential: [
      grant ?? (await grantFor(vetter.did, { validFrom: '2026-09-01T00:00:00Z', validUntil: '2027-03-01T00:00:00Z' })),
    ],
    nonce: overrides.nonce ?? REQUEST_DOC_ID,
    domain: overrides.domain ?? applicantKey.did,
  }
  return handSign(holder.secret, vp, holder.verificationMethodId, overrides.purpose ?? 'authentication')
}

describe("Keyring's applicant judging an eligibility presentation", () => {
  it('accepts one made as the spec says', async () => {
    const { deliver, request } = applicant()
    await deliver({ requestId: 'openvtc-request-1', eligibilityVp: await presentation() })
    expect(request()).toMatchObject({
      status: 'accepted',
      eligibilityOk: true,
      grantValidFrom: '2026-09-01T00:00:00Z',
      grantValidUntil: '2027-03-01T00:00:00Z',
    })
    expect(request().eligibilityRefusal).toBeUndefined()
    expect(request().eligibilityLegacy).toBeUndefined()
  })

  it('accepts `custom:vetter` for `vetter`, as role_matches does', async () => {
    const { deliver, request } = applicant({ role: 'custom:vetter' })
    await deliver({ requestId: 'r', eligibilityVp: await presentation() })
    expect(request()).toMatchObject({ eligibilityOk: true })
  })

  it.each([
    ['nonce', { nonce: 'urn:uuid:some-other-request' }],
    ['domain', { domain: 'did:key:z6MkSomeoneElse' }],
    ['proof', { purpose: 'assertionMethod' }],
  ])('refuses a wrong %s', async (reason, overrides) => {
    const { deliver, request } = applicant()
    await deliver({ requestId: 'r', eligibilityVp: await presentation(overrides) })
    expect(request()).toMatchObject({ status: 'accepted', eligibilityOk: false, eligibilityRefusal: reason })
  })

  it('refuses a presentation held by someone other than the vetter asked', async () => {
    const other = didKeySigner()
    const { deliver, request } = applicant()
    await deliver({ requestId: 'r', eligibilityVp: await presentation({ holder: other }) })
    expect(request()).toMatchObject({ eligibilityOk: false, eligibilityRefusal: 'holder' })
  })

  it('refuses a grant in a role other than the one the community asks for', async () => {
    const { deliver, request } = applicant({ role: 'custom:senior-vetter' })
    await deliver({ requestId: 'r', eligibilityVp: await presentation() })
    expect(request()).toMatchObject({ eligibilityOk: false, eligibilityRefusal: 'noRoleCredential' })
  })

  it('refuses a grant the community did not sign', async () => {
    const impostor = didKeySigner()
    const { proof: _proof, ...unsigned } = await grantFor(vetter.did, { issuer: impostor })
    const { deliver, request } = applicant({ now: realNow() })
    // Names the community as issuer and its key as signer, signed by someone else.
    const relabelled = handSign(
      impostor.secret,
      { ...unsigned, issuer: community.did },
      community.verificationMethodId,
      'assertionMethod'
    )
    await deliver({ requestId: 'r', eligibilityVp: await presentation({}, relabelled) })
    expect(request()).toMatchObject({ eligibilityOk: false, eligibilityRefusal: 'grantProof' })
  })

  it('refuses an expired grant', async () => {
    const { deliver, request } = applicant({ now: new Date('2027-03-02T00:00:00Z') })
    await deliver({ requestId: 'r', eligibilityVp: await presentation() })
    expect(request()).toMatchObject({ eligibilityOk: false, eligibilityRefusal: 'grantExpired' })
  })

  describe('from a Keyring vetter up to build 223', () => {
    // nonce = its desk uuid, echoed as requestId; domain = the applicant; assertionMethod.
    const legacy = () => presentation({ nonce: DESK_UUID, purpose: 'assertionMethod' })

    it('is accepted before the cutoff, and says why', async () => {
      const { deliver, request } = applicant({ now: new Date('2026-10-31T23:59:59Z') })
      await deliver({ requestId: DESK_UUID, eligibilityVp: await legacy() })
      expect(request()).toMatchObject({ eligibilityOk: true })
      expect(request().eligibilityLegacy).toMatch(/requestId/)
      expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/legacy Keyring shape/), expect.anything())
    })

    it('is refused from the cutoff', async () => {
      const { deliver, request } = applicant({ now: new Date('2026-11-01T00:00:00Z') })
      await deliver({ requestId: DESK_UUID, eligibilityVp: await legacy() })
      expect(request()).toMatchObject({ eligibilityOk: false, eligibilityRefusal: 'legacyExpired' })
    })

    it('is only that exact shape: a nonce that is not the echoed requestId gets no second path', async () => {
      const { deliver, request } = applicant({ now: new Date('2026-10-01T00:00:00Z') })
      await deliver({ requestId: 'some-other-id', eligibilityVp: await legacy() })
      expect(request()).toMatchObject({ eligibilityOk: false, eligibilityRefusal: 'nonce' })
    })
  })
})

// ---------------------------------------------------------------------------
// The upstream vector: built by vta-sdk build_eligibility_vp, judged by Keyring
// ---------------------------------------------------------------------------

describe('an eligibility presentation signed by the VTI SDK', () => {
  const expected = upstream.eligibility
  const vp = upstream.vp as unknown as Record<string, unknown>
  const resolver = {
    config: { logger },
    dids: { resolveDidDocument: async (d: string) => DidKey.fromDid(d).didDocument },
  }
  const judge = (overrides: { challenge?: string; domain?: string; role?: string; now?: string } = {}) =>
    applicant({
      agent: resolver,
      vetterDid: expected.vetter,
      communityDid: expected.community,
      joinDid: overrides.domain ?? expected.domain,
      requestDocumentId: overrides.challenge ?? expected.challenge,
      role: overrides.role ?? expected.role,
      now: new Date(overrides.now ?? expected.now),
    })

  it('is accepted with the expectations it was made for', async () => {
    expect((vp.proof as Record<string, unknown>).proofPurpose).toBe('authentication')
    const { deliver, request } = judge()
    await deliver({ requestId: 'upstream-request-id', eligibilityVp: vp })
    expect(request()).toMatchObject({ eligibilityOk: true, grantValidUntil: '2027-03-01T00:00:00Z' })
    expect(request().eligibilityLegacy).toBeUndefined()
  })

  it.each([
    ['nonce', { challenge: 'urn:uuid:another-request' }],
    ['domain', { domain: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK' }],
    ['noRoleCredential', { role: 'custom:senior-vetter' }],
    ['grantExpired', { now: '2027-03-01T00:01:01Z' }],
  ])('is refused (%s) when the expectations change', async (reason, overrides) => {
    const { deliver, request } = judge(overrides)
    await deliver({ requestId: 'upstream-request-id', eligibilityVp: vp })
    expect(request()).toMatchObject({ eligibilityOk: false, eligibilityRefusal: reason })
  })
})
