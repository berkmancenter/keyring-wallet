/**
 * Proofs made by UPSTREAM code, verified by Keyring's. The card and the
 * statement in `fixtures/vti-upstream-signed.json` were signed by vta-sdk's own
 * `vetting::card::sign_card` and `vetting::statement::sign_statement` (wallet
 * `scripts/openvtc/card-verify sign-fixtures`, VTI a96fe02f), with fixed-seed
 * did:key keys — never by Keyring. The other direction (vta-sdk verifying what
 * Keyring signs) is the vti-conformance workflow.
 */
import { DidKey } from '@credo-ts/core'

jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  vtiAgent: { send: jest.fn(async () => undefined), onInbound: () => () => undefined },
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

// eslint-disable-next-line import/order
import { verifyDocumentProof } from '@bifold/trust-tasks'

// eslint-disable-next-line import/order
import signed from './fixtures/vti-upstream-signed.json'
// eslint-disable-next-line import/order
import { CREDENTIAL_EXCHANGE_ISSUE } from '../module/vtiInbox'
// eslint-disable-next-line import/order
import { VtiApplicant, cardDigestMultibase, type VtiVettingStore } from '../module/vtiVetting'

/** Resolves a did:key locally, which is all these proofs need. */
const agent = { dids: { resolveDidDocument: async (d: string) => DidKey.fromDid(d).didDocument } }
const card = signed.card as Record<string, unknown>
const statement = signed.statement as Record<string, unknown>

describe('proofs upstream made', () => {
  it("on a card: Keyring's verifier accepts it", async () => {
    await expect(verifyDocumentProof(agent as never, card, signed.applicantDid)).resolves.toBe(true)
  })

  it("on a statement: Keyring's verifier accepts it", async () => {
    await expect(verifyDocumentProof(agent as never, statement, signed.vetterDid)).resolves.toBe(true)
  })

  it("the card's digest upstream computed is Keyring's", () => {
    expect(cardDigestMultibase(card)).toBe(signed.cardDigest)
  })
})

describe('a statement upstream signed, delivered to a Keyring applicant', () => {
  afterEach(() => jest.restoreAllMocks())

  it('is kept, its proof checked by Keyring', async () => {
    // Inside the statement's window (the test setup pins Date.now() to 2024).
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-25T00:05:00Z'))
    const application = {
      communityDid: signed.community,
      joinDid: signed.applicantDid,
      minStatements: 1,
      requiredClaims: ['name.legal'],
      acceptedMethods: ['inPerson'],
      commitmentSalt: card.commitmentSalt,
      claims: { 'name.legal': 'Ada Lovelace' },
      startedAt: 't',
      requests: [
        {
          vetterDid: signed.vetterDid,
          requestDocumentId: 'urn:uuid:request-upstream',
          status: 'cardSent',
          session: { ...signed.session, method: 'inPerson', matchCode: 'ABCD-1234', expiresAt: '2026-09-25T00:30:00Z' },
          cardCommitment: card.identityCommitment,
          cardDigest: cardDigestMultibase(card),
        },
      ],
    }
    const store = {
      getApplication: async () => application,
      saveApplication: jest.fn(async () => undefined),
    } as unknown as VtiVettingStore
    const persona = { did: signed.applicantDid, communityDid: signed.community, vtaKeyIds: {}, kmsKeyIds: {} }
    const vti = new VtiApplicant(agent as never, persona as never, store, {
      saveHeldCredential: jest.fn(async () => undefined),
    } as never)
    await (vti as unknown as { inbound(m: unknown): Promise<void> }).inbound({
      type: CREDENTIAL_EXCHANGE_ISSUE,
      from: signed.vetterDid,
      to: [signed.applicantDid],
      thid: signed.session.documentId,
      body: { credential_response: { credential: statement } },
    })
    expect(application.requests[0]).toMatchObject({ status: 'attested', statementId: statement.id })
  })
})
