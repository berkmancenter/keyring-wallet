/**
 * A vetting statement counts only after the applicant's full check — the one
 * an openvtc applicant runs (vta-sdk `verify_statement`, openvtc `on_statement`,
 * `VtiApplicant.receiveStatement`).
 *
 * Found by the conformance inventory (2026-09-25, "Vetting statement
 * (accepted)"): `receiveIssue` — which the persona inbox and the Vetting
 * screen both run on every `credential-exchange/issue` — stored any statement
 * as it came, unchecked, and `checklist()` counted and submitted whatever was
 * stored. A statement nobody checked could make "1 of 1".
 */
import { DidKey } from '@credo-ts/core'

jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  vtiAgent: { send: jest.fn(async () => undefined), onInbound: () => () => undefined },
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

// eslint-disable-next-line import/order
import signed from './fixtures/vti-upstream-signed.json'
// eslint-disable-next-line import/order
import type { VtiHeldCredential } from '../module/VtiCommunityStore'
// eslint-disable-next-line import/order
import { CREDENTIAL_EXCHANGE_ISSUE, receiveIssue } from '../module/vtiInbox'
// eslint-disable-next-line import/order
import { VtiApplicant, cardDigestMultibase, type VettingApplication, type VtiVettingStore } from '../module/vtiVetting'

const agent = {
  config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
  dids: { resolveDidDocument: async (d: string) => DidKey.fromDid(d).didDocument },
}
const card = signed.card as Record<string, unknown>
const statement = signed.statement as Record<string, unknown>

function world() {
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
        vetterDid: signed.vetterDid,
        requestDocumentId: 'urn:uuid:request-upstream',
        status: 'cardSent',
        session: { ...signed.session, method: 'inPerson', matchCode: 'ABCD-1234', expiresAt: '2026-09-25T00:30:00Z' },
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
  const issue = (credential: Record<string, unknown>) =>
    ({
      type: CREDENTIAL_EXCHANGE_ISSUE,
      from: signed.vetterDid,
      to: [signed.applicantDid],
      thid: signed.session.documentId,
      body: { credential_response: { credential } },
    }) as never
  const acceptStatement = (m: never) => vti.receiveStatement(m)
  return { vti, community, held, issue, acceptStatement, request: () => application.requests[0] }
}

describe('a statement arriving through an inbox', () => {
  beforeEach(() => {
    // Inside the statement's window (the test setup pins Date.now() to 2024).
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-25T00:05:00Z'))
  })
  afterEach(() => jest.restoreAllMocks())

  it('is not stored by receiveIssue on its own', async () => {
    const w = world()
    await receiveIssue(w.community as never, signed.applicantDid, w.issue(statement))
    expect(w.held).toHaveLength(0)
  })

  it('is stored when the full check passes, and counted', async () => {
    const w = world()
    await receiveIssue(w.community as never, signed.applicantDid, w.issue(statement), {
      acceptStatement: w.acceptStatement,
    })
    expect(w.held.map((h) => h.credential.id)).toEqual([statement.id])
    expect(w.request()).toMatchObject({ status: 'attested', statementId: statement.id })
    await expect(w.vti.checklist()).resolves.toMatchObject({ held: 1, counted: 1 })
  })

  it('is not stored when it fails — altered after signing — and the refusal is recorded', async () => {
    const w = world()
    const altered = { ...statement, validUntil: '2099-01-01T00:00:00Z' }
    await receiveIssue(w.community as never, signed.applicantDid, w.issue(altered), {
      acceptStatement: w.acceptStatement,
    })
    expect(w.held).toHaveLength(0)
    expect(w.request()).toMatchObject({ status: 'statementRefused', statementRefusal: 'proof' })
  })
})

describe('the checklist', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-25T00:05:00Z')))
  afterEach(() => jest.restoreAllMocks())

  it('does not count a statement that was stored without being checked', async () => {
    // What an inbox before PR D left in the store: held, never accepted.
    const w = world()
    w.held.push({
      kind: 'vetting-statement',
      communityDid: signed.community,
      subjectDid: signed.applicantDid,
      credential: statement,
      receivedAt: 't',
    })
    await expect(w.vti.checklist()).resolves.toMatchObject({ held: 0, counted: 0, meets: false, statements: [] })
  })
})
