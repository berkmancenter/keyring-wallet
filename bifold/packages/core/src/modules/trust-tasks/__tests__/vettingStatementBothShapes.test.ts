/**
 * 228: a vetting statement is read in both shapes — the endorsement shape
 * Keyring has always read, and DTG Credentials v1's vetted/1 StatementCredential
 * (VTI 0.47.0, #1859) — through the same full check.
 *
 * Old shape: `vti-upstream-signed.json`, the upstream statement and card this
 * suite has always used. New shape: `dtg-v1-minted.json`, minted with VTI's
 * own issuing code at 439a0333 (vta-service-v0.47.0): vta-sdk `sign_statement`
 * for the statements, the VTC's `issue_membership` / `issue_role_action` for
 * the cards. Crate-minted, not from a deployed VTC; its `boundVettingStatement`
 * is bound to the same card and session as the old fixture, so one application
 * can check either. Its parties are did:keys, so every proof verifies offline.
 */
import { DidKey } from '@credo-ts/core'

jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  vtiAgent: { send: jest.fn(async () => undefined), onInbound: () => () => undefined },
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

// eslint-disable-next-line import/order
import {
  LEGACY_DTG_SHAPE_UNTIL,
  statementFacts,
  vettingStatementBody,
  vettingStatementShapeProblem,
} from '@bifold/trust-tasks'
// eslint-disable-next-line import/order
import minted from './fixtures/dtg-v1-minted.json'
// eslint-disable-next-line import/order
import signed from './fixtures/vti-upstream-signed.json'
// eslint-disable-next-line import/order
import type { VtiHeldCredential } from '../module/VtiCommunityStore'
// eslint-disable-next-line import/order
import { checkVettingRequirements } from '../module/vettingShape'
// eslint-disable-next-line import/order
import { CREDENTIAL_EXCHANGE_ISSUE, classifyCredential, receiveIssue } from '../module/vtiInbox'
// eslint-disable-next-line import/order
import { VtiApplicant, cardDigestMultibase, type VettingApplication, type VtiVettingStore } from '../module/vtiVetting'

type Json = Record<string, unknown>

const oldStatement = signed.statement as Json
const newStatement = minted.boundVettingStatement as Json
const card = signed.card as Json

const agent = {
  config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
  dids: { resolveDidDocument: async (d: string) => DidKey.fromDid(d).didDocument },
}

/** One application, with a request to `vetterDid` on the fixtures' session and card. */
function world(vetterDid: string) {
  let application: VettingApplication = {
    communityDid: signed.community,
    joinDid: signed.applicantDid,
    minStatements: 1,
    requiredClaims: ['name.legal'],
    acceptedMethods: ['inPerson'],
    commitmentSalt: card.commitmentSalt as string,
    claims: { 'name.legal': 'Ada Lovelace' },
    startedAt: 't',
    requests: [
      {
        vetterDid,
        requestDocumentId: 'urn:uuid:request-both-shapes',
        status: 'cardSent',
        session: { ...signed.session, method: 'inPerson', matchCode: 'ABCD-1234', expiresAt: '2026-12-31T00:00:00Z' },
        cardCommitment: card.identityCommitment as string,
        cardDigest: cardDigestMultibase(card),
        updatedAt: 't',
      },
    ],
  }
  const store = {
    getApplication: async () => JSON.parse(JSON.stringify(application)),
    saveApplication: async (a: VettingApplication) => {
      application = JSON.parse(JSON.stringify(a))
    },
  } as unknown as VtiVettingStore
  const held: VtiHeldCredential[] = []
  const community = {
    saveHeldCredential: jest.fn(async (c: VtiHeldCredential) => {
      if (!held.some((h) => h.credential.id === c.credential.id)) held.push(c)
    }),
    listHeldCredentials: async (kind?: string) => held.filter((h) => !kind || h.kind === kind),
    getMembership: async () => undefined,
    saveMembership: async () => undefined,
  }
  const persona = { did: signed.applicantDid, communityDid: signed.community, vtaKeyIds: {}, kmsKeyIds: {} }
  const vti = new VtiApplicant(agent as never, persona as never, store, community as never)
  const issue = (credential: Json) =>
    ({
      type: CREDENTIAL_EXCHANGE_ISSUE,
      from: vetterDid,
      to: [signed.applicantDid],
      thid: signed.session.documentId,
      body: { credential_response: { credential } },
    }) as never
  const deliver = (credential: Json) =>
    receiveIssue(community as never, signed.applicantDid, issue(credential), {
      acceptStatement: (m) => vti.receiveStatement(m),
      checkCard: async () => undefined,
    })
  return { vti, held, deliver, request: () => application.requests[0] }
}

describe('the two shapes, read the same way', () => {
  it('finds the attestation in each: the endorsement, and vetted/1 object.value', () => {
    expect(vettingStatementBody(oldStatement)?.shape).toBe('endorsement')
    const read = vettingStatementBody(newStatement)
    expect(read?.shape).toBe('vetted/1')
    expect(read?.body).toMatchObject({ community: signed.community, method: 'inPerson', livenessConfirmed: true })
    // vetted/1's body carries no `type` member (registry vetted/1 schema).
    expect(read?.body.type).toBeUndefined()
  })

  it('is not fooled by other DTG v1 cards: a role grant or a membership is no statement', () => {
    expect(vettingStatementBody(minted.vetterGrant as Json)).toBeUndefined()
    expect(vettingStatementBody(minted.vetterMembership as Json)).toBeUndefined()
    expect(vettingStatementBody(minted.witnessStatement as Json)).toBeUndefined()
  })

  it('reads the same facts from either for the advance count', () => {
    const pick = (f: ReturnType<typeof statementFacts>) => ({
      subject: f.subject,
      method: f.method,
      identityCommitment: f.identityCommitment,
      declaredRelationship: f.declaredRelationship,
    })
    expect(pick(statementFacts(newStatement))).toEqual(pick(statementFacts(oldStatement)))
  })

  it('classifies a vetted/1 statement as a vetting statement for its community', () => {
    expect(classifyCredential(newStatement)).toMatchObject({
      kind: 'vetting-statement',
      communityDid: signed.community,
      subjectDid: signed.applicantDid,
    })
    expect(classifyCredential(oldStatement)).toMatchObject({
      kind: 'vetting-statement',
      communityDid: signed.community,
    })
  })
})

describe('the shape check', () => {
  const at = Date.parse('2026-10-02T00:00:00Z')

  it('accepts each shape as issued', () => {
    expect(vettingStatementShapeProblem(oldStatement, at)).toBeUndefined()
    expect(vettingStatementShapeProblem(newStatement, at)).toBeUndefined()
  })

  it('stops reading the old shape on LEGACY_DTG_SHAPE_UNTIL', () => {
    const cut = Date.parse(`${LEGACY_DTG_SHAPE_UNTIL}T00:00:00Z`)
    expect(vettingStatementShapeProblem(oldStatement, cut - 1)).toBeUndefined()
    expect(vettingStatementShapeProblem(oldStatement, cut)).toBe('legacyShapeRetired')
    expect(vettingStatementShapeProblem(newStatement, cut)).toBeUndefined()
  })

  // cred-spec Base Structure (body.md:191): a verifier MUST reject a card
  // without a valid issuerScope; vetted/1's minimum is `directed`.
  it.each([
    ['without issuerScope', { issuerScope: undefined }],
    ['declaring pairwise', { issuerScope: 'pairwise' }],
    ['declaring an unknown scope', { issuerScope: 'everyone' }],
    ['without taskDigestMultibase', { taskDigestMultibase: undefined }],
    ['without its id', { id: undefined }],
    [
      'under the old context',
      { '@context': ['https://www.w3.org/ns/credentials/v2', 'https://firstperson.network/credentials/dtg/v1'] },
    ],
  ])('refuses a vetted/1 statement %s', (_why, change) => {
    expect(vettingStatementShapeProblem({ ...newStatement, ...change }, at)).toBe('malformed')
  })
})

describe('a vetted/1 statement through the applicant’s full check', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-02T00:00:00Z')))
  afterEach(() => jest.restoreAllMocks())

  it('is kept and counted, as an endorsement-shape one is', async () => {
    const w = world(minted.parties.vetter)
    await w.deliver(newStatement)
    expect(w.held.map((h) => h.credential.id)).toEqual([newStatement.id])
    expect(w.request()).toMatchObject({ status: 'attested', statementId: newStatement.id })
    await expect(w.vti.checklist()).resolves.toMatchObject({ held: 1, counted: 1 })
  })

  it('is refused when altered after signing', async () => {
    const w = world(minted.parties.vetter)
    await w.deliver({ ...newStatement, validUntil: '2099-01-01T00:00:00Z' })
    expect(w.held).toHaveLength(0)
    expect(w.request()).toMatchObject({ status: 'statementRefused', statementRefusal: 'proof' })
  })

  it('is left alone when it is about someone else', async () => {
    const w = world(minted.parties.vetter)
    // The unbound minted statement names another applicant, community and
    // card: not this persona's statement to keep, nor to report as refused.
    await w.deliver(minted.vettingStatement as Json)
    expect(w.held).toHaveLength(0)
    expect(w.request().status).toBe('cardSent')
  })

  it('is refused as malformed when it declares no issuerScope', async () => {
    const w = world(minted.parties.vetter)
    await w.deliver({ ...newStatement, issuerScope: undefined })
    expect(w.request()).toMatchObject({ status: 'statementRefused', statementRefusal: 'malformed' })
  })
})

describe('a community’s requirements naming the vetted/1 predicate', () => {
  it('validate: statementType is the predicate IRI (manifest/0.2 as recast by tf #691)', () => {
    // VTI 439a0333, vti-vetting-pcs/tests/fixtures/submission.json `requirements`.
    const requirements = {
      acceptedMethods: ['inPerson', 'video', 'priorAcquaintance'],
      eligibleVetters: { role: 'vetter' },
      independence: { maxByDeclaredRelationship: { family: 0 }, requireConsistentIdentityCommitment: true },
      maxStatementAge: 'P120D',
      minByMethod: { inPerson: 1 },
      minStatements: 2,
      requiredClaims: ['name.legal'],
      statementType: 'https://registry.trustoverip.org/dtg/vsc/vetted/1',
      version: '0.1',
    }
    expect(checkVettingRequirements(requirements)).toEqual({ ok: true })
  })
})
