/**
 * A Vetting Card made by the shipping code (`VtiApplicant.sendCard`) and really
 * signed — eddsa-jcs-2022 over a `did:key` persona's Ed25519 key — so the VTI
 * SDK's own verifier can judge it (wallet `scripts/openvtc/card-verify`, the
 * check an openvtc vetter runs). Nothing is mocked between the application and
 * the signed card except the key store and the DID resolver, which a `did:key`
 * needs none of.
 *
 * With `CARD_OUT=<dir>` it writes `card.json` and `expect.json` there for
 * `card-verify`; the gate runs the two together
 * (`scripts/openvtc/card-verify/check-keyring-card.sh`).
 *
 * The same run has Keyring's vetter (`VtiVetterDesk.attest`) attest to that
 * card, really signed by the vetter's did:key, and writes `statement.json`:
 * `card-verify verify-statement` runs vta-sdk's `verify_statement` and
 * `check_against_card` on it — what an openvtc applicant runs on a statement
 * it receives (openvtc-core `vetting/applicant.rs:1068`, at ed13d29).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { DidKey, TypedArrayEncoder } from '@credo-ts/core'
import { ed25519 } from '@noble/curves/ed25519.js'

const mockSend = jest.fn(async () => undefined)
jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  vtiAgent: { send: (...a: unknown[]) => (mockSend as jest.Mock)(...a), onInbound: () => () => undefined },
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

// eslint-disable-next-line import/order
import {
  MAX_CARD_VALIDITY_MS,
  VtiApplicant,
  VtiVetterDesk,
  cardDigestMultibase,
  type VettingDeskRequest,
  type VtiVettingStore,
} from '../module/vtiVetting'
// eslint-disable-next-line import/order
import { verifyDocumentProof } from '@bifold/trust-tasks'

/** 32 random bytes, base64url — the shape the schema requires of a salt and a challenge. */
const random32 = () => TypedArrayEncoder.toBase64Url(ed25519.utils.randomSecretKey())

/** A did:key over an Ed25519 key, and an agent that can sign as it — nothing else. */
function didKeySigner() {
  const secret = ed25519.utils.randomSecretKey()
  const publicKey = ed25519.getPublicKey(secret)
  const did = `did:key:z${TypedArrayEncoder.toBase58(new Uint8Array([0xed, 0x01, ...publicKey]))}`
  const document = DidKey.fromDid(did).didDocument
  const verificationMethodId = document.verificationMethod?.[0]?.id as string
  const agent = {
    dids: { resolveDidDocument: async (d: string) => DidKey.fromDid(d).didDocument },
    dependencyManager: {
      resolve: () => ({
        sign: async ({ data }: { data: Uint8Array }) => ({ signature: ed25519.sign(data, secret) }),
      }),
    },
  }
  return { did, verificationMethodId, agent, publicKey }
}

describe('a Vetting Card from the shipping code, really signed', () => {
  it('carries a proof that verifies, and a window within the SDK limit', async () => {
    const applicant = didKeySigner()
    const vetter = didKeySigner()
    const community = 'did:webvh:QmCommunity:dids.example:community'
    const session = {
      documentId: 'urn:uuid:session-conformance',
      requiredClaims: ['name.legal'],
      challenge: random32(),
      // The spec: a vetter MUST set `domain` to the request's community.
      domain: community,
      // `new Date()`, not `Date.now()`: the test setup pins the latter.
      expiresAt: new Date(new Date().getTime() + 30 * 60000).toISOString(),
    }
    const application = {
      communityDid: community,
      joinDid: applicant.did,
      minStatements: 1,
      requiredClaims: session.requiredClaims,
      acceptedMethods: ['inPerson'],
      commitmentSalt: random32(),
      claims: { 'name.legal': 'Ada Lovelace' },
      startedAt: 't',
      requests: [{ vetterDid: vetter.did, status: 'sessionOpen', session }],
    }
    const store = {
      getApplication: async () => application,
      saveApplication: jest.fn(async () => undefined),
    } as unknown as VtiVettingStore
    const persona = {
      did: applicant.did,
      communityDid: community,
      vtaKeyIds: { signing: applicant.verificationMethodId, keyAgreement: applicant.verificationMethodId },
      kmsKeyIds: { signing: 'applicant-key', keyAgreement: 'applicant-key' },
    }

    const card = await new VtiApplicant(applicant.agent as never, persona as never, store, {} as never).sendCard(
      vetter.did
    )

    // The proof verifies against the did:key, before anyone else looks at it.
    await expect(verifyDocumentProof(applicant.agent as never, card, applicant.did)).resolves.toBe(true)
    const window = Date.parse(card.expiresAt as string) - Date.parse(card.issuedAt as string)
    expect(window).toBeGreaterThan(0)
    expect(window).toBeLessThanOrEqual(MAX_CARD_VALIDITY_MS)

    // Keyring's vetter attests to that card. The statement must name the card
    // by its DTG digestMultibase — JCS WITHOUT the top-level proof, as the VTI
    // SDK computes it — or an openvtc applicant refuses it (vta-sdk
    // vetting/statement.rs check_against_card, at a96fe02f).
    const desk: VettingDeskRequest = {
      requestId: 'request-conformance',
      applicantDid: applicant.did,
      communityDid: community,
      status: 'cardReceived',
      receivedAt: new Date().toISOString(),
      session: { ...session, method: 'inPerson', matchCode: 'ABCD-1234' },
      card,
    }
    const deskStore = {
      listDesk: async () => [desk],
      saveDesk: jest.fn(async () => undefined),
    } as unknown as VtiVettingStore
    const vetterPersona = {
      did: vetter.did,
      communityDid: community,
      vtaKeyIds: { signing: vetter.verificationMethodId, keyAgreement: vetter.verificationMethodId },
      kmsKeyIds: { signing: 'vetter-key', keyAgreement: 'vetter-key' },
    }
    mockSend.mockClear()
    await new VtiVetterDesk(vetter.agent as never, vetterPersona as never, deskStore, {} as never).attest(
      desk.requestId,
      { documentClasses: ['passport'], claimsVerified: ['name.legal'], livenessConfirmed: true }
    )
    const issue = (mockSend.mock.calls.at(-1) as unknown as [string, string, { payload: Record<string, unknown> }])[2]
    const statement = (issue.payload.credential_response as { credential: Record<string, unknown> }).credential
    const endorsement = (statement.credentialSubject as { endorsement: Record<string, unknown> }).endorsement
    expect(endorsement.cardDigestMultibase).toBe(cardDigestMultibase(card))
    expect(endorsement.identityCommitment).toBe(card.identityCommitment)
    await expect(verifyDocumentProof(vetter.agent as never, statement, vetter.did)).resolves.toBe(true)

    const out = process.env.CARD_OUT
    if (out) {
      mkdirSync(out, { recursive: true })
      writeFileSync(join(out, 'card.json'), JSON.stringify(card, null, 2))
      writeFileSync(join(out, 'statement.json'), JSON.stringify(statement, null, 2))
      writeFileSync(
        join(out, 'expect.json'),
        JSON.stringify(
          {
            audience: vetter.did,
            publisher: applicant.did,
            community,
            challenge: session.challenge,
            domain: session.domain,
            requiredClaims: session.requiredClaims,
          },
          null,
          2
        )
      )
    }
  })
})
