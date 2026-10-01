/**
 * 228 writer (W1): a Keyring vetter writes DTG Credentials v1's vetted/1
 * statement when `setDtgV1WritingEnabled(true)`, and the old endorsement shape
 * otherwise (the default, unchanged).
 *
 * What it writes is held to what an openvtc applicant requires (vta-sdk 0.58
 * verify_statement; dtg-credentials 0.12.0), which is stricter than Keyring's
 * reader: the exact context order, one concrete subtype, issuerScope, the task
 * citation, and an object.value with the registry members only. The statement
 * vta-sdk itself minted (fixtures/dtg-v1-minted.json, VTI 439a0333) is the
 * yardstick for the members; Keyring's own full applicant check then takes
 * what the desk wrote. Upstream judging it is the vti-conformance job (W2).
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
import { taskDigestMultibase, vettingStatementShapeProblem } from '@bifold/trust-tasks'
// eslint-disable-next-line import/order
import minted from './fixtures/dtg-v1-minted.json'
// eslint-disable-next-line import/order
import { isDtgV1WritingEnabled, setDtgV1WritingEnabled, vettedV1Statement } from '../module/dtgV1Writing'
// eslint-disable-next-line import/order
import { CREDENTIAL_EXCHANGE_ISSUE } from '../module/vtiInbox'
// eslint-disable-next-line import/order
import {
  VtiApplicant,
  VtiVetterDesk,
  cardDigestMultibase,
  identityCommitment,
  type VettingApplication,
  type VettingDeskRequest,
  type VtiVettingStore,
} from '../module/vtiVetting'

type Json = Record<string, unknown>
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
      resolve: () => ({ sign: async ({ data }: { data: Uint8Array }) => ({ signature: ed25519.sign(data, secret) }) }),
    },
  }
  const persona = (communityDid: string) => ({
    did,
    communityDid,
    vtaKeyIds: { signing: verificationMethodId, keyAgreement: verificationMethodId },
    kmsKeyIds: { signing: 'sig', keyAgreement: 'ka' },
  })
  return { did, agent, persona }
}

const community = 'did:webvh:QmCommunity:dids.example:community'
const vetter = didKeySigner()
const applicant = didKeySigner()
const SESSION_ID = 'urn:uuid:4c7d9e1f-2a3b-4c5d-8e6f-7a8b9c0d1e2f'
const SALT = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
const sessionDocument: Json = {
  id: SESSION_ID,
  type: 'https://trusttasks.org/spec/vetting/session/0.1',
  threadId: SESSION_ID,
  issuer: vetter.did,
  recipient: applicant.did,
  issuedAt: '2026-10-01T00:00:00Z',
  payload: { requestId: 'r', domain: community },
}
const claims = [{ type: 'name.legal', value: 'Ada Lovelace', provenance: 'selfAsserted' }]
const card: Json = {
  id: 'urn:uuid:card-1',
  type: ['VerifiableDataStructure', 'RelationshipCard', 'VettingCard'],
  publisher: applicant.did,
  community,
  claims,
  commitmentSalt: SALT,
  identityCommitment: identityCommitment(SALT, claims),
}

const session = (digest?: string) => ({
  documentId: SESSION_ID,
  challenge: SALT,
  domain: community,
  requiredClaims: ['name.legal'],
  method: 'inPerson' as const,
  expiresAt: '2099-01-01T00:00:00Z',
  matchCode: 'ABCD-1234',
  ...(digest ? { taskDigestMultibase: digest } : {}),
})

function deskWith(digest?: string) {
  const state: { desk: VettingDeskRequest[] } = {
    desk: [
      {
        requestId: 'r',
        requestDocumentId: 'urn:uuid:request-1',
        applicantDid: applicant.did,
        communityDid: community,
        status: 'cardReceived',
        receivedAt: 't',
        card,
        session: session(digest),
      } as VettingDeskRequest,
    ],
  }
  const store = {
    listDesk: async () => state.desk.map((r) => ({ ...r })),
    saveDesk: async (r: VettingDeskRequest) => {
      state.desk = [...state.desk.filter((x) => x.requestId !== r.requestId), JSON.parse(JSON.stringify(r))]
    },
  } as unknown as VtiVettingStore
  return new VtiVetterDesk(vetter.agent as never, vetter.persona(community) as never, store, {} as never)
}

const decision = { documentClasses: ['passport'], claimsVerified: ['name.legal'], livenessConfirmed: true }
const delivered = () => ((sent.at(-1)!.body.payload as Json).credential_response as { credential: Json }).credential

afterEach(() => {
  setDtgV1WritingEnabled(false)
  sent.length = 0
})

describe('the writer flag', () => {
  it('is off by default, and the desk writes the endorsement shape as before', async () => {
    expect(isDtgV1WritingEnabled()).toBe(false)
    await deskWith(taskDigestMultibase(sessionDocument)).attest('r', decision)
    const statement = delivered()
    expect(statement.type).toEqual(['VerifiableCredential', 'DTGCredential', 'EndorsementCredential'])
    expect((statement.credentialSubject as Json).endorsement).toMatchObject({
      type: 'https://firstperson.network/endorsements/identity-vetting/0.1',
      community,
      method: 'inPerson',
    })
  })
})

describe('a vetted/1 statement, as written', () => {
  const written = vettedV1Statement({
    id: 'urn:uuid:s',
    issuer: vetter.did,
    subject: applicant.did,
    validFrom: '2026-10-01T00:00:00Z',
    validUntil: '2026-10-31T00:00:00Z',
    taskContext: SESSION_ID,
    taskDigestMultibase: taskDigestMultibase(sessionDocument),
    attestation: {
      community,
      method: 'inPerson',
      documentClasses: ['passport'],
      claimsVerified: ['name.legal'],
      livenessConfirmed: true,
      identityCommitment: 'zQmTpxHiaisC5veqP3CFUD4EhUrWnhXNm1ZkAyULkD9DxTK',
      cardDigestMultibase: 'zQmZdubwrW14GRABWD49GQ6DbRPZDA81uiaD9YDw5ZqVH5c',
      declaredRelationship: 'none',
    },
  })

  it('has the exact context order and one concrete subtype (dtg-credentials check_context, strict parse)', () => {
    expect(written['@context']).toEqual([
      'https://www.w3.org/ns/credentials/v2',
      'https://registry.trustoverip.org/dtg/context/v1',
    ])
    expect(written.type).toEqual(['VerifiableCredential', 'DTGCredential', 'StatementCredential'])
    expect(written.issuerScope).toBe('directed')
  })

  it('has the members vta-sdk sign_statement writes, top level and in object.value', () => {
    const upstream = minted.boundVettingStatement as Json
    const keys = (o: Json) =>
      Object.keys(o)
        .filter((k) => k !== 'proof')
        .sort()
    expect(keys(written)).toEqual(keys(upstream))
    const value = (s: Json) => ((s.credentialSubject as Json).object as Json).value as Json
    expect(Object.keys(value(written)).sort()).toEqual(Object.keys(value(upstream)).sort())
    expect(value(written).type).toBeUndefined()
    expect(Object.keys(written.credentialSubject as Json).sort()).toEqual(
      Object.keys(upstream.credentialSubject as Json).sort()
    )
  })

  it("passes Keyring's own shape check", () => {
    expect(vettingStatementShapeProblem(written, Date.parse('2026-10-02T00:00:00Z'))).toBeUndefined()
  })
})

describe('the desk with the flag on', () => {
  it('writes a vetted/1 statement, signed once for assertionMethod by the vetter', async () => {
    setDtgV1WritingEnabled(true)
    await deskWith(taskDigestMultibase(sessionDocument)).attest('r', decision)
    expect(sent.at(-1)!.type).toBe(CREDENTIAL_EXCHANGE_ISSUE)
    const statement = delivered()
    expect(statement.type).toEqual(['VerifiableCredential', 'DTGCredential', 'StatementCredential'])
    expect(statement.taskDigestMultibase).toBe(taskDigestMultibase(sessionDocument))
    const proof = statement.proof as Json
    expect(Array.isArray(proof)).toBe(false)
    expect(proof).toMatchObject({ type: 'DataIntegrityProof', proofPurpose: 'assertionMethod' })
    expect(String(proof.verificationMethod).startsWith(vetter.did)).toBe(true)
  })

  it('refuses to write one for a session that kept no task digest', async () => {
    setDtgV1WritingEnabled(true)
    await expect(deskWith(undefined).attest('r', decision)).rejects.toThrow('no task digest')
    expect(sent).toHaveLength(0)
  })

  it("is taken by Keyring's applicant, through the full check, digest binding included", async () => {
    setDtgV1WritingEnabled(true)
    const digest = taskDigestMultibase(sessionDocument)
    await deskWith(digest).attest('r', decision)
    const statement = delivered()
    // The new shape, not the endorsement the applicant would also take.
    expect(statement.type).toEqual(['VerifiableCredential', 'DTGCredential', 'StatementCredential'])

    let application: VettingApplication = {
      communityDid: community,
      joinDid: applicant.did,
      minStatements: 1,
      requiredClaims: ['name.legal'],
      acceptedMethods: ['inPerson'],
      commitmentSalt: SALT,
      claims: { 'name.legal': 'Ada Lovelace' },
      startedAt: 't',
      requests: [
        {
          vetterDid: vetter.did,
          requestDocumentId: 'urn:uuid:request-1',
          status: 'cardSent',
          session: session(digest),
          cardCommitment: card.identityCommitment as string,
          cardDigest: cardDigestMultibase(card),
          updatedAt: 't',
        },
      ],
    } as VettingApplication
    const store = {
      getApplication: async () => JSON.parse(JSON.stringify(application)),
      saveApplication: async (a: VettingApplication) => {
        application = JSON.parse(JSON.stringify(a))
      },
    } as unknown as VtiVettingStore
    const held: unknown[] = []
    const vti = new VtiApplicant(applicant.agent as never, applicant.persona(community) as never, store, {
      saveHeldCredential: async (c: unknown) => {
        held.push(c)
      },
    } as never)
    // The suite pins Date.now(); the desk stamped validFrom with the real
    // clock. Judge the statement a minute into its own window.
    const at = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(String(statement.validFrom)) + 60000)
    await vti.receiveStatement({
      id: 'm',
      type: CREDENTIAL_EXCHANGE_ISSUE,
      from: vetter.did,
      body: sent.at(-1)!.body,
    } as never)
    at.mockRestore()
    expect(application.requests[0].statementRefusal).toBeUndefined()
    expect(application.requests[0]).toMatchObject({ status: 'attested', statementId: statement.id })
    expect(held).toHaveLength(1)
  })
})
