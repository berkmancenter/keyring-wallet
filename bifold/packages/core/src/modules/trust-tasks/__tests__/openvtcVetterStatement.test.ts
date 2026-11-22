// A statement from an openvtc vetter, received by a Keyring applicant (a
// maintainer's run, 2026-09-25: openvtc said "Statement signed and sent", and
// the phone stayed on "the vetter is checking"). openvtc names the card by the
// digest the VTI SDK computed when it verified it: DTG Credentials'
// digestMultibase, JCS of the card WITHOUT its top-level proof
// (dtg-credentials 0.9.1 `digest_multibase_json`, lib.rs:534, called by vta-sdk
// `vetting/mod.rs:176` `digest` from `vetting/card.rs:322`, at VTI a96fe02f).
// Keyring hashed the card with its proof, so it refused every such statement,
// and said nothing.
//
// The fixture is a real card made by the shipping sendCard and signed by a
// did:key (cardConformance.test.ts). Its digest below was computed by the
// upstream function, not by Keyring: `card-verify digest` (wallet
// scripts/openvtc/card-verify, at VTI a96fe02f). The statement is shaped as
// openvtc sends it: a DIDComm `credential-exchange/issue/0.1` whose body is
// `{ credential_response: { credential } }` (openvtc-core `vetting/wire.rs:177`
// `credential_delivery`, at ed13d29).

jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  vtiAgent: { send: jest.fn(async () => undefined), onInbound: () => () => undefined },
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  // The card is the fixture, whatever sendCard built; statements verify.
  signDocumentProof: jest.fn(async () => jest.requireActual('./fixtures/vetting-card-signed.json')),
  verifyDocumentProof: jest.fn(async () => true),
}))

// eslint-disable-next-line import/order
import { digestMultibase } from '@bifold/trust-tasks'

// eslint-disable-next-line import/order
import signedCard from './fixtures/vetting-card-signed.json'
// eslint-disable-next-line import/order
import { CREDENTIAL_EXCHANGE_ISSUE, IDENTITY_VETTING_ENDORSEMENT_TYPE } from '../module/vtiInbox'
// eslint-disable-next-line import/order
import { VtiApplicant, cardDigestMultibase, type VtiVettingStore } from '../module/vtiVetting'

/** `card-verify digest vetting-card-signed.json`, at VTI a96fe02f. */
const UPSTREAM_CARD_DIGEST = 'zQmSLKtouTzKw1pCZu1RTs2UddtW5WoSYPBpWEzA9NdNvB1'

const card = signedCard as Record<string, unknown>
const COMMUNITY = card.community as string
const JOIN = card.publisher as string
const VETTER = card.audience as string
const SESSION = 'urn:uuid:session-openvtc'

describe("a card's digest", () => {
  it("is the VTI SDK's: the card without its proof", () => {
    expect(cardDigestMultibase(card)).toBe(UPSTREAM_CARD_DIGEST)
    // What Keyring named before, which no openvtc applicant or vetter accepts:
    expect(digestMultibase(card)).not.toBe(UPSTREAM_CARD_DIGEST)
  })
})

describe('a statement from an openvtc vetter', () => {
  function applicant() {
    const application = {
      communityDid: COMMUNITY,
      joinDid: JOIN,
      minStatements: 1,
      requiredClaims: ['name.legal'],
      acceptedMethods: ['inPerson'],
      commitmentSalt: card.commitmentSalt,
      claims: { 'name.legal': 'Ada Lovelace' },
      startedAt: 't',
      requests: [
        {
          vetterDid: VETTER,
          requestDocumentId: 'urn:uuid:request-1',
          status: 'session',
          session: {
            documentId: SESSION,
            requiredClaims: ['name.legal'],
            challenge: card.challenge,
            domain: card.domain,
            method: 'inPerson',
            matchCode: 'ABCD-1234',
            // `new Date()`, not `Date.now()`: the test setup pins the latter.
            expiresAt: new Date(new Date().getTime() + 10 * 60000).toISOString(),
          },
        },
      ],
    }
    const store = {
      getApplication: async () => application,
      saveApplication: jest.fn(async () => undefined),
    } as unknown as VtiVettingStore
    const persona = {
      did: JOIN,
      communityDid: COMMUNITY,
      vtaKeyIds: { signing: `${JOIN}#key-0`, keyAgreement: `${JOIN}#key-1` },
      kmsKeyIds: { signing: 'sig', keyAgreement: 'ka' },
    }
    const held = jest.fn(async () => undefined)
    const vti = new VtiApplicant({} as never, persona as never, store, { saveHeldCredential: held } as never)
    const request = () => application.requests[0] as Record<string, unknown>
    const deliver = (credential: Record<string, unknown>) =>
      (vti as unknown as { inbound(m: unknown): Promise<void> }).inbound({
        type: CREDENTIAL_EXCHANGE_ISSUE,
        from: VETTER,
        to: [JOIN],
        thid: SESSION,
        body: { credential_response: { credential } },
      })
    return { vti, request, deliver, held }
  }

  function statement(cardDigest: string, overrides: Record<string, unknown> = {}) {
    const now = Date.now()
    return {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://firstperson.network/credentials/dtg/v1'],
      type: ['VerifiableCredential', 'DTGCredential', 'EndorsementCredential'],
      id: 'urn:uuid:statement-1',
      issuer: VETTER,
      validFrom: new Date(now - 60000).toISOString(),
      validUntil: new Date(now + 120 * 86400000).toISOString(),
      taskContext: SESSION,
      credentialSubject: {
        id: JOIN,
        endorsement: {
          type: IDENTITY_VETTING_ENDORSEMENT_TYPE,
          community: COMMUNITY,
          method: 'inPerson',
          documentClasses: ['passport'],
          claimsVerified: ['name.legal'],
          livenessConfirmed: true,
          identityCommitment: card.identityCommitment,
          cardDigestMultibase: cardDigest,
          declaredRelationship: 'none',
        },
      },
      proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', proofValue: 'z' },
      ...overrides,
    }
  }

  it('is kept when it names the card as the VTI SDK digests it', async () => {
    const { vti, request, deliver, held } = applicant()
    await vti.sendCard(VETTER)
    await deliver(statement(UPSTREAM_CARD_DIGEST))
    expect(request()).toMatchObject({ status: 'attested', statementId: 'urn:uuid:statement-1' })
    expect(held).toHaveBeenCalledTimes(1)
  })

  it('from a Keyring vetter up to 223, which named the card with its proof, is kept too', async () => {
    const { vti, request, deliver } = applicant()
    await vti.sendCard(VETTER)
    await deliver(statement(digestMultibase(card)))
    expect(request()).toMatchObject({ status: 'attested' })
  })

  it('about a different card is shown as refused, with the reason', async () => {
    const { vti, request, deliver, held } = applicant()
    await vti.sendCard(VETTER)
    await deliver(statement('zQmSomeOtherCard'))
    expect(request()).toMatchObject({ status: 'statementRefused', statementRefusal: 'cardDigest' })
    expect(held).not.toHaveBeenCalled()
  })

  it('from an earlier session is shown as refused, not kept', async () => {
    const { vti, request, deliver } = applicant()
    await vti.sendCard(VETTER)
    await deliver(statement(UPSTREAM_CARD_DIGEST, { taskContext: 'urn:uuid:an-earlier-session' }))
    expect(request()).toMatchObject({ status: 'statementRefused', statementRefusal: 'session' })
  })

  it('once kept, is not replaced by a refused copy', async () => {
    const { vti, request, deliver } = applicant()
    await vti.sendCard(VETTER)
    await deliver(statement(UPSTREAM_CARD_DIGEST))
    await deliver(statement('zQmSomeOtherCard', { id: 'urn:uuid:statement-2' }))
    expect(request()).toMatchObject({ status: 'attested', statementId: 'urn:uuid:statement-1' })
  })
})
