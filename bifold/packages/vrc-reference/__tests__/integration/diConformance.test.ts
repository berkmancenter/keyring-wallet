/**
 * Data Integrity (eddsa-rdfc-2022) sign/verify conformance — full
 * cryptographic round-trip through a Credo agent with the
 * DataIntegritySuiteModule from @bifold/vrc-shared registered
 * (docs/CRYPTO_SUITE_FOLLOWUP.md, witness/reference dual-verify).
 *
 * Proves the witness-side verification surface:
 * - a VRC-shaped VCDM 2.0 credential signs with DataIntegrityProof/
 *   eddsa-rdfc-2022 (no Ed25519 suite context needed) and verifies
 * - tampering is detected
 * - Ed25519Signature2018 still signs/verifies on the same agent (stored
 *   legacy credentials + pre-v3 peers keep working — dual-stack)
 * - the witness Identity Check mixed case: a 2018-signed, challenge-bound
 *   VP wrapping a DI-signed VRC verifies end-to-end
 *
 * No DIDComm connections are involved — a single agent with an in-memory
 * wallet does both sides.
 */
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals'
import {
  Agent,
  CacheModule,
  ClaimFormat,
  ConsoleLogger,
  DidsModule,
  InMemoryLruCache,
  JsonTransformer,
  KeyDidRegistrar,
  KeyDidResolver,
  LogLevel,
  PeerDidNumAlgo,
  PeerDidRegistrar,
  PeerDidResolver,
  W3cCredential,
  W3cCredentialsModule,
  W3cJsonLdVerifiableCredential,
  W3cPresentation,
} from '@credo-ts/core'
import { AskarModule } from '@credo-ts/askar'
import { agentDependencies } from '@credo-ts/node'
import { askar } from '@openwallet-foundation/askar-nodejs'
import { DataIntegritySuiteModule, demoDocumentLoader, deleteWallet, walletExists } from '@bifold/vrc-shared'
import { CREDENTIALS_V2_CONTEXT_URL, ED25519_2018_SUITE_CONTEXT_URL } from '@bifold/vrc-contexts'

import { DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL } from '../../src/relationshipContext'

const CREDENTIALS_V1_CONTEXT_URL = 'https://www.w3.org/2018/credentials/v1'
const WALLET_ID = `di-conformance-${process.env.JEST_WORKER_ID ?? '0'}`

function buildAgent() {
  return new Agent({
    config: { logger: new ConsoleLogger(LogLevel.error) },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: {
          id: WALLET_ID,
          key: WALLET_ID,
          database: { type: 'sqlite', config: { inMemory: true } },
        },
      }),
      w3cCredentials: new W3cCredentialsModule({ documentLoader: demoDocumentLoader }),
      diSuite: new DataIntegritySuiteModule(),
      cache: new CacheModule({ cache: new InMemoryLruCache({ limit: 50 }) }),
      dids: new DidsModule({
        resolvers: [new KeyDidResolver(), new PeerDidResolver()],
        registrars: [new KeyDidRegistrar(), new PeerDidRegistrar()],
      }),
    },
  })
}

describe('Data Integrity conformance (DataIntegrityProof/eddsa-rdfc-2022)', () => {
  let agent: ReturnType<typeof buildAgent>
  let issuerDid: string
  let verificationMethodId: string

  const buildVrcJson = (id: string) => ({
    // DI path: no Ed25519 suite context — credentials/v2 defines the DI terms
    '@context': [CREDENTIALS_V2_CONTEXT_URL, DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL],
    id,
    type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
    issuer: issuerDid,
    validFrom: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    credentialSubject: { id: 'did:example:counterparty' },
  })

  const signDi = async (credentialJson: Record<string, unknown>) =>
    agent.w3cCredentials.signCredential({
      format: ClaimFormat.LdpVc,
      credential: JsonTransformer.fromJSON(credentialJson, W3cCredential, { validate: false }),
      proofType: 'DataIntegrityProof',
      verificationMethod: verificationMethodId,
    })

  beforeAll(async () => {
    if (walletExists(WALLET_ID)) deleteWallet(WALLET_ID)

    agent = buildAgent()
    await agent.initialize()

    const result = await agent.dids.create({
      method: 'peer',
      options: {
        numAlgo: PeerDidNumAlgo.InceptionKeyWithoutDoc,
        createKey: { type: { kty: 'OKP', crv: 'Ed25519' } },
      },
    })
    if (result.didState?.state !== 'finished' || !result.didState.did || !result.didState.didDocument) {
      throw new Error(`DID creation failed: ${JSON.stringify(result.didState)}`)
    }
    issuerDid = result.didState.did
    verificationMethodId = result.didState.didDocument.verificationMethod?.[0]?.id as string
  }, 30000)

  afterAll(async () => {
    await agent?.shutdown()
  }, 10000)

  test('signs a VRC-shaped VCDM 2.0 credential with eddsa-rdfc-2022', async () => {
    const signed = await signDi(buildVrcJson('urn:uuid:di-conformance-sign'))
    const json = JsonTransformer.toJSON(signed) as Record<string, any>

    expect(json.proof.type).toBe('DataIntegrityProof')
    expect(json.proof.cryptosuite).toBe('eddsa-rdfc-2022')
    expect(json.proof.proofValue).toMatch(/^z/)
    // Signing must not have mutated the @context (nothing appended)
    expect(json['@context']).toEqual([CREDENTIALS_V2_CONTEXT_URL, DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL])
  }, 30000)

  test('verifies its own DI credential and rejects a tampered one', async () => {
    const signed = await signDi(buildVrcJson('urn:uuid:di-conformance-verify'))

    const verifyResult = await agent.w3cCredentials.verifyCredential({ credential: signed })
    expect(verifyResult.isValid).toBe(true)

    const tamperedJson = JsonTransformer.toJSON(signed) as Record<string, any>
    tamperedJson.credentialSubject.id = 'did:example:forged'
    const tampered = JsonTransformer.fromJSON(tamperedJson, W3cJsonLdVerifiableCredential, { validate: false })
    const tamperResult = await agent.w3cCredentials.verifyCredential({ credential: tampered })
    expect(tamperResult.isValid).toBe(false)
  }, 30000)

  test('Ed25519Signature2018 still signs and verifies on the same agent (dual-stack)', async () => {
    const signed2018 = await agent.w3cCredentials.signCredential({
      format: ClaimFormat.LdpVc,
      credential: JsonTransformer.fromJSON(
        {
          ...buildVrcJson('urn:uuid:di-conformance-2018'),
          '@context': [CREDENTIALS_V2_CONTEXT_URL, DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL, ED25519_2018_SUITE_CONTEXT_URL],
        },
        W3cCredential,
        { validate: false }
      ),
      proofType: 'Ed25519Signature2018',
      verificationMethod: verificationMethodId,
    })
    const json = JsonTransformer.toJSON(signed2018) as Record<string, any>
    expect(json.proof.type).toBe('Ed25519Signature2018')

    const verifyResult = await agent.w3cCredentials.verifyCredential({ credential: signed2018 })
    expect(verifyResult.isValid).toBe(true)
  }, 30000)

  test('witness Identity Check mixed case: 2018-signed challenge-bound v2 VP wrapping a DI-signed VRC', async () => {
    // Exactly what the app's witnessed flow will submit once the witnessed
    // path flips the inner VRC to DI: VP proof stays 2018 (witness-facing),
    // inner credential carries DataIntegrityProof. The VP context must be
    // credentials/v2 to match the wrapped credential's data model (a v1 VP
    // around a v2 credential fails JSON-LD expansion on protected terms).
    const signedVrc = await signDi(buildVrcJson('urn:uuid:di-conformance-vp'))

    const vpUnsigned = JsonTransformer.fromJSON(
      {
        '@context': [CREDENTIALS_V2_CONTEXT_URL],
        type: ['VerifiablePresentation'],
        holder: issuerDid,
        verifiableCredential: [JsonTransformer.toJSON(signedVrc)],
      },
      W3cPresentation,
      { validate: false }
    )

    const challenge = 'di-conformance-challenge'
    const domain = 'witness.example.org'
    const signedVp = await agent.w3cCredentials.signPresentation({
      format: ClaimFormat.LdpVp,
      presentation: vpUnsigned,
      verificationMethod: verificationMethodId,
      proofType: 'Ed25519Signature2018',
      // no explicit proofPurpose: the vc layer builds an
      // AuthenticationProofPurpose from challenge + domain (a string here
      // crashes with "purpose.update is not a function")
      challenge,
      domain,
    })

    const verifyResult = await agent.w3cCredentials.verifyPresentation({
      presentation: signedVp,
      challenge,
      domain,
    })
    expect(verifyResult.isValid).toBe(true)
  }, 30000)

  test('regression: fixed witnessed-flow shape today — 2018-signed v2 VP wrapping a 2018-signed v2 VRC', async () => {
    // The pre-fix production shape (v1 VP around a v2 VRC) fails JSON-LD
    // expansion at signing; this pins the corrected shape used by
    // witnessed-vrc-manager / Participant after the VP-context fix.
    const signedVrc = await agent.w3cCredentials.signCredential({
      format: ClaimFormat.LdpVc,
      credential: JsonTransformer.fromJSON(
        {
          ...buildVrcJson('urn:uuid:di-conformance-witnessed-2018'),
          '@context': [CREDENTIALS_V2_CONTEXT_URL, DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL, ED25519_2018_SUITE_CONTEXT_URL],
        },
        W3cCredential,
        { validate: false }
      ),
      proofType: 'Ed25519Signature2018',
      verificationMethod: verificationMethodId,
    })

    const vpUnsigned = JsonTransformer.fromJSON(
      {
        '@context': [CREDENTIALS_V2_CONTEXT_URL],
        type: ['VerifiablePresentation'],
        holder: issuerDid,
        verifiableCredential: [JsonTransformer.toJSON(signedVrc)],
      },
      W3cPresentation,
      { validate: false }
    )

    const challenge = 'witnessed-regression-challenge'
    const domain = 'witness.example.org'
    const signedVp = await agent.w3cCredentials.signPresentation({
      format: ClaimFormat.LdpVp,
      presentation: vpUnsigned,
      verificationMethod: verificationMethodId,
      proofType: 'Ed25519Signature2018',
      challenge,
      domain,
    })

    const verifyResult = await agent.w3cCredentials.verifyPresentation({
      presentation: signedVp,
      challenge,
      domain,
    })
    expect(verifyResult.isValid).toBe(true)
  }, 30000)
})
