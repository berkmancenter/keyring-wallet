/**
 * A peer's vetting document is opened as openvtc opens one before anything in
 * it is believed — `wire::open` (openvtc-core `vetting/wire.rs:204-227`, at
 * ed13d29): the body is a Trust Task document, its `type` is the message's,
 * its `issuer` is the transport sender, its proof verifies as vta-sdk
 * `verify_trust_task_proof_with` verifies one (`trust_task_proof/verify.rs:136`),
 * and the proven signer is that sender.
 *
 * Found by the conformance inventory (2026-09-25): both Keyring seats took a
 * peer's identity from `body.issuer ?? m.from` and checked neither, so an
 * unsigned document — or one naming someone else — was acted on. A ticket's
 * rule 4 (bound to its first issuer) rested on that unverified issuer.
 *
 * Every document here is really signed (eddsa-jcs-2022 over did:key keys,
 * through the shipping signer), and the Keyring↔Keyring round trip at the end
 * uses the shipping producers, so the check cannot refuse what Keyring sends.
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
import { signDocumentProof, verifyTrustTaskProof } from '@bifold/trust-tasks'

// eslint-disable-next-line import/order
import {
  VETTING,
  VtiApplicant,
  VtiVetterDesk,
  openPeerDocument,
  type VettingApplication,
  type VettingApplicationRequest,
  type VettingDeskRequest,
  type VettingTicket,
  type VtiVettingStore,
} from '../module/vtiVetting'

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }

function didKeySigner() {
  const secret = ed25519.utils.randomSecretKey()
  const publicKey = ed25519.getPublicKey(secret)
  const did = `did:key:z${TypedArrayEncoder.toBase58(new Uint8Array([0xed, 0x01, ...publicKey]))}`
  const verificationMethodId = DidKey.fromDid(did).didDocument.verificationMethod?.[0]?.id as string
  const agent = {
    config: { logger },
    dids: { resolveDidDocument: async (d: string) => DidKey.fromDid(d).didDocument },
    dependencyManager: {
      resolve: () => ({
        sign: async ({ data }: { data: Uint8Array }) => ({ signature: ed25519.sign(data, secret) }),
      }),
    },
  }
  const persona = (communityDid: string) => ({
    did,
    communityDid,
    vtaKeyIds: { signing: verificationMethodId, keyAgreement: verificationMethodId },
    kmsKeyIds: { signing: 'sig', keyAgreement: 'ka' },
  })
  return { did, verificationMethodId, agent, persona }
}

const community = didKeySigner()
const vetter = didKeySigner()
const applicantKey = didKeySigner()
const impostor = didKeySigner()
const REQUEST_DOC_ID = 'urn:uuid:request-document-1'
const RESPONSE = `${VETTING.request}#response`
const TASK_ERROR = 'https://trusttasks.org/spec/trust-task-error/0.3'

/** A Trust Task document, as `signedDocument` builds one. */
const doc = (type: string, issuer: string, recipient: string, payload: Record<string, unknown>, threadId?: string) => ({
  id: `urn:uuid:${Math.random().toString(16).slice(2)}`,
  type,
  ...(threadId ? { threadId } : {}),
  issuer,
  recipient,
  issuedAt: new Date().toISOString(),
  payload,
})
const sign = (signer: ReturnType<typeof didKeySigner>, d: Record<string, unknown>) =>
  signDocumentProof(signer.agent as never, d, signer.did, {
    kmsKeyId: 'sig',
    verificationMethodId: signer.verificationMethodId,
  })
const message = (type: string, from: string, body: Record<string, unknown>, thid?: string) => ({
  id: `urn:uuid:${Math.random().toString(16).slice(2)}`,
  type,
  from,
  ...(thid ? { thid } : {}),
  body,
})

function memoryStore(init: {
  application?: VettingApplication
  desk?: VettingDeskRequest[]
  tickets?: VettingTicket[]
}) {
  const state = { application: init.application, desk: init.desk ?? [], tickets: init.tickets ?? [] }
  const store: VtiVettingStore = {
    listTickets: async () => state.tickets.map((t) => ({ ...t })),
    saveTicket: async (t) => {
      state.tickets = [...state.tickets.filter((x) => x.ticketId !== t.ticketId), { ...t }]
    },
    listDesk: async () => state.desk.map((r) => ({ ...r })),
    saveDesk: async (r) => {
      state.desk = [...state.desk.filter((x) => x.requestId !== r.requestId), { ...r }]
    },
    clearDesk: async () => undefined,
    getProfile: async () => undefined,
    saveProfile: async () => undefined,
    getApplication: async () => (state.application ? JSON.parse(JSON.stringify(state.application)) : undefined),
    saveApplication: async (a) => {
      state.application = JSON.parse(JSON.stringify(a))
    },
    forget: async () => undefined,
  }
  return { store, state }
}

// ---------------------------------------------------------------------------
// The verifier itself
// ---------------------------------------------------------------------------

describe('verifyTrustTaskProof, as vta-sdk verify_trust_task_proof_with', () => {
  it('returns the proven signer', async () => {
    const d = await sign(vetter, doc(RESPONSE, vetter.did, applicantKey.did, {}))
    await expect(verifyTrustTaskProof(vetter.agent as never, d)).resolves.toEqual({ ok: true, signer: vetter.did })
  })

  it('accepts any non-empty proofPurpose, as upstream names none', async () => {
    const d = await signDocumentProof(
      vetter.agent as never,
      doc(RESPONSE, vetter.did, applicantKey.did, {}),
      vetter.did,
      {
        kmsKeyId: 'sig',
        verificationMethodId: vetter.verificationMethodId,
        proofPurpose: 'authentication',
      }
    )
    await expect(verifyTrustTaskProof(vetter.agent as never, d)).resolves.toMatchObject({ ok: true })
  })

  it('refuses no proof as unsigned, and a tampered document as proof', async () => {
    const unsigned = doc(RESPONSE, vetter.did, applicantKey.did, {})
    await expect(verifyTrustTaskProof(vetter.agent as never, unsigned)).resolves.toMatchObject({
      ok: false,
      reason: 'unsigned',
    })
    const d = await sign(vetter, unsigned)
    await expect(
      verifyTrustTaskProof(vetter.agent as never, { ...d, payload: { requestId: 'changed' } })
    ).resolves.toMatchObject({ ok: false, reason: 'proof' })
  })

  it('refuses a method the DID document does not list — no fallback to its first key', async () => {
    const d = await sign(vetter, doc(RESPONSE, vetter.did, applicantKey.did, {}))
    const renamed = { ...d, proof: { ...(d.proof as object), verificationMethod: `${vetter.did}#some-other-key` } }
    await expect(verifyTrustTaskProof(vetter.agent as never, renamed)).resolves.toMatchObject({
      ok: false,
      reason: 'proof',
      detail: expect.stringMatching(/is not in the DID document/),
    })
  })

  it('refuses a relative verificationMethod, which names no signer (NoDid)', async () => {
    const d = await sign(vetter, doc(RESPONSE, vetter.did, applicantKey.did, {}))
    const fragment = vetter.verificationMethodId.slice(vetter.verificationMethodId.indexOf('#'))
    const relative = { ...d, proof: { ...(d.proof as object), verificationMethod: fragment } }
    await expect(verifyTrustTaskProof(vetter.agent as never, relative)).resolves.toMatchObject({ ok: false })
  })

  it("names the signer's method absolutely even when its DID document names it relatively", async () => {
    // Upstream takes the signer from before `#`; a relative `#key-0` names no one.
    const vm = DidKey.fromDid(vetter.did).didDocument.verificationMethod![0]
    const relativeAgent = {
      ...vetter.agent,
      dids: {
        resolveDidDocument: async () => ({ id: vetter.did, verificationMethod: [{ ...vm, id: '#key-0' }] }),
        getCreatedDids: async () => [],
      },
    }
    const d = await signDocumentProof(
      relativeAgent as never,
      doc(RESPONSE, vetter.did, applicantKey.did, {}),
      vetter.did,
      {
        kmsKeyId: 'sig',
      }
    )
    expect((d.proof as { verificationMethod: string }).verificationMethod).toBe(`${vetter.did}#key-0`)
    await expect(verifyTrustTaskProof(relativeAgent as never, d)).resolves.toEqual({ ok: true, signer: vetter.did })
  })

  it('refuses a proof created more than 60 s ahead', async () => {
    const d = await sign(vetter, doc(RESPONSE, vetter.did, applicantKey.did, {}))
    const created = Date.parse((d.proof as { created: string }).created)
    await expect(
      verifyTrustTaskProof(vetter.agent as never, d, { now: new Date(created - 61_000) })
    ).resolves.toMatchObject({ ok: false, detail: 'created is in the future' })
  })
})

describe('openPeerDocument, as openvtc wire::open', () => {
  const agent = vetter.agent as never
  it.each([
    [
      'typeMismatch',
      async () => message(VETTING.session, vetter.did, await sign(vetter, doc(RESPONSE, vetter.did, 'x', {}))),
    ],
    [
      'issuerNotSender',
      async () => message(RESPONSE, vetter.did, await sign(impostor, doc(RESPONSE, impostor.did, 'x', {}))),
    ],
    [
      'wrongSigner',
      async () => {
        // Names the vetter as issuer; signed by someone else's key.
        const d = doc(RESPONSE, vetter.did, 'x', {})
        return message(
          RESPONSE,
          vetter.did,
          await signDocumentProof(impostor.agent as never, d, impostor.did, {
            kmsKeyId: 'sig',
            verificationMethodId: impostor.verificationMethodId,
          })
        )
      },
    ],
    ['unsigned', async () => message(RESPONSE, vetter.did, doc(RESPONSE, vetter.did, 'x', {}))],
    ['malformed', async () => message(RESPONSE, vetter.did, { type: RESPONSE, issuer: vetter.did })],
  ])('refuses %s', async (code, make) => {
    await expect(openPeerDocument(agent, (await make()) as never)).resolves.toMatchObject({ ok: false, code })
  })

  it('refuses a document with no authenticated sender', async () => {
    const d = await sign(vetter, doc(RESPONSE, vetter.did, 'x', {}))
    await expect(openPeerDocument(agent, { type: RESPONSE, body: d } as never)).resolves.toMatchObject({
      ok: false,
      code: 'issuerNotSender',
    })
  })
})

// ---------------------------------------------------------------------------
// The applicant
// ---------------------------------------------------------------------------

function applicant(status: VettingApplicationRequest['status'] = 'sent') {
  const application: VettingApplication = {
    communityDid: community.did,
    joinDid: applicantKey.did,
    minStatements: 1,
    requiredClaims: ['name.legal'],
    acceptedMethods: ['inPerson'],
    commitmentSalt: 'salt',
    claims: { 'name.legal': 'Ada Lovelace' },
    startedAt: 't',
    requests: [{ vetterDid: vetter.did, requestDocumentId: REQUEST_DOC_ID, status, updatedAt: 't' }],
  }
  const { store, state } = memoryStore({ application })
  const vti = new VtiApplicant(
    applicantKey.agent as never,
    applicantKey.persona(community.did) as never,
    store,
    {} as never
  )
  const inbound = (m: unknown) => (vti as unknown as { inbound(m: unknown): Promise<void> }).inbound(m)
  const request = () => state.application!.requests[0]
  return { vti, inbound, request }
}

const peerDocs = {
  accepted: (d: Record<string, unknown>) => ({ ...d }),
  session: {
    type: VETTING.session,
    payload: {
      requestId: 'r',
      challenge: 'c'.repeat(43),
      domain: 'did:webvh:community',
      method: 'inPerson',
      requiredClaims: ['name.legal'],
      expiresAt: '2099-01-01T00:00:00Z',
    },
    after: 'session',
  },
  decline: { type: VETTING.decline, payload: { requestId: 'r' }, after: 'declined' },
  error: { type: TASK_ERROR, payload: { code: 'vetting/request:invalidTicket' }, after: 'refused' },
  response: { type: RESPONSE, payload: { requestId: 'r' }, after: 'accepted' },
} as const

describe("Keyring's applicant opens every peer document before acting on it", () => {
  beforeEach(() => logger.warn.mockClear())

  it.each([['response'], ['session'], ['decline'], ['error']] as const)(
    'a %s the vetter signed is acted on',
    async (kind) => {
      const { type, payload, after } = peerDocs[kind]
      const { inbound, request } = applicant()
      const d = await sign(vetter, doc(type, vetter.did, applicantKey.did, payload, REQUEST_DOC_ID))
      await inbound(message(type, vetter.did, d, REQUEST_DOC_ID))
      expect(request()).toMatchObject({ status: after })
      expect(request().envelopeRefusal).toBeUndefined()
    }
  )

  it.each([['response'], ['session'], ['decline'], ['error']] as const)(
    'an unsigned %s is refused unread, recorded, and logged',
    async (kind) => {
      const { type, payload } = peerDocs[kind]
      const { inbound, request } = applicant()
      await inbound(message(type, vetter.did, doc(type, vetter.did, applicantKey.did, payload, REQUEST_DOC_ID)))
      expect(request()).toMatchObject({ status: 'sent', envelopeRefusal: 'unsigned', envelopeRefusalTask: type })
      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/refused unread \(unsigned\)/), expect.anything())
    }
  )

  it('a document the vetter sent naming someone else as issuer is refused', async () => {
    const { inbound, request } = applicant()
    const d = await sign(impostor, doc(RESPONSE, impostor.did, applicantKey.did, { requestId: 'r' }, REQUEST_DOC_ID))
    await inbound(message(RESPONSE, vetter.did, d))
    expect(request()).toMatchObject({ status: 'sent', envelopeRefusal: 'issuerNotSender' })
  })

  it('a decline in the vetter’s name, signed by another key, is refused', async () => {
    const { inbound, request } = applicant('session')
    const d = await signDocumentProof(
      impostor.agent as never,
      doc(VETTING.decline, vetter.did, applicantKey.did, { requestId: 'r' }),
      impostor.did,
      { kmsKeyId: 'sig', verificationMethodId: impostor.verificationMethodId }
    )
    await inbound(message(VETTING.decline, vetter.did, d))
    expect(request()).toMatchObject({ status: 'session', envelopeRefusal: 'wrongSigner' })
  })

  it('a session altered after signing is refused', async () => {
    const { inbound, request } = applicant('accepted')
    const d = await sign(vetter, doc(VETTING.session, vetter.did, applicantKey.did, peerDocs.session.payload))
    await inbound(message(VETTING.session, vetter.did, { ...d, payload: { ...peerDocs.session.payload, domain: 'x' } }))
    expect(request()).toMatchObject({ status: 'accepted', envelopeRefusal: 'proof' })
  })

  it('a refusal of something other than our request is not taken as a refusal of it', async () => {
    const { inbound, request } = applicant()
    const d = await sign(vetter, doc(TASK_ERROR, vetter.did, applicantKey.did, { code: 'x' }, 'urn:uuid:another'))
    await inbound(message(TASK_ERROR, vetter.did, d, 'urn:uuid:another'))
    expect(request()).toMatchObject({ status: 'sent' })
  })
})

// ---------------------------------------------------------------------------
// The vetter's desk
// ---------------------------------------------------------------------------

async function vetterDesk(extra: { desk?: VettingDeskRequest[] } = {}) {
  const grant = await signDocumentProof(
    community.agent as never,
    {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://firstperson.network/credentials/dtg/v1'],
      type: ['VerifiableCredential', 'DTGCredential', 'EndorsementCredential'],
      id: 'urn:uuid:grant-1',
      issuer: community.did,
      validFrom: new Date(new Date().getTime() - 86400000).toISOString(),
      validUntil: new Date(new Date().getTime() + 90 * 86400000).toISOString(),
      credentialSubject: {
        id: vetter.did,
        endorsement: { type: 'CommunityRole', role: 'vetter', communityDid: community.did },
      },
    },
    community.did,
    { kmsKeyId: 'sig', verificationMethodId: community.verificationMethodId }
  )
  const ticket: VettingTicket = {
    ticketId: 'vt-1',
    code: 'AAAA-BBBB',
    secret: 's',
    communityDid: community.did,
    usesLeft: 1,
    expiresAt: new Date(new Date().getTime() + 86400000).toISOString(),
    createdAt: new Date().toISOString(),
  }
  const { store, state } = memoryStore({ tickets: [ticket], desk: extra.desk })
  const grants = {
    listHeldCredentials: async () => [
      { kind: 'vetter-grant', communityDid: community.did, subjectDid: vetter.did, credential: grant, receivedAt: 't' },
    ],
  }
  const desk = new VtiVetterDesk(vetter.agent as never, vetter.persona(community.did) as never, store, grants as never)
  const inbound = (m: unknown) => (desk as unknown as { inbound(m: unknown): Promise<void> }).inbound(m)
  return { desk, inbound, state }
}

const requestPayload = (joinDid: string) => ({ community: community.did, joinDid, ticket: { code: 'AAAA-BBBB' } })

describe("Keyring's vetter opens a request before it spends a ticket on it", () => {
  beforeEach(() => {
    sent.length = 0
  })

  it('a signed request is taken', async () => {
    const { inbound, state } = await vetterDesk()
    const d = await sign(
      applicantKey,
      doc(VETTING.request, applicantKey.did, vetter.did, requestPayload(applicantKey.did))
    )
    await inbound(message(VETTING.request, applicantKey.did, d))
    expect(sent.map((s) => s.type)).toEqual([RESPONSE])
    expect(state.tickets[0]).toMatchObject({ usesLeft: 0, boundTo: applicantKey.did })
  })

  it('an unsigned request spends nothing and sends nothing', async () => {
    const { inbound, state } = await vetterDesk()
    await inbound(
      message(
        VETTING.request,
        applicantKey.did,
        doc(VETTING.request, applicantKey.did, vetter.did, requestPayload(applicantKey.did))
      )
    )
    expect(sent).toHaveLength(0)
    expect(state.tickets[0]).toMatchObject({ usesLeft: 1 })
    expect(state.tickets[0].boundTo).toBeUndefined()
  })

  it('ticket rule 4: a request whose issuer is not its sender cannot bind the ticket to that issuer', async () => {
    // The impostor holds the code, and sends a request in the applicant's name.
    const { inbound, state } = await vetterDesk()
    const d = await sign(impostor, doc(VETTING.request, applicantKey.did, vetter.did, requestPayload(applicantKey.did)))
    await inbound(message(VETTING.request, impostor.did, d))
    expect(sent).toHaveLength(0)
    expect(state.tickets[0].boundTo).toBeUndefined()
  })

  it('a card whose carrier is unsigned is not taken, and the session says why', async () => {
    const session = {
      documentId: 'urn:uuid:session-1',
      challenge: 'c',
      domain: community.did,
      requiredClaims: ['name.legal'],
      method: 'inPerson' as const,
      expiresAt: '2099-01-01T00:00:00Z',
      matchCode: 'ABCD-1234',
    }
    const { inbound, state } = await vetterDesk({
      desk: [
        {
          requestId: 'r',
          applicantDid: applicantKey.did,
          communityDid: community.did,
          status: 'session',
          receivedAt: 't',
          session,
        },
      ],
    })
    const type = `${VETTING.session}#response`
    await inbound(
      message(
        type,
        applicantKey.did,
        doc(type, applicantKey.did, vetter.did, { card: {} }, session.documentId),
        session.documentId
      )
    )
    expect(state.desk[0]).toMatchObject({ status: 'session', envelopeRefusal: 'unsigned', envelopeRefusalTask: type })
  })
})

// ---------------------------------------------------------------------------
// Keyring to Keyring: what the shipping producers send, the check accepts
// ---------------------------------------------------------------------------

describe('Keyring to Keyring, through the shipping producers', () => {
  it('a request, its acceptance, a session and a decline all open', async () => {
    sent.length = 0
    const { vti, inbound: applicantInbound, request } = applicant()
    // The applicant's own request, as requestVetter makes and signs it.
    await vti.requestVetter({ vetterDid: vetter.did, code: 'AAAA-BBBB' })
    const req = sent.at(-1)!
    const { desk, inbound: deskInbound, state } = await vetterDesk()
    await deskInbound(message(req.type, applicantKey.did, req.body))
    const response = sent.at(-1)!
    expect(response.type).toBe(RESPONSE)
    await applicantInbound(message(response.type, vetter.did, response.body))
    expect(request()).toMatchObject({ status: 'accepted' })
    expect(request().envelopeRefusal).toBeUndefined()

    const opened = await desk.openSession(state.desk[0].requestId, ['name.legal'])
    const sessionDoc = sent.at(-1)!
    await applicantInbound(message(sessionDoc.type, vetter.did, sessionDoc.body))
    expect(request()).toMatchObject({ status: 'session' })

    await desk.decline(opened.requestId)
    const declineDoc = sent.at(-1)!
    await applicantInbound(message(declineDoc.type, vetter.did, declineDoc.body))
    expect(request()).toMatchObject({ status: 'declined' })
    expect(request().envelopeRefusal).toBeUndefined()
  })
})
