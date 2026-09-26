import { DidDocument, JsonTransformer, TypedArrayEncoder } from '@credo-ts/core'
import { ed25519 } from '@noble/curves/ed25519.js'

import type { VtiPersona } from '../module/VtiIdentityStore'
import {
  CREDENTIAL_EXCHANGE_OFFER,
  CREDENTIAL_EXCHANGE_REQUEST,
  invitationOfferOf,
  invitationOfferOfMessage,
  parseInvitationOfferLink,
  redeemInvitationOffer,
  VtiInvitationOfferError,
} from '../module/vtiInvitationOffer'
import { invitationOfferMessage, keyringAgentLinkKind } from '../module/vtiLinks'

// A community's admin console hands out an invitation as an OID4VCI offer
// whose issuer is the community's DID (vtc-service `invitations/deliver`, VTI
// ed672fff): pushed to the invitee's DID, or shown as a QR. Keyring redeems it
// the way the community takes it (vtc-service `credentials/exchange/issue.rs`,
// `routes/credential_exchange.rs`, `tests/invitations.rs:390-518`) and keeps
// the InvitationCredential that comes back.

const COMMUNITY = 'did:webvh:QmCommunity:vtc.example:keyring-test-vtc'
const PERSONA_DID = 'did:webvh:QmPersona:dids.example:negative-weird'
const CODE = 'pac_f7ad902a31c54163acdef9bc3c1842e4'

// The offer as the console built it on 2026-09-25, code replaced.
const OFFER = {
  credential_configuration_ids: ['VIC'],
  credential_issuer: COMMUNITY,
  grants: { 'urn:ietf:params:oauth:grant-type:pre-authorized_code': { 'pre-authorized_code': CODE } },
}
// `offerDeepLink` in vtc-service admin-ui/src/lib/invitation-offer.ts.
const LINK = `openid-credential-offer://?credential_offer=${encodeURIComponent(JSON.stringify(OFFER))}`

const persona: VtiPersona = {
  communityDid: COMMUNITY,
  vtaDid: 'did:webvh:QmVta:dids.example:keyring-al-vta',
  did: PERSONA_DID,
  contextId: 'ctx',
  vtaKeyIds: { signing: `${PERSONA_DID}#key-0`, keyAgreement: `${PERSONA_DID}#key-1` },
  kmsKeyIds: { signing: 'kms-signing', keyAgreement: 'kms-ka' },
  createdAt: '2026-09-25T21:30:00Z',
}

const VIC = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  id: 'urn:uuid:ffe7cf83-e2fa-40b3-8b18-e6ef41eb9974',
  type: ['VerifiableCredential', 'DTGCredential', 'InvitationCredential'],
  issuer: COMMUNITY,
  validUntil: '2026-10-25T21:36:25Z',
  credentialSubject: { id: PERSONA_DID, scopes: ['role:member'] },
  proof: { type: 'DataIntegrityProof' },
}

describe('recognising a community invitation offer', () => {
  it('takes a pre-authorized offer whose issuer is a DID', () => {
    expect(invitationOfferOf(OFFER)).toEqual({
      communityDid: COMMUNITY,
      configurationIds: ['VIC'],
      preAuthorizedCode: CODE,
    })
  })

  it('leaves an ordinary OpenID offer (an https issuer) to the OpenID flow', () => {
    expect(invitationOfferOf({ ...OFFER, credential_issuer: 'https://issuer.example' })).toBeUndefined()
    const https = `openid-credential-offer://?credential_offer=${encodeURIComponent(
      JSON.stringify({ ...OFFER, credential_issuer: 'https://issuer.example' })
    )}`
    expect(keyringAgentLinkKind(https)).toBeUndefined()
  })

  it('needs the pre-authorized code', () => {
    expect(invitationOfferOf({ ...OFFER, grants: {} })).toBeUndefined()
  })

  it("reads the console's QR link, encoded or as the raw JSON a person pastes", () => {
    expect(parseInvitationOfferLink(LINK)?.preAuthorizedCode).toBe(CODE)
    expect(
      parseInvitationOfferLink(`openid-credential-offer://?credential_offer=${JSON.stringify(OFFER)}`)?.communityDid
    ).toBe(COMMUNITY)
    expect(keyringAgentLinkKind(LINK)).toBe('invitationOffer')
    expect(keyringAgentLinkKind(`  ${LINK}\n`)).toBe('invitationOffer')
  })

  it('takes a pushed offer only from the community it names', () => {
    const pushed = { type: CREDENTIAL_EXCHANGE_OFFER, from: COMMUNITY, body: { credential_offer: OFFER } }
    expect(invitationOfferOfMessage(pushed)?.preAuthorizedCode).toBe(CODE)
    expect(invitationOfferOfMessage({ ...pushed, from: 'did:webvh:QmOther:elsewhere' })).toBeUndefined()
    expect(
      invitationOfferOfMessage({ ...pushed, type: 'https://trusttasks.org/spec/credential-exchange/issue/0.1' })
    ).toBeUndefined()
  })

  // vti #1771: a community pushes the offer as a signed Trust Task document
  // (vtc-service routes/invitations.rs:571-575, `push_document`), in the
  // binding envelope over DIDComm or in a TSP frame. What reaches the inbox is
  // the task, typed as itself, whose body is the document with the offer in
  // its payload (`unwrapBindingEnvelope`).
  it('takes an offer the community pushes as a signed document', () => {
    const document = {
      id: 'urn:uuid:4f3c2b10-6a3e-4c1f-9a51-2f0d4c6b7e81',
      type: CREDENTIAL_EXCHANGE_OFFER,
      threadId: 'urn:uuid:9d2a1c4e-0b7f-4e3a-8c55-1a6f0e2b3d47',
      issuer: COMMUNITY,
      recipient: PERSONA_DID,
      issuedAt: '2026-09-27T09:00:00Z',
      payload: { credential_offer: OFFER },
      proof: { type: 'DataIntegrityProof', proofPurpose: 'authentication' },
    }
    const pushed = { type: CREDENTIAL_EXCHANGE_OFFER, from: COMMUNITY, body: document }
    expect(invitationOfferOfMessage(pushed)).toEqual({
      communityDid: COMMUNITY,
      configurationIds: ['VIC'],
      preAuthorizedCode: CODE,
    })
    // The document is the community's own: one whose issuer is not the sender is not taken.
    expect(
      invitationOfferOfMessage({ ...pushed, body: { ...document, issuer: 'did:webvh:QmOther:elsewhere' } })
    ).toBeUndefined()
    expect(invitationOfferOfMessage({ ...pushed, from: 'did:webvh:QmOther:elsewhere' })).toBeUndefined()
  })
})

describe('redeeming it', () => {
  const secret = new Uint8Array(32).fill(11)
  const publicKey = ed25519.getPublicKey(secret)

  function agentWith(restEndpoint: unknown) {
    const docs: Record<string, DidDocument> = {
      [COMMUNITY]: JsonTransformer.fromJSON(
        {
          '@context': ['https://www.w3.org/ns/did/v1'],
          id: COMMUNITY,
          service: [{ id: `${COMMUNITY}#vtc-rest`, type: 'VTCRest', serviceEndpoint: restEndpoint }],
        },
        DidDocument
      ),
      [PERSONA_DID]: JsonTransformer.fromJSON(
        {
          '@context': ['https://www.w3.org/ns/did/v1'],
          id: PERSONA_DID,
          verificationMethod: [
            {
              id: `${PERSONA_DID}#key-0`,
              type: 'Ed25519VerificationKey2018',
              controller: PERSONA_DID,
              publicKeyBase58: TypedArrayEncoder.toBase58(publicKey),
            },
          ],
          authentication: [`${PERSONA_DID}#key-0`],
          assertionMethod: [`${PERSONA_DID}#key-0`],
        },
        DidDocument
      ),
    }
    return {
      dids: {
        resolveDidDocument: async (did: string) => docs[did],
        getCreatedDids: async () => [],
      },
      dependencyManager: {
        resolve: () => ({
          sign: async ({ keyId, data }: { keyId: string; data: Uint8Array }) => {
            expect(keyId).toBe('kms-signing')
            return { signature: ed25519.sign(data, secret) }
          },
        }),
      },
    } as never
  }

  function answering(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchFn = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return { status, ok: status >= 200 && status < 300, json: async () => body } as Response
    })
    return { calls, fetch: fetchFn as unknown as typeof fetch }
  }

  const NOW = new Date('2026-09-25T21:40:00Z')
  const offer = invitationOfferOf(OFFER)!

  it('asks the community the way it takes it, and keeps the invitation that comes back', async () => {
    const { calls, fetch } = answering(200, { credential_response: { credential: VIC } })
    const invitation = await redeemInvitationOffer(agentWith('https://vtc.example/v1'), offer, persona, {
      fetch,
      now: () => NOW,
    })
    expect(invitation).toMatchObject({
      communityDid: COMMUNITY,
      subjectDid: PERSONA_DID,
      role: 'member',
      status: 'pending',
    })
    expect(invitation.credential).toEqual(VIC)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://vtc.example/v1/credential-exchange/request')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers).toMatchObject({ 'Trust-Task': CREDENTIAL_EXCHANGE_REQUEST })
    // The bare payload, not a Trust Task document (routes/credential_exchange.rs:31-38).
    const body = JSON.parse(String(calls[0].init.body))
    expect(Object.keys(body)).toEqual(['credential_request'])
    expect(body.credential_request).toMatchObject({ format: 'vc+sd-jwt', vct: 'VIC', proof: { proof_type: 'jwt' } })
  })

  it("signs a key-binding proof the community's verifier accepts", async () => {
    const { calls, fetch } = answering(200, { credential_response: { credential: VIC } })
    await redeemInvitationOffer(agentWith('https://vtc.example'), offer, persona, { fetch, now: () => NOW })
    const jwt: string = JSON.parse(String(calls[0].init.body)).credential_request.proof.jwt
    const [h, p, s] = jwt.split('.')
    const header = JSON.parse(TypedArrayEncoder.toUtf8String(TypedArrayEncoder.fromBase64Url(h)))
    const claims = JSON.parse(TypedArrayEncoder.toUtf8String(TypedArrayEncoder.fromBase64Url(p)))
    // issue.rs:62-79: typ, alg EdDSA, and a kid whose DID is the invited one.
    expect(header).toEqual({ alg: 'EdDSA', kid: `${PERSONA_DID}#key-0`, typ: 'openid4vci-proof+jwt' })
    expect(header.kid.split('#')[0]).toBe(PERSONA_DID)
    // aud is the offer's issuer, nonce the pre-authorized code, iat now (issue.rs:114-128, pending.rs:137-142).
    expect(claims).toEqual({ iss: PERSONA_DID, aud: COMMUNITY, iat: NOW.getTime() / 1000, nonce: CODE })
    // Ed25519 over the ASCII h.p (issue.rs:97-105).
    expect(ed25519.verify(TypedArrayEncoder.fromBase64Url(s), new TextEncoder().encode(`${h}.${p}`), publicKey)).toBe(
      true
    )
    // A bare base URL (a community minted before vti #1615) gets the /v1 prefix, once.
    expect(calls[0].url).toBe('https://vtc.example/v1/credential-exchange/request')
  })

  it('reads a VTCRest endpoint given as { uri }', async () => {
    const { calls, fetch } = answering(200, { credential_response: { credential: VIC } })
    await redeemInvitationOffer(agentWith({ uri: 'https://vtc.example/v1/' }), offer, persona, {
      fetch,
      now: () => NOW,
    })
    expect(calls[0].url).toBe('https://vtc.example/v1/credential-exchange/request')
  })

  it.each([
    [404, 'used'],
    [403, 'otherIdentity'],
    [400, 'failed'],
  ])('answers %i as %s', async (status, reason) => {
    const { fetch } = answering(status, { error: 'x' })
    await expect(
      redeemInvitationOffer(agentWith('https://vtc.example/v1'), offer, persona, { fetch, now: () => NOW })
    ).rejects.toMatchObject({ reason })
  })

  it('refuses without the invited identity, before asking', async () => {
    const { calls, fetch } = answering(200, {})
    await expect(
      redeemInvitationOffer(agentWith('https://vtc.example/v1'), offer, undefined, { fetch })
    ).rejects.toMatchObject({
      reason: 'noIdentity',
    })
    expect(calls).toHaveLength(0)
  })

  it('refuses an invitation for another identity, or from another community', async () => {
    const other = { ...VIC, credentialSubject: { id: 'did:webvh:QmSomeoneElse:x', scopes: ['role:member'] } }
    const a = answering(200, { credential_response: { credential: other } })
    await expect(
      redeemInvitationOffer(agentWith('https://vtc.example/v1'), offer, persona, { fetch: a.fetch, now: () => NOW })
    ).rejects.toMatchObject({ reason: 'otherIdentity' })
    const b = answering(200, { credential_response: { credential: { ...VIC, issuer: 'did:webvh:QmOther:x' } } })
    await expect(
      redeemInvitationOffer(agentWith('https://vtc.example/v1'), offer, persona, { fetch: b.fetch, now: () => NOW })
    ).rejects.toMatchObject({ reason: 'failed' })
  })

  it('says why in words, for the scanner', () => {
    expect(invitationOfferMessage(new VtiInvitationOfferError('used'))).toMatch(/already been used/)
    expect(invitationOfferMessage(new VtiInvitationOfferError('noIdentity'))).toMatch(/I was invited/)
    expect(invitationOfferMessage(new Error('boom'))).toMatch(/send it again/)
  })
})
