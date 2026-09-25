/**
 * PR E: the checks an openvtc client runs on the vetting documents it
 * accepts, ported to Keyring's two seats and its inbox, and the producer
 * fixes they forced (conformance inventory, 2026-09-25):
 *
 * - the vetter's card check — vta-sdk `verify_card` (card.rs:270-327) after
 *   openvtc's session check (vetter.rs:547-551);
 * - the session Keyring produces — `parentThreadId` (vetting/session/0.1
 *   spec.md:94) and a 15-minute `expiresAt` (openvtc book.rs:45);
 * - the session Keyring's applicant accepts — openvtc `on_session`
 *   (applicant.rs:774-791);
 * - credentials from a community — openvtc `handle_credential_issue`
 *   (messaging.rs:872-927) and `vetter_grant` (inbound.rs:834-857);
 * - a statement with no card sent — openvtc `on_statement` (applicant.rs:1104-1106);
 * - the manifest's requirements — vta-sdk `read_requirements` (vetting.rs:485);
 * - the vetter profile — vta-sdk `CheckShape` (vetting.rs:570-597);
 * - trust-task-error 0.5 — trust-tasks-rs 0.22 `ErrorPayload` (error.rs:45-97);
 * - the consent decision's `payloadDigest` — framework 0.3 `DigestMultibase`.
 *
 * Every card and document is really signed (eddsa-jcs-2022 over did:key).
 * `Date.now` is the suite's fixed clock (jestSetup: 2024-01-01T00:00:00Z).
 */
const sent: { to: string; type: string; body: Record<string, unknown>; options?: unknown }[] = []
const mockAsk = jest.fn()

jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  vtiAgent: {
    send: jest.fn(async (to: string, type: string, body: Record<string, unknown>, options?: unknown) => {
      sent.push({ to, type, body, options })
    }),
    ask: (...a: unknown[]) => mockAsk(...a),
    sentNoAnswer: () => new Error('no answer'),
    onInbound: () => () => undefined,
  },
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../module/VtiMediatorTransport', () => ({
  ...jest.requireActual('../module/VtiMediatorTransport'),
  resolveDidDocumentRetrying: async () => undefined,
}))

// eslint-disable-next-line import/order
import { randomUUID } from 'node:crypto'

// eslint-disable-next-line import/order
import { DidKey, TypedArrayEncoder } from '@credo-ts/core'
// eslint-disable-next-line import/order
import { ed25519 } from '@noble/curves/ed25519.js'
// eslint-disable-next-line import/order
import { digestMultibase, signDocumentProof } from '@bifold/trust-tasks'

// eslint-disable-next-line import/order
import {
  LEGACY_ERROR_03_UNTIL,
  LEGACY_STATEMENT_DOCUMENT_UNTIL,
  MAX_CARD_VALIDITY_MS,
  VETTING,
  VETTING_SESSION_MS,
  VetterProfileError,
  VettingRequirementsError,
  VtiApplicant,
  VtiVetterDesk,
  identityCommitment,
  verifyVettingCard,
  type VettingApplication,
  type VettingApplicationRequest,
  type VettingDeskRequest,
  type VtiVettingStore,
} from '../module/vtiVetting'
// eslint-disable-next-line import/order
import { CREDENTIAL_EXCHANGE_ISSUE, receiveIssue } from '../module/vtiInbox'
// eslint-disable-next-line import/order
import { VtaClient } from '../module/VtaClient'
// eslint-disable-next-line import/order
import { checkVetterProfile, checkVettingRequirements, isHttpsUri } from '../module/vettingShape'

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
const random32 = () => TypedArrayEncoder.toBase64Url(ed25519.utils.randomSecretKey())
const uuid = () => `urn:uuid:${randomUUID()}`
const SESSION_ID = 'urn:uuid:9a7e4c21-5b3d-4e8f-a1c2-3d4e5f6a7b01'
const REQUEST_DOC_ID = 'urn:uuid:request-document-1'
const CHALLENGE = random32()
const SALT = random32()
const signAs = (who: ReturnType<typeof didKeySigner>, d: Record<string, unknown>) =>
  signDocumentProof(who.agent as never, d, who.did, { kmsKeyId: 'sig', verificationMethodId: who.verificationMethodId })
const document = (
  type: string,
  from: ReturnType<typeof didKeySigner>,
  to: string,
  payload: object,
  threadId?: string
) =>
  signAs(from, {
    id: uuid(),
    type,
    ...(threadId ? { threadId } : {}),
    issuer: from.did,
    recipient: to,
    issuedAt: new Date(Date.now()).toISOString(),
    payload,
  })
const message = (type: string, from: string, body: Record<string, unknown>) => ({
  id: uuid(),
  type,
  from,
  thid: body.threadId,
  body,
})

/** A card as the spec builds one (vetting/session/0.1 spec.md:172-178), really signed by `signer`. */
async function card(
  overrides: Record<string, unknown> = {},
  { signer = applicantKey, claims = [{ type: 'name.legal', value: 'Ada Lovelace', provenance: 'selfAsserted' }] } = {}
) {
  const now = Date.now()
  const unsigned: Record<string, unknown> = {
    id: uuid(),
    type: ['VerifiableDataStructure', 'RelationshipCard', 'VettingCard'],
    cardVersion: 1,
    publisher: applicantKey.did,
    community: community.did,
    domain: community.did,
    audience: vetter.did,
    challenge: CHALLENGE,
    claims,
    commitmentSalt: SALT,
    identityCommitment: identityCommitment(
      SALT,
      claims.filter((c) => c.type === 'name.legal')
    ),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 10 * 60000).toISOString(),
    ...overrides,
  }
  return signAs(signer, unsigned)
}

const expectations = (over: Partial<Parameters<typeof verifyVettingCard>[2]> = {}) => ({
  audience: vetter.did,
  publisher: applicantKey.did,
  community: community.did,
  challenge: CHALLENGE,
  domain: community.did,
  requiredClaims: ['name.legal'],
  sessionExpiresAt: new Date(Date.now() + VETTING_SESSION_MS).toISOString(),
  now: Date.now(),
  ...over,
})

// ---------------------------------------------------------------------------
// 1. The vetter's card check
// ---------------------------------------------------------------------------

describe("the vetter's card check, as vta-sdk verify_card", () => {
  const check = async (c: unknown, over = {}) => verifyVettingCard(vetter.agent as never, c, expectations(over))

  it('accepts a card built as the spec builds one', async () => {
    await expect(check(await card())).resolves.toEqual({ ok: true })
  })

  it.each([
    ['audience', { audience: impostor.did }],
    ['publisher', { publisher: impostor.did }],
    ['community', { community: impostor.did }],
    ['challenge', { challenge: random32() }],
    ['domain', { domain: impostor.did }],
  ])('refuses a card bound to another %s', async (code, override) => {
    await expect(check(await card(override))).resolves.toMatchObject({ ok: false, code })
  })

  it('refuses a card that is not the published shape', async () => {
    await expect(check(await card({ cardVersion: 0 }))).resolves.toMatchObject({ ok: false, code: 'malformed' })
    await expect(check(await card({ extra: 1 }))).resolves.toMatchObject({ ok: false, code: 'malformed' })
    const { proof: _proof, ...unsigned } = await card()
    await expect(check(unsigned)).resolves.toMatchObject({ ok: false, code: 'malformed' })
  })

  it('refuses a window longer than 15 minutes, inverted, ahead by more than 60 s, or over by more than 60 s', async () => {
    const now = Date.now()
    const at = (ms: number) => new Date(now + ms).toISOString()
    const expired = { ok: false, code: 'expired' }
    await expect(
      check(await card({ issuedAt: at(0), expiresAt: at(MAX_CARD_VALIDITY_MS + 1000) }))
    ).resolves.toMatchObject(expired)
    await expect(check(await card({ issuedAt: at(0), expiresAt: at(0) }))).resolves.toMatchObject(expired)
    await expect(check(await card({ issuedAt: at(61_000), expiresAt: at(120_000) }))).resolves.toMatchObject(expired)
    await expect(check(await card({ issuedAt: at(-600_000), expiresAt: at(-61_000) }))).resolves.toMatchObject(expired)
    // Inside the skew either way, it still counts.
    await expect(check(await card({ issuedAt: at(59_000), expiresAt: at(120_000) }))).resolves.toEqual({ ok: true })
    await expect(check(await card({ issuedAt: at(-600_000), expiresAt: at(-59_000) }))).resolves.toEqual({ ok: true })
  })

  it("refuses a card that outlives its session (the spec's check, spec.md:164)", async () => {
    const c = await card()
    await expect(
      check(c, { sessionExpiresAt: new Date(Date.parse(String(c.expiresAt)) - 1000).toISOString() })
    ).resolves.toMatchObject({ ok: false, code: 'outlivesSession' })
  })

  it('refuses a card signed by anyone but its publisher, or tampered with', async () => {
    await expect(check(await card({}, { signer: impostor }))).resolves.toMatchObject({ ok: false, code: 'proof' })
    const tampered = { ...(await card()), claims: [{ type: 'name.legal', value: 'Eve', provenance: 'selfAsserted' }] }
    await expect(check(tampered)).resolves.toMatchObject({ ok: false, code: 'proof' })
  })

  it('refuses a card missing a required claim', async () => {
    const claims = [{ type: 'account.handle', value: 'ada', provenance: 'selfAsserted' }]
    await expect(check(await card({}, { claims }))).resolves.toMatchObject({ ok: false, code: 'missingClaim' })
  })

  it('refuses a commitment that does not recompute from the salt and the required claims', async () => {
    await expect(
      check(await card({ identityCommitment: identityCommitment(SALT, [{ type: 'name.legal', value: 'Eve' }]) }))
    ).resolves.toMatchObject({ ok: false, code: 'commitment' })
    // Committing to an optional claim too is not the required set.
    const claims = [
      { type: 'name.legal', value: 'Ada Lovelace', provenance: 'selfAsserted' },
      { type: 'account.handle', value: 'ada', provenance: 'selfAsserted' },
    ]
    await expect(
      check(await card({ identityCommitment: identityCommitment(SALT, claims) }, { claims }))
    ).resolves.toMatchObject({ ok: false, code: 'commitment' })
  })
})

function memoryStore(init: { application?: VettingApplication; desk?: VettingDeskRequest[] }) {
  const state = { application: init.application, desk: init.desk ?? [] }
  const store: VtiVettingStore = {
    listTickets: async () => [],
    saveTicket: async () => undefined,
    listDesk: async () => state.desk.map((r) => ({ ...r })),
    saveDesk: async (r) => {
      state.desk = [...state.desk.filter((x) => x.requestId !== r.requestId), JSON.parse(JSON.stringify(r))]
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

describe("the vetter's desk records why a card was refused", () => {
  const deskWith = (expiresAt = new Date(Date.now() + VETTING_SESSION_MS).toISOString()) => {
    const { store, state } = memoryStore({
      desk: [
        {
          requestId: 'r',
          requestDocumentId: REQUEST_DOC_ID,
          applicantDid: applicantKey.did,
          communityDid: community.did,
          status: 'session',
          receivedAt: 't',
          session: {
            documentId: SESSION_ID,
            challenge: CHALLENGE,
            domain: community.did,
            requiredClaims: ['name.legal'],
            method: 'inPerson',
            expiresAt,
            matchCode: 'ABCD-1234',
          },
        },
      ],
    })
    const desk = new VtiVetterDesk(vetter.agent as never, vetter.persona(community.did) as never, store, {} as never)
    const inbound = (m: unknown) => (desk as unknown as { inbound(m: unknown): Promise<void> }).inbound(m)
    return { inbound, state }
  }
  const cardMessage = async (c: Record<string, unknown>) => {
    const type = `${VETTING.session}#response`
    return message(type, applicantKey.did, await document(type, applicantKey, vetter.did, { card: c }, SESSION_ID))
  }

  it('takes a good card', async () => {
    const { inbound, state } = deskWith()
    await inbound(await cardMessage(await card()))
    expect(state.desk[0]).toMatchObject({ status: 'cardReceived' })
    expect(state.desk[0].cardRefusal).toBeUndefined()
  })

  it('refuses one whose commitment does not recompute, keeping the session open', async () => {
    const { inbound, state } = deskWith()
    await inbound(
      await cardMessage(
        await card({ identityCommitment: identityCommitment(SALT, [{ type: 'name.legal', value: 'X' }]) })
      )
    )
    expect(state.desk[0]).toMatchObject({ status: 'session', cardRefusal: 'commitment' })
    expect(state.desk[0].card).toBeUndefined()
    // A corrected card is still taken.
    await inbound(await cardMessage(await card({ expiresAt: new Date(Date.now() + 5 * 60000).toISOString() })))
    expect(state.desk[0]).toMatchObject({ status: 'cardReceived' })
    expect(state.desk[0].cardRefusal).toBeUndefined()
  })

  it('refuses any card once the session has closed (openvtc vetter.rs:547-551)', async () => {
    const { inbound, state } = deskWith(new Date(Date.now() - 1000).toISOString())
    await inbound(await cardMessage(await card({ expiresAt: new Date(Date.now() + 60000).toISOString() })))
    expect(state.desk[0]).toMatchObject({ status: 'session', cardRefusal: 'sessionClosed' })
  })

  it('does not take a card threaded on another session', async () => {
    const { inbound, state } = deskWith()
    const type = `${VETTING.session}#response`
    const c = await card()
    await inbound(message(type, applicantKey.did, await document(type, applicantKey, vetter.did, { card: c }, uuid())))
    expect(state.desk[0]).toMatchObject({ status: 'session' })
    expect(state.desk[0].cardRefusal).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 2. The session Keyring produces, and the card that answers it
// ---------------------------------------------------------------------------

describe('the session Keyring opens', () => {
  it('names the request exchange as parentThreadId and closes in 15 minutes', async () => {
    sent.length = 0
    const { store } = memoryStore({
      desk: [
        {
          requestId: 'r',
          requestDocumentId: REQUEST_DOC_ID,
          requestThreadId: REQUEST_DOC_ID,
          applicantDid: applicantKey.did,
          communityDid: community.did,
          status: 'accepted',
          receivedAt: 't',
        },
      ],
    })
    const desk = new VtiVetterDesk(vetter.agent as never, vetter.persona(community.did) as never, store, {} as never)
    await desk.openSession('r', ['name.legal'])
    const doc = sent.at(-1)!.body
    expect(doc.parentThreadId).toBe(REQUEST_DOC_ID)
    expect(doc.threadId).toBeUndefined()
    const expiresAt = Date.parse(String((doc.payload as { expiresAt: string }).expiresAt))
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(15 * 60000)
    expect(sent.at(-1)!.options).toMatchObject({ expiresInSec: 900 })
  })

  it("the applicant's card carries the same parentThreadId, and its thread is the session", async () => {
    sent.length = 0
    const { store } = memoryStore({
      application: applicationWith({
        status: 'session',
        requestId: 'r',
        session: {
          documentId: SESSION_ID,
          challenge: CHALLENGE,
          domain: community.did,
          requiredClaims: ['name.legal'],
          method: 'inPerson',
          expiresAt: new Date(Date.now() + VETTING_SESSION_MS).toISOString(),
          matchCode: 'ABCD-1234',
        },
      }),
    })
    const vti = new VtiApplicant(
      applicantKey.agent as never,
      applicantKey.persona(community.did) as never,
      store,
      {} as never
    )
    await vti.sendCard(vetter.did)
    expect(sent.at(-1)!.body).toMatchObject({ threadId: SESSION_ID, parentThreadId: REQUEST_DOC_ID })
  })
})

function applicationWith(request: Partial<VettingApplicationRequest> = {}): VettingApplication {
  return {
    communityDid: community.did,
    joinDid: applicantKey.did,
    minStatements: 1,
    requiredClaims: ['name.legal'],
    acceptedMethods: ['inPerson'],
    commitmentSalt: SALT,
    claims: { 'name.legal': 'Ada Lovelace' },
    startedAt: 't',
    requests: [
      { vetterDid: vetter.did, requestDocumentId: REQUEST_DOC_ID, status: 'accepted', updatedAt: 't', ...request },
    ],
  }
}

// ---------------------------------------------------------------------------
// 3. The session Keyring's applicant accepts
// ---------------------------------------------------------------------------

describe("the applicant takes a session as openvtc's on_session does", () => {
  const sessionPayload = (over: Record<string, unknown> = {}) => ({
    requestId: 'r',
    challenge: random32(),
    domain: community.did,
    method: 'inPerson',
    requiredClaims: ['name.legal'],
    expiresAt: new Date(Date.now() + VETTING_SESSION_MS).toISOString(),
    ...over,
  })
  const run = async (
    payload: object,
    request: Partial<VettingApplicationRequest> = { requestId: 'r' },
    from = vetter
  ) => {
    const { store, state } = memoryStore({ application: applicationWith(request) })
    const vti = new VtiApplicant(
      applicantKey.agent as never,
      applicantKey.persona(community.did) as never,
      store,
      {} as never
    )
    const inbound = (m: unknown) => (vti as unknown as { inbound(m: unknown): Promise<void> }).inbound(m)
    await inbound(message(VETTING.session, from.did, await document(VETTING.session, from, applicantKey.did, payload)))
    return state.application!.requests[0]
  }

  it('takes a session for the request this vetter accepted', async () => {
    const r = await run(sessionPayload())
    expect(r).toMatchObject({ status: 'session' })
    expect(r.sessionRefusal).toBeUndefined()
  })

  // Built inside the test: the suite's clock is fixed only while a test runs.
  it.each([
    ['malformed', () => sessionPayload({ challenge: 'short' })],
    ['malformed', () => sessionPayload({ requiredClaims: ['person.portrait'] })],
    ['community', () => sessionPayload({ domain: impostor.did })],
    ['expired', () => sessionPayload({ expiresAt: new Date(Date.now() - 1000).toISOString() })],
    ['unknownRequest', () => sessionPayload({ requestId: 'another' })],
  ])('refuses one that is %s, and leaves the request where it was', async (code, payload) => {
    const r = await run(payload())
    expect(r).toMatchObject({ status: 'accepted', sessionRefusal: code })
  })

  it('refuses a session on a request the vetter has not accepted', async () => {
    expect(await run(sessionPayload(), { status: 'sent' })).toMatchObject({
      status: 'sent',
      sessionRefusal: 'unknownRequest',
    })
  })

  it('refuses a session from a vetter who has already attested', async () => {
    expect(await run(sessionPayload(), { status: 'attested', requestId: 'r' })).toMatchObject({
      status: 'attested',
      sessionRefusal: 'alreadyAttested',
    })
  })

  it('a new session forgets the card sent on the last one', async () => {
    const r = await run(sessionPayload(), {
      status: 'cardSent',
      requestId: 'r',
      cardDigest: 'zQmOld',
      cardCommitment: 'z',
    })
    expect(r).toMatchObject({ status: 'session' })
    expect(r.cardDigest).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 4. Credentials from a community
// ---------------------------------------------------------------------------

describe('credentials a community delivers, as openvtc handle_credential_issue / vetter_grant', () => {
  const membership = (over: Record<string, unknown> = {}) => ({
    type: ['VerifiableCredential', 'MembershipCredential'],
    id: uuid(),
    issuer: community.did,
    credentialSubject: { id: applicantKey.did },
    ...over,
  })
  const grant = (endorsement: Record<string, unknown> = {}) => ({
    type: ['VerifiableCredential', 'DTGCredential', 'EndorsementCredential'],
    id: uuid(),
    issuer: community.did,
    credentialSubject: {
      id: applicantKey.did,
      endorsement: { type: 'CommunityRole', role: 'vetter', communityDid: community.did, ...endorsement },
    },
  })
  const deliver = async (credential: Record<string, unknown>, from = community.did) => {
    const stored: unknown[] = []
    const refused: string[] = []
    const store = {
      getMembership: async () => undefined,
      saveMembership: async (m: unknown) => void stored.push(m),
      saveHeldCredential: async (c: unknown) => void stored.push(c),
    }
    const got = await receiveIssue(
      store as never,
      applicantKey.did,
      {
        id: uuid(),
        type: CREDENTIAL_EXCHANGE_ISSUE,
        from,
        body: { credential_response: { credential } },
      } as never,
      { onRefused: (_item, why) => void refused.push(why) }
    )
    return { got, stored, refused }
  }

  it('keeps a membership and a grant from their community, about this persona', async () => {
    expect(await deliver(membership())).toMatchObject({ refused: [], got: [{ kind: 'membership' }] })
    expect(await deliver(grant())).toMatchObject({ refused: [], got: [{ kind: 'vetter-grant' }] })
  })

  it('refuses one whose issuer is not the sender', async () => {
    expect(await deliver(membership(), impostor.did)).toMatchObject({ stored: [], refused: ['issuerNotSender'] })
    expect(await deliver(membership({ issuer: { id: impostor.did } }))).toMatchObject({
      stored: [],
      refused: ['issuerNotSender'],
    })
  })

  it('refuses a grant for a community other than its sender', async () => {
    expect(await deliver(grant({ communityDid: impostor.did }))).toMatchObject({
      stored: [],
      refused: ['notFromCommunity'],
    })
  })

  it('refuses one with no subject, or about someone else', async () => {
    expect(await deliver(membership({ credentialSubject: {} }))).toMatchObject({ stored: [], refused: ['subject'] })
    expect(await deliver(membership({ credentialSubject: { id: impostor.did } }))).toMatchObject({
      stored: [],
      refused: ['subject'],
    })
  })
})

// ---------------------------------------------------------------------------
// 5. A statement with no card sent
// ---------------------------------------------------------------------------

describe('a statement on a session this phone sent no card into', () => {
  it('is refused as noCard (openvtc on_statement, applicant.rs:1104-1106)', async () => {
    const { store, state } = memoryStore({
      application: applicationWith({
        status: 'session',
        requestId: 'r',
        session: {
          documentId: SESSION_ID,
          challenge: CHALLENGE,
          domain: community.did,
          requiredClaims: ['name.legal'],
          method: 'inPerson',
          expiresAt: new Date(Date.now() + VETTING_SESSION_MS).toISOString(),
          matchCode: 'ABCD-1234',
        },
      }),
    })
    const held: unknown[] = []
    const communityStore = { saveHeldCredential: async (c: unknown) => void held.push(c) }
    const vti = new VtiApplicant(
      applicantKey.agent as never,
      applicantKey.persona(community.did) as never,
      store,
      communityStore as never
    )
    const statement = await signAs(vetter, {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://firstperson.network/credentials/dtg/v1'],
      type: ['VerifiableCredential', 'DTGCredential', 'EndorsementCredential'],
      id: uuid(),
      issuer: vetter.did,
      validFrom: new Date(Date.now()).toISOString(),
      validUntil: new Date(Date.now() + 86400000).toISOString(),
      taskContext: SESSION_ID,
      credentialSubject: {
        id: applicantKey.did,
        endorsement: {
          type: 'https://firstperson.network/endorsements/identity-vetting/0.1',
          community: community.did,
          method: 'inPerson',
          identityCommitment: identityCommitment(SALT, [{ type: 'name.legal', value: 'Ada Lovelace' }]),
          cardDigestMultibase: digestMultibase({ a: 1 }),
        },
      },
    })
    await vti.receiveStatement({
      id: uuid(),
      type: CREDENTIAL_EXCHANGE_ISSUE,
      from: vetter.did,
      body: { credential_response: { credential: statement } },
    } as never)
    expect(state.application!.requests[0]).toMatchObject({ status: 'statementRefused', statementRefusal: 'noCard' })
    expect(held).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 6. The manifest's requirements
// ---------------------------------------------------------------------------

describe("the community's vetting requirements, as vta-sdk read_requirements", () => {
  const requirements = (over: Record<string, unknown> = {}) => ({
    version: '0.1',
    statementType: 'https://firstperson.network/endorsements/identity-vetting/0.1',
    minStatements: 2,
    minByMethod: { inPerson: 1 },
    acceptedMethods: ['inPerson', 'video', 'priorAcquaintance'],
    requiredClaims: ['name.legal'],
    maxStatementAge: 'P120D',
    eligibleVetters: { role: 'vetter' },
    independence: { maxByDeclaredRelationship: { family: 0 } },
    ...over,
  })

  it('reads the published example, and a member a newer community adds', () => {
    expect(checkVettingRequirements(requirements())).toEqual({ ok: true })
    expect(checkVettingRequirements(requirements({ vetterDirectory: true }))).toEqual({ ok: true })
  })

  // vta-sdk's own table (protocols/vetting.rs:1452-1490).
  it.each([
    ['minStatements', 0],
    ['acceptedMethods', []],
    ['acceptedMethods', ['video', 'video']],
    ['maxStatementAge', 'P4M'],
    ['version', '1'],
    ['eligibleVetters', { role: 'vet ter' }],
    ['acceptedDocumentClasses', ['national-id']],
    ['governanceFrameworkUrl', 'http://gov.example'],
    ['governanceFrameworkUrl', 'https://gov.example/frame work'],
    ['decisionSla', `PT${'1'.repeat(30)}S`],
    ['minByMethod', { inPerson: 1, video: 1 }],
  ])('refuses %s = %j', (member, value) => {
    const r = requirements({ [member]: value })
    if (member === 'minByMethod') (r as { acceptedMethods: string[] }).acceptedMethods = ['inPerson']
    expect(checkVettingRequirements(r)).toMatchObject({ ok: false })
  })

  it('start refuses a manifest whose requirements cannot be evaluated, and saves nothing', async () => {
    const { store, state } = memoryStore({})
    const vti = new VtiApplicant(
      applicantKey.agent as never,
      applicantKey.persona(community.did) as never,
      store,
      {} as never
    )
    const manifest = { criteria: [{ id: 'c', vetting: requirements({ minStatements: 0 }) }] }
    await expect(vti.start(manifest as never, { 'name.legal': 'Ada' })).rejects.toBeInstanceOf(VettingRequirementsError)
    expect(state.application).toBeUndefined()
    await vti.start({ criteria: [{ id: 'c', vetting: requirements() }] } as never, { 'name.legal': 'Ada' })
    expect(state.application).toMatchObject({ minStatements: 2, vetterRole: 'vetter' })
  })
})

// ---------------------------------------------------------------------------
// 7. The vetter profile
// ---------------------------------------------------------------------------

describe('the vetter profile, as vta-sdk CheckShape (vetting.rs:570-597)', () => {
  const event = (startDate: string, endDate: string, url?: string) => ({
    name: 'Kernel Maintainer Summit',
    startDate,
    endDate,
    ...(url ? { url } : {}),
  })
  const profile = (events: object[]) => ({
    listed: true,
    languages: ['en'],
    methods: ['inPerson'],
    acceptsDocumentation: [],
    events,
  })

  it('takes an event of up to 31 days, and refuses a longer, inverted or impossible one', () => {
    expect(checkVetterProfile(profile([event('2026-10-05', '2026-11-05')]))).toEqual({ ok: true })
    expect(checkVetterProfile(profile([event('2026-10-05', '2026-11-06')]))).toMatchObject({ ok: false })
    expect(checkVetterProfile(profile([event('2026-10-05', '2026-10-04')]))).toMatchObject({ ok: false })
    expect(checkVetterProfile(profile([event('2026-02-30', '2026-03-01')]))).toMatchObject({ ok: false })
  })

  it('takes only an absolute https event url', () => {
    expect(checkVetterProfile(profile([event('2026-10-05', '2026-10-08', 'https://events.example.org/kms')]))).toEqual({
      ok: true,
    })
    for (const url of ['http://events.example.org', 'https://events.example.org/kernel meetup', 'https:///x'])
      expect(checkVetterProfile(profile([event('2026-10-05', '2026-10-08', url)]))).toMatchObject({ ok: false })
    expect(isHttpsUri('https://events.example.org/%zz')).toBe(false)
  })

  it('publishProfile sends nothing for a profile the community would refuse', async () => {
    mockAsk.mockClear()
    const { store } = memoryStore({})
    const desk = new VtiVetterDesk(vetter.agent as never, vetter.persona(community.did) as never, store, {} as never)
    await expect(desk.publishProfile({ events: [event('2026-10-01', '2026-12-01')] })).rejects.toBeInstanceOf(
      VetterProfileError
    )
    await expect(desk.publishProfile({ country: 'cz' })).rejects.toBeInstanceOf(VetterProfileError)
    expect(mockAsk).not.toHaveBeenCalled()
    mockAsk.mockResolvedValueOnce({ body: { type: `${VETTING.vettersProfile}#response`, payload: {} } })
    await desk.publishProfile({ country: 'CZ', events: [event('2026-10-05', '2026-10-08')] })
    expect(mockAsk).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// 9. trust-task-error: 0.5 read, 0.3 read until its removal date
// ---------------------------------------------------------------------------

describe("the applicant reads a vetter's refusal", () => {
  const ERROR = 'https://trusttasks.org/spec/trust-task-error/'
  const refusal = async (version: string, now?: Date) => {
    const { store, state } = memoryStore({ application: applicationWith({ status: 'sent' }) })
    const vti = new VtiApplicant(
      applicantKey.agent as never,
      applicantKey.persona(community.did) as never,
      store,
      {} as never,
      undefined,
      now ? { now: () => now } : {}
    )
    const inbound = (m: unknown) => (vti as unknown as { inbound(m: unknown): Promise<void> }).inbound(m)
    const type = `${ERROR}${version}`
    await inbound(
      message(
        type,
        vetter.did,
        await document(
          type,
          vetter,
          applicantKey.did,
          { code: 'vetting/request:invalidTicket', retryable: false },
          REQUEST_DOC_ID
        )
      )
    )
    return state.application!.requests[0]
  }
  const before = new Date(Date.parse(`${LEGACY_ERROR_03_UNTIL}T00:00:00Z`) - 86400000)
  const after = new Date(Date.parse(`${LEGACY_ERROR_03_UNTIL}T00:00:00Z`) + 1000)

  it('in trust-task-error/0.5', async () => {
    expect(await refusal('0.5', after)).toMatchObject({
      status: 'refused',
      refusalCode: 'vetting/request:invalidTicket',
    })
  })

  it(`in the legacy 0.3 until ${LEGACY_ERROR_03_UNTIL}, and not after`, async () => {
    expect(await refusal('0.3', before)).toMatchObject({ status: 'refused' })
    expect(await refusal('0.3', after)).toMatchObject({ status: 'sent' })
  })

  it('never in a version Keyring does not emit', async () => {
    expect(await refusal('0.4', before)).toMatchObject({ status: 'sent' })
  })
})

// ---------------------------------------------------------------------------
// 10. The consent decision's payloadDigest
// ---------------------------------------------------------------------------

describe("an approver's consent decision", () => {
  it('is not signed over a payloadDigest that is not a digestMultibase', async () => {
    const client = new VtaClient(vetter.agent as never, community.did, {} as never)
    const task = jest.fn(async () => ({}))
    Object.assign(client as unknown as Record<string, unknown>, { task })
    for (const payloadDigest of ['zQm', 'sha-256:abcd', 'f'.repeat(64), 'z0OIl0OIl0OIl0OIl0'])
      await expect(client.decideConsent({ challenge: random32(), payloadDigest }, 'approve')).rejects.toThrow(
        /payloadDigest/
      )
    expect(task).not.toHaveBeenCalled()
    await client.decideConsent({ challenge: random32(), payloadDigest: digestMultibase({ a: 1 }) }, 'approve')
    expect(task).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// 11. The statement's delivery: a bare body, as the VTC and openvtc send one
// ---------------------------------------------------------------------------

describe("the vetter's statement delivery", () => {
  it('puts credential_response.credential at the top of the DIDComm body (vtc-service delivery.rs:128-141)', async () => {
    sent.length = 0
    const c = await card()
    const { store } = memoryStore({
      desk: [
        {
          requestId: 'r',
          requestDocumentId: REQUEST_DOC_ID,
          applicantDid: applicantKey.did,
          communityDid: community.did,
          status: 'cardReceived',
          receivedAt: 't',
          card: c,
          session: {
            documentId: SESSION_ID,
            challenge: CHALLENGE,
            domain: community.did,
            requiredClaims: ['name.legal'],
            method: 'inPerson',
            expiresAt: new Date(Date.now() + VETTING_SESSION_MS).toISOString(),
            matchCode: 'ABCD-1234',
          },
        },
      ],
    })
    const desk = new VtiVetterDesk(vetter.agent as never, vetter.persona(community.did) as never, store, {} as never)
    await desk.attest('r', { documentClasses: ['passport'], claimsVerified: ['name.legal'], livenessConfirmed: true })
    const delivery = sent.at(-1)!
    expect(delivery.type).toBe(CREDENTIAL_EXCHANGE_ISSUE)
    expect(Object.keys(delivery.body)).toEqual(['credential_response'])
    const credential = (delivery.body.credential_response as { credential: Record<string, unknown> }).credential
    expect(credential).toMatchObject({ issuer: vetter.did, taskContext: SESSION_ID })
    expect(delivery.options).toMatchObject({ thid: SESSION_ID })
  })

  it('a statement in the old document shape is read until its removal date, and not after', async () => {
    const cutoff = Date.parse(`${LEGACY_STATEMENT_DOCUMENT_UNTIL}T00:00:00Z`)
    const read = async (at: number) => {
      const c = await card()
      const { store, state } = memoryStore({
        application: applicationWith({
          status: 'cardSent',
          requestId: 'r',
          cardDigest: 'zPlaceholderDigest',
          session: {
            documentId: SESSION_ID,
            challenge: CHALLENGE,
            domain: community.did,
            requiredClaims: ['name.legal'],
            method: 'inPerson',
            expiresAt: new Date(at + VETTING_SESSION_MS).toISOString(),
            matchCode: 'ABCD-1234',
          },
        }),
      })
      const vti = new VtiApplicant(applicantKey.agent as never, applicantKey.persona(community.did) as never, store, {
        saveHeldCredential: async () => undefined,
      } as never)
      const statement = await signAs(vetter, {
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://firstperson.network/credentials/dtg/v1'],
        type: ['VerifiableCredential', 'DTGCredential', 'EndorsementCredential'],
        id: uuid(),
        issuer: vetter.did,
        validFrom: new Date(at).toISOString(),
        validUntil: new Date(at + 86400000).toISOString(),
        taskContext: SESSION_ID,
        credentialSubject: {
          id: applicantKey.did,
          endorsement: {
            type: 'https://firstperson.network/endorsements/identity-vetting/0.1',
            community: community.did,
            method: 'inPerson',
            identityCommitment: c.identityCommitment,
            cardDigestMultibase: 'zPlaceholderDigest',
          },
        },
      })
      const spy = jest.spyOn(Date, 'now').mockReturnValue(at)
      try {
        await vti.receiveStatement({
          id: uuid(),
          type: CREDENTIAL_EXCHANGE_ISSUE,
          from: vetter.did,
          body: { payload: { credential_response: { credential: statement } } },
        } as never)
      } finally {
        spy.mockRestore()
      }
      return state.application!.requests[0]
    }
    expect(await read(cutoff - 86400000)).toMatchObject({ status: 'attested' })
    expect(await read(cutoff + 1000)).toMatchObject({ status: 'cardSent' })
  })
})
